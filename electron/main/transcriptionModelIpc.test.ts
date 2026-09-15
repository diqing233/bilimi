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

  it('publishes a conservative smoothed speed and ETA only after receiving download bytes', async () => {
    const ipcMain = createIpcMain()
    const send = vi.fn()
    let reportProgress: ((received: number, total: number) => void) | undefined
    const manager = {
      list: vi.fn(() => [model]),
      install: vi.fn((_id, onProgress) => new Promise<void>(() => { reportProgress = onProgress })),
      revalidate: vi.fn(async () => undefined)
    }
    registerTranscriptionModelIpc({ ipcMain, manager, send })

    void ipcMain.handlers.get('video-audio:transcription-model-install')?.({ sender: { id: 7 } }, model.id)
    await vi.waitFor(() => expect(reportProgress).toBeTypeOf('function'))
    reportProgress?.(50, 100)

    expect(send).toHaveBeenLastCalledWith(7, 'video-audio:transcription-model-progress', expect.objectContaining({
      receivedBytes: 50,
      totalBytes: 100,
      bytesPerSecond: expect.any(Number),
      etaSeconds: expect.any(Number)
    }))
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
