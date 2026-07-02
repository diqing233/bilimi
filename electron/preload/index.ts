import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  StartupDiagnosticReport,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote,
  VideoNoteArchiveEntry
} from '../../src/shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  FloatingAssistantActionOptions,
  FloatingAssistantWorkspaceRequest
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type {
  AssistantPetHint,
  AssistantPetState
} from '../../src/renderer/src/features/assistant/petState'
import type { FavoriteLedgerPreviewItem } from '../../src/renderer/src/features/favorites/favoriteLedgerPreview'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  closeAssistantPet: () => ipcRenderer.send('assistant-pet:close'),
  closeFloatingAssistant: () => ipcRenderer.send('floating-assistant:close'),
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadPendingFavoriteQueue: () =>
    ipcRenderer.invoke('pending-favorite-queue:load') as Promise<PendingFavoriteQueueItem[]>,
  clearPendingFavoriteQueue: () =>
    ipcRenderer.invoke('pending-favorite-queue:clear') as Promise<PendingFavoriteQueueItem[]>,
  upsertPendingFavoriteQueueItems: (items: PendingFavoriteQueueItem[]) =>
    ipcRenderer.invoke('pending-favorite-queue:upsert', items) as Promise<PendingFavoriteQueueItem[]>,
  updatePendingFavoriteQueueItemStatus: (aid: number, status: PendingFavoriteQueueStatus) =>
    ipcRenderer.invoke('pending-favorite-queue:update-status', aid, status) as Promise<PendingFavoriteQueueItem[]>,
  loadVideoNotes: () => ipcRenderer.invoke('video-notes:load') as Promise<VideoNote[]>,
  loadVideoNoteArchives: () =>
    ipcRenderer.invoke('video-note-archives:load') as Promise<VideoNoteArchiveEntry[]>,
  loadDeepSeekApiKeyStatus: () =>
    ipcRenderer.invoke('deepseek:key-status') as Promise<DeepSeekKeyStatus>,
  runStartupDiagnostics: () =>
    ipcRenderer.invoke('startup:diagnose') as Promise<StartupDiagnosticReport>,
  finishFloatingSealDrag: () => ipcRenderer.send('floating-seal:finish-drag'),
  generateDeepSeek: (request: DeepSeekGenerateRequest) =>
    ipcRenderer.invoke('deepseek:generate', request) as Promise<DeepSeekGenerateResult>,
  moveFloatingSealBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('floating-seal:move-by', deltaX, deltaY) as Promise<void>,
  moveFloatingSealTo: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:move-to', screenX, screenY),
  notifyAssistantSnapshotChanged: () => ipcRenderer.send('floating-assistant:snapshot-changed'),
  onAssistantPetStateChanged: (callback: (state: AssistantPetState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AssistantPetState) => callback(state)

    ipcRenderer.on('assistant-pet:state-changed', listener)

    return () => {
      ipcRenderer.removeListener('assistant-pet:state-changed', listener)
    }
  },
  onAssistantPetHintChanged: (callback: (hint: AssistantPetHint) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, hint: AssistantPetHint) => callback(hint)

    ipcRenderer.on('assistant-pet:hint-changed', listener)

    return () => {
      ipcRenderer.removeListener('assistant-pet:hint-changed', listener)
    }
  },
  onAssistantPreferencesChanged: (callback: (preferences: AssistantPreferences) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, preferences: AssistantPreferences) =>
      callback(preferences)

    ipcRenderer.on('assistant:preferences-changed', listener)

    return () => {
      ipcRenderer.removeListener('assistant:preferences-changed', listener)
    }
  },
  onAssistantSnapshotChanged: (callback: () => void) => {
    const listener = () => callback()

    ipcRenderer.on('floating-assistant:snapshot-changed', listener)

    return () => {
      ipcRenderer.removeListener('floating-assistant:snapshot-changed', listener)
    }
  },
  openAssistant: () => ipcRenderer.invoke('assistant:open-from-floating-seal') as Promise<void>,
  onOpenAssistant: (callback: (payload?: { position?: { left: number; top: number } }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload?: { position?: { left: number; top: number } }
    ) => callback(payload)

    ipcRenderer.on('assistant:open', listener)

    return () => {
      ipcRenderer.removeListener('assistant:open', listener)
    }
  },
  onOpenFloatingAssistantWorkspace: (
    callback: (payload: FloatingAssistantWorkspaceRequest) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: FloatingAssistantWorkspaceRequest
    ) => callback(payload)

    ipcRenderer.on('floating-assistant:open-workspace', listener)

    return () => {
      ipcRenderer.removeListener('floating-assistant:open-workspace', listener)
    }
  },
  onOpenInTab: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)

    ipcRenderer.on('browser:open-in-tab', listener)

    return () => {
      ipcRenderer.removeListener('browser:open-in-tab', listener)
    }
  },
  onRunAssistantAction: (callback: (payload: { action: AssistantAction }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { action: AssistantAction }
    ) => callback(payload)

    ipcRenderer.on('assistant:run-action', listener)

    return () => {
      ipcRenderer.removeListener('assistant:run-action', listener)
    }
  },
  registerAssistantRuntime: (
    handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>
  ) => {
    const listener = async (
      _event: Electron.IpcRendererEvent,
      request: AssistantRuntimeRequest
    ) => {
      try {
        const payload = await handler(request)
        ipcRenderer.send('assistant-runtime:response', {
          id: request.id,
          ok: true,
          payload
        })
      } catch (error) {
        ipcRenderer.send('assistant-runtime:response', {
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : 'Assistant runtime failed.'
        })
      }
    }

    ipcRenderer.on('assistant-runtime:request', listener)

    return () => {
      ipcRenderer.removeListener('assistant-runtime:request', listener)
    }
  },
  requestAssistantSnapshot: () =>
    ipcRenderer.invoke('floating-assistant:snapshot'),
  restoreMainWindowFromPet: () =>
    ipcRenderer.invoke('assistant-pet:restore-main-window') as Promise<void>,
  resizeFloatingSealByStep: (step: number) =>
    ipcRenderer.send('floating-seal:resize-step', step),
  getCurrentVideoTime: () =>
    ipcRenderer.invoke('floating-assistant:get-current-video-time') as Promise<number>,
  seekVideoTime: (seconds: number) =>
    ipcRenderer.invoke('floating-assistant:seek-video-time', seconds) as Promise<boolean>,
  runAssistantAction: (action: AssistantAction, options?: FloatingAssistantActionOptions) =>
    ipcRenderer.invoke('floating-assistant:run-action', action, options),
  runFloatingMenuAction: (action: AssistantAction, options?: FloatingAssistantActionOptions) =>
    ipcRenderer.invoke('floating-menu:run-action', action, options) as Promise<AssistantAutomationResult>,
  openFloatingAssistantWorkspace: (payload: FloatingAssistantWorkspaceRequest) =>
    ipcRenderer.invoke('floating-assistant:open-workspace', payload) as Promise<void>,
  generateVideoNote: (manualTranscript?: string) =>
    ipcRenderer.invoke('floating-assistant:generate-video-note', manualTranscript),
  generateVideoNoteFromAudio: () =>
    ipcRenderer.invoke('floating-assistant:generate-video-note-from-audio') as Promise<VideoNote | null>,
  enqueueCurrentVideoAudioTranscription: (options?: { summarizeWithDeepSeek?: boolean }) =>
    ipcRenderer.invoke(
      'floating-assistant:enqueue-current-video-audio',
      options
    ) as Promise<VideoAudioTranscriptionQueueSnapshot | null>,
  transcribeCurrentVideoAudio: (request: VideoAudioTranscriptionRequest) =>
    ipcRenderer.invoke('video-audio:transcribe-current', request) as Promise<VideoAudioTranscriptionResult>,
  loadVideoAudioTranscriptionQueue: () =>
    ipcRenderer.invoke('video-audio:transcription-queue-load') as Promise<VideoAudioTranscriptionQueueSnapshot>,
  enqueueVideoAudioTranscription: (request: VideoAudioTranscriptionRequest) =>
    ipcRenderer.invoke(
      'video-audio:transcription-queue-enqueue',
      request
    ) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  cancelVideoAudioTranscription: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-cancel', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  retryVideoAudioTranscription: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-retry', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  onVideoAudioTranscriptionQueueChanged: (
    callback: (snapshot: VideoAudioTranscriptionQueueSnapshot) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: VideoAudioTranscriptionQueueSnapshot
    ) => callback(snapshot)

    ipcRenderer.on('video-audio:transcription-queue-changed', listener)

    return () => {
      ipcRenderer.removeListener('video-audio:transcription-queue-changed', listener)
    }
  },
  onVideoAudioTranscriptionProgress: (callback: (progress: VideoAudioTranscriptionProgress) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: VideoAudioTranscriptionProgress
    ) => callback(progress)

    ipcRenderer.on('video-audio:transcription-progress', listener)

    return () => {
      ipcRenderer.removeListener('video-audio:transcription-progress', listener)
    }
  },
  ensureFavoriteLedgers: () => ipcRenderer.invoke('floating-assistant:ensure-ledgers'),
  saveFavoriteLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) =>
    ipcRenderer.invoke('floating-assistant:save-ledgers', ledgers, options),
  openBilibiliFavorites: () => ipcRenderer.invoke('floating-assistant:open-bilibili-favorites'),
  scanOldFavorites: (options?: {
    multiArchiveMode?: AssistantPreferences['favoriteArchiveMultiMode']
  }) => ipcRenderer.invoke('floating-assistant:scan-old-favorites', options),
  rejudgeOldFavorite: (item: FavoriteLedgerPreviewItem) =>
    ipcRenderer.invoke('floating-assistant:rejudge-old-favorite', item) as Promise<FavoriteLedgerPreviewItem>,
  executeOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) =>
    ipcRenderer.invoke('floating-assistant:execute-old-favorite-plan', items),
  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  saveDeepSeekApiKey: (apiKey: string) =>
    ipcRenderer.invoke('deepseek:save-key', apiKey) as Promise<DeepSeekKeyStatus>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>,
  saveVideoNoteArchiveVersion: (note: VideoNote, summaryText?: string) =>
    ipcRenderer.invoke(
      'video-note-archives:save-version',
      note,
      summaryText
    ) as Promise<VideoNoteArchiveEntry[]>,
  updateVideoNoteArchiveVersion: (archiveId: string, versionId: string, note: VideoNote) =>
    ipcRenderer.invoke(
      'video-note-archives:update-version',
      archiveId,
      versionId,
      note
    ) as Promise<VideoNoteArchiveEntry[]>,
  deleteVideoNoteArchiveEntry: (archiveId: string) =>
    ipcRenderer.invoke('video-note-archives:delete-entry', archiveId) as Promise<VideoNoteArchiveEntry[]>,
  deleteVideoNoteArchiveVersion: (archiveId: string, versionId: string) =>
    ipcRenderer.invoke(
      'video-note-archives:delete-version',
      archiveId,
      versionId
    ) as Promise<VideoNoteArchiveEntry[]>,
  clearDeepSeekApiKey: () => ipcRenderer.invoke('deepseek:clear-key') as Promise<DeepSeekKeyStatus>,
  setAssistantPetState: (state: AssistantPetState) =>
    ipcRenderer.send('assistant-pet:set-state', state),
  setAssistantPetHint: (hint: AssistantPetHint) =>
    ipcRenderer.send('assistant-pet:set-hint', hint),
  setFloatingSealMouseTransparent: (transparent: boolean) =>
    ipcRenderer.send('floating-seal:set-mouse-transparent', transparent),
  startFloatingSealDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:start-drag', screenX, screenY),
  toggleFloatingAssistant: () => ipcRenderer.invoke('floating-assistant:toggle') as Promise<void>,
  toggleFloatingMenu: () => ipcRenderer.invoke('floating-menu:toggle') as Promise<void>,
  wakeAssistantPet: () => ipcRenderer.invoke('assistant-pet:wake') as Promise<void>,
  testDeepSeekConnection: () =>
    ipcRenderer.invoke('deepseek:test-connection') as Promise<DeepSeekConnectionTestResult>
})
