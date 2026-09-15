import type {
  TranscriptionModelId,
  TranscriptionModelInstallation,
  TranscriptionModelInstallProgress
} from '../../src/shared/types'

type InstallPhase = 'connecting' | 'downloading' | 'downloading-part' | 'verifying' | 'merging-parts' | 'installing'

type PhaseDetails = { source?: 'ModelScope' | 'GitHub Release' | 'Official source'; partIndex?: number; partCount?: number; sourceFallbackMessage?: string }
type ModelManager = {
  list: () => TranscriptionModelInstallation[]
  install?: (
    id: TranscriptionModelId,
    onProgress?: (received: number, total: number) => void,
    signal?: AbortSignal,
    onPhase?: (phase: InstallPhase, details?: PhaseDetails) => void,
    restart?: boolean
  ) => Promise<void>
  importFromDirectory?: (id: TranscriptionModelId, directory: string) => Promise<void>
  migrateLegacyWhisperSmall?: () => Promise<void>
  revalidate: (id: TranscriptionModelId) => Promise<void>
}

type IpcMainLike = {
  handle: (channel: string, handler: (...args: any[]) => unknown) => void
}

const DOWNLOAD_ESTIMATE_WINDOW_MS = 750

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function registerTranscriptionModelIpc({
  ipcMain,
  manager,
  send,
  selectDirectory = async () => undefined
}: {
  ipcMain: IpcMainLike
  manager: ModelManager
  send: (senderId: number, channel: string, value: TranscriptionModelInstallProgress) => void
  selectDirectory?: () => Promise<string | undefined>
}) {
  const controllers = new Map<TranscriptionModelId, AbortController>()
  let currentProgress: TranscriptionModelInstallProgress | undefined
  const publish = (senderId: number, value: TranscriptionModelInstallProgress) =>
    send(senderId, 'video-audio:transcription-model-progress', value)
  const install = async (event: { sender: { id: number } }, id: TranscriptionModelId, options?: { restart?: boolean }) => {
    if (controllers.has(id)) throw new Error('This transcription model download is already running.')
    if (controllers.size > 0) throw new Error('Another transcription model download is already running.')
    if (!manager.install) throw new Error('Transcription model installation is unavailable.')
    const controller = new AbortController()
    controllers.set(id, controller)
    let activeSource: TranscriptionModelInstallProgress['source']
    let estimateSampleReceived = 0
    let estimateSampleAt = Date.now()
    let smoothedBytesPerSecond: number | undefined
    const updateProgress = (value: TranscriptionModelInstallProgress) => {
      if (value.source) activeSource = value.source
      currentProgress = { ...value, ...(activeSource ? { source: activeSource } : {}) }
      publish(event.sender.id, currentProgress)
    }
    updateProgress({ id, stage: 'connecting' })
    try {
      await manager.install(id, (receivedBytes, totalBytes) => {
        const now = Date.now()
        const elapsed = Math.max(0, now - estimateSampleAt)
        let bytesPerSecond: number | undefined
        if (elapsed >= DOWNLOAD_ESTIMATE_WINDOW_MS) {
          const windowBytesPerSecond = Math.max(0, (receivedBytes - estimateSampleReceived) * 1000 / Math.max(1, elapsed))
          smoothedBytesPerSecond = smoothedBytesPerSecond === undefined
            ? windowBytesPerSecond
            : smoothedBytesPerSecond * 0.7 + windowBytesPerSecond * 0.3
          estimateSampleReceived = receivedBytes
          estimateSampleAt = now
          bytesPerSecond = Math.round(smoothedBytesPerSecond)
        } else if (smoothedBytesPerSecond !== undefined) {
          bytesPerSecond = Math.round(smoothedBytesPerSecond)
        }
        updateProgress({
          id,
          stage: 'downloading',
          receivedBytes,
          totalBytes,
          percentage: totalBytes > 0 ? Math.min(100, Math.round(receivedBytes / totalBytes * 100)) : undefined,
          ...(bytesPerSecond && bytesPerSecond > 0 ? {
            bytesPerSecond,
            etaSeconds: totalBytes > receivedBytes ? Math.ceil((totalBytes - receivedBytes) / bytesPerSecond) : undefined
          } : {})
        })
      }, controller.signal, (stage, details) => updateProgress({ id, stage, ...details }), options?.restart === true)
      updateProgress({ id, stage: 'validating-runtime' })
      await manager.revalidate(id)
      updateProgress({ id, stage: 'available', percentage: 100 })
      return manager.list()
    } catch (error) {
      if (isAbortError(error)) {
        updateProgress({ id, stage: 'canceled' })
        return manager.list()
      }
      updateProgress({
        id,
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    } finally {
      controllers.delete(id)
    }
  }

  ipcMain.handle('video-audio:transcription-model-install', install)
  ipcMain.handle('video-audio:transcription-model-progress-current', () => currentProgress)
  ipcMain.handle('video-audio:transcription-model-install-cancel', (_event, id: TranscriptionModelId) => {
    controllers.get(id)?.abort()
    return manager.list()
  })
  ipcMain.handle('video-audio:transcription-model-import', async (event, id: TranscriptionModelId) => {
    const directory = await selectDirectory()
    if (!directory || !manager.importFromDirectory) return manager.list()
    try {
      publish(event.sender.id, { id, stage: 'verifying' })
      await manager.importFromDirectory(id, directory)
      publish(event.sender.id, { id, stage: 'validating-runtime' })
      await manager.revalidate(id)
      publish(event.sender.id, { id, stage: 'available', percentage: 100 })
      return manager.list()
    } catch (error) {
      publish(event.sender.id, {
        id,
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })
  ipcMain.handle('video-audio:transcription-model-migrate-legacy-whisper', async () => {
    if (!manager.migrateLegacyWhisperSmall) return manager.list()
    await manager.migrateLegacyWhisperSmall()
    return manager.list()
  })
  ipcMain.handle('video-audio:transcription-model-revalidate', async (event, id: TranscriptionModelId) => {
    publish(event.sender.id, { id, stage: 'validating-runtime' })
    try {
      await manager.revalidate(id)
      publish(event.sender.id, { id, stage: 'available', percentage: 100 })
      return manager.list()
    } catch (error) {
      publish(event.sender.id, {
        id,
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })
  return { cancel: (id: TranscriptionModelId) => controllers.get(id)?.abort() }
}
