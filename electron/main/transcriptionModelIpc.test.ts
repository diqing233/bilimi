import { describe, expect, it, vi } from 'vitest'
import { registerTranscriptionModelIpc } from './transcriptionModelIpc'

type Handler = (event: { sender: { id: number } }, ...args: any[]) => unknown

function createIpcMain() {
  const handlers = new Map<string, Handler>()
  return {
    handlers,
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler)
  }
}

const model = {
  id: 'faster-whisper-large-v3' as const,
  bundled: false,
  installed: true,
  available: true,
  version: 'fixed',
  runtimeFamily: 'faster-whisper' as const,
  hardware: 'CPU',
  license: 'MIT',
  attribution: 'test',
  downloadBytes: 100,
  installedBytes: 100
}

describe('transcription model IPC', () => {
  it('returns the authoritative current download snapshot to a settings page that mounts after download began', async () => {
    const ipcMain = createIpcMain()
    let reportProgress: ((received: number, total: number) => void) | undefined
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn((_id, onProgress) => new Promise<void>(() => { reportProgress = onProgress })),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send: vi.fn() })

    void ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id)
    await vi.waitFor(() => expect(reportProgress).toBeTypeOf('function'))
    reportProgress?.(40, 100)

    expect(ipcMain.handlers.get('video-audio:transcription-model-progress-current')?.({ sender: { id: 8 } }))
      .toMatchObject({ id: model.id, stage: 'downloading', receivedBytes: 40, totalBytes: 100 })
  })

  it('blocks a second model while a machine-wide download is active', async () => {
    const ipcMain = createIpcMain()
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn(() => new Promise<void>(() => undefined)),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send: vi.fn() })

    void ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id)
    await vi.waitFor(() => expect(manager.install).toHaveBeenCalled())
    await expect(ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 8 } }, 'whisper-small'))
      .rejects.toThrow('Another transcription model download is already running.')
  })

  it('keeps byte progress live but updates the speed and ETA only after a stable sampling window', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    let reportProgress: ((received: number, total: number) => void) | undefined
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn((_id, onProgress) => new Promise<void>(() => { reportProgress = onProgress })),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send })

    let now = 0
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      void ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id)
      await vi.waitFor(() => expect(reportProgress).toBeTypeOf('function'))

      now = 100
      reportProgress?.(10, 100)
      now = 200
      reportProgress?.(25, 100)
      const earlyProgress = send.mock.calls.filter(([, channel, value]) =>
        channel === 'video-audio:transcription-model-progress' && value.stage === 'downloading'
      )
      expect(earlyProgress.at(-1)?.[2]).toMatchObject({ receivedBytes: 25, totalBytes: 100 })
      expect(earlyProgress.at(-1)?.[2]).not.toHaveProperty('bytesPerSecond')

      now = 800
      reportProgress?.(80, 100)
      now = 850
      reportProgress?.(90, 100)
      const progress = send.mock.calls
        .filter(([, channel, value]) => channel === 'video-audio:transcription-model-progress' && value.stage === 'downloading')
        .map(([, , value]) => value)

      expect(progress.at(-2)).toMatchObject({ receivedBytes: 80, totalBytes: 100, bytesPerSecond: 100, etaSeconds: 1 })
      expect(progress.at(-1)).toMatchObject({ receivedBytes: 90, totalBytes: 100, bytesPerSecond: 100, etaSeconds: 1 })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('passes an explicit restart request to the manager without changing normal installs', async () => {
    const ipcMain = createIpcMain()
    const manager = { list: vi.fn(() => [model]), install: vi.fn(async () => undefined), revalidate: vi.fn(async () => undefined) }
    registerTranscriptionModelIpc({ ipcMain, manager, send: vi.fn() })

    await ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id, { restart: true })

    expect(manager.install).toHaveBeenCalledWith(model.id, expect.any(Function), expect.any(AbortSignal), expect.any(Function), true)
  })

  it('retains the actual download source through later active installation phases', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn(async (_id, _onProgress, _signal, onPhase) => {
        onPhase?.('connecting', { source: 'ModelScope' })
        onPhase?.('verifying')
      }),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send })

    await ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id)

    expect(send.mock.calls).toContainEqual([
      7,
      'video-audio:transcription-model-progress',
      expect.objectContaining({ id: model.id, stage: 'verifying', source: 'ModelScope' })
    ])
    expect(send.mock.calls).toContainEqual([
      7,
      'video-audio:transcription-model-progress',
      expect.objectContaining({ id: model.id, stage: 'validating-runtime', source: 'ModelScope' })
    ])
  })

  it('publishes download, verification, runtime validation, and availability while installing once', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn(async (_id, onProgress, _signal, onPhase) => {
        onProgress?.(40, 100)
        onPhase?.('verifying')
      }),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send })

    await expect(ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id))
      .resolves.toEqual([model])

    expect(manager.revalidate).toHaveBeenCalledWith(model.id)
    expect(send.mock.calls.map(([, channel, value]) => [channel, value.stage]))
      .toEqual([
        ['video-audio:transcription-model-progress', 'connecting'],
        ['video-audio:transcription-model-progress', 'downloading'],
        ['video-audio:transcription-model-progress', 'verifying'],
        ['video-audio:transcription-model-progress', 'validating-runtime'],
        ['video-audio:transcription-model-progress', 'available']
      ])
  })

  it('keeps cancellation resumable and publishes a canceled terminal state', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    const manager = {
      list: vi.fn(() => []),
      install: vi.fn(async (_id, _onProgress, signal) => {
        await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('Process canceled.'), { name: 'AbortError' })), { once: true }))
        throw Object.assign(new Error('Process canceled.'), { name: 'AbortError' })
      }),
      revalidate: vi.fn()
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send })

    const installing = ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id) as Promise<unknown>
    await ipcMain.handlers.get('video-audio:transcription-model-install-cancel')?.({ sender: { id: 7 } }, model.id)
    await expect(installing).resolves.toEqual([])

    expect(send).toHaveBeenLastCalledWith(7, 'video-audio:transcription-model-progress', expect.objectContaining({ id: model.id, stage: 'canceled' }))
    expect(manager.revalidate).not.toHaveBeenCalled()
  })

  it('revalidates an imported or previously installed model before it becomes available', async () => {
    const ipcMain = createIpcMain()
    const manager = {
      list: vi.fn(() => [model]),
      importFromDirectory: vi.fn(async () => undefined),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({
      ipcMain,
      manager,
      send: vi.fn(),
      selectDirectory: vi.fn(async () => 'C:/verified-model')
    })

    await ipcMain.handlers.get('video-audio:transcription-model-import')?.({ sender: { id: 7 } }, model.id)
    await ipcMain.handlers.get('video-audio:transcription-model-revalidate')?.({ sender: { id: 7 } }, model.id)

    expect(manager.importFromDirectory).toHaveBeenCalledWith(model.id, 'C:/verified-model')
    expect(manager.revalidate).toHaveBeenCalledTimes(2)
  })

  it('publishes the import validation error instead of leaving an installed model unexplained', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    const manager = {
      list: vi.fn(() => [model]),
      importFromDirectory: vi.fn(async () => undefined),
      revalidate: vi.fn(async () => { throw new Error('Controlled helper is missing.') })
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send, selectDirectory: vi.fn(async () => 'C:/model') })

    await expect(ipcMain.handlers.get('video-audio:transcription-model-import')?.({ sender: { id: 7 } }, model.id))
      .rejects.toThrow('Controlled helper is missing.')

    expect(send).toHaveBeenLastCalledWith(7, 'video-audio:transcription-model-progress', expect.objectContaining({
      id: model.id,
      stage: 'failed',
      error: 'Controlled helper is missing.'
    }))
  })
})
