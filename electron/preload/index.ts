import { contextBridge, ipcRenderer } from 'electron'
import type { AssistantPreferences } from '../main/store'
import type {
  AssistantAction,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote,
  VideoNoteArchiveEntry
} from '../../src/shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  FloatingAssistantActionOptions
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type { AssistantPetState } from '../../src/renderer/src/features/assistant/petState'
import type { FavoriteLedgerPreviewItem } from '../../src/renderer/src/features/favorites/favoriteLedgerPreview'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  closeFloatingAssistant: () => ipcRenderer.send('floating-assistant:close'),
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadVideoNotes: () => ipcRenderer.invoke('video-notes:load') as Promise<VideoNote[]>,
  loadVideoNoteArchives: () =>
    ipcRenderer.invoke('video-note-archives:load') as Promise<VideoNoteArchiveEntry[]>,
  finishFloatingSealDrag: () => ipcRenderer.send('floating-seal:finish-drag'),
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
  resizeFloatingSeal: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:resize', screenX, screenY),
  getCurrentVideoTime: () =>
    ipcRenderer.invoke('floating-assistant:get-current-video-time') as Promise<number>,
  seekVideoTime: (seconds: number) =>
    ipcRenderer.invoke('floating-assistant:seek-video-time', seconds) as Promise<boolean>,
  runAssistantAction: (action: AssistantAction, options?: FloatingAssistantActionOptions) =>
    ipcRenderer.invoke('floating-assistant:run-action', action, options),
  runFloatingMenuAction: (action: AssistantAction, options?: FloatingAssistantActionOptions) =>
    ipcRenderer.invoke('floating-menu:run-action', action, options) as Promise<void>,
  generateVideoNote: (manualTranscript?: string) =>
    ipcRenderer.invoke('floating-assistant:generate-video-note', manualTranscript),
  generateVideoNoteFromAudio: () =>
    ipcRenderer.invoke('floating-assistant:generate-video-note-from-audio') as Promise<VideoNote | null>,
  transcribeCurrentVideoAudio: (request: VideoAudioTranscriptionRequest) =>
    ipcRenderer.invoke('video-audio:transcribe-current', request) as Promise<VideoAudioTranscriptionResult>,
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
  scanOldFavorites: () => ipcRenderer.invoke('floating-assistant:scan-old-favorites'),
  executeOldFavoritePlan: (items: FavoriteLedgerPreviewItem[]) =>
    ipcRenderer.invoke('floating-assistant:execute-old-favorite-plan', items),
  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>,
  saveVideoNoteArchiveVersion: (note: VideoNote) =>
    ipcRenderer.invoke('video-note-archives:save-version', note) as Promise<VideoNoteArchiveEntry[]>,
  deleteVideoNoteArchiveEntry: (archiveId: string) =>
    ipcRenderer.invoke('video-note-archives:delete-entry', archiveId) as Promise<VideoNoteArchiveEntry[]>,
  deleteVideoNoteArchiveVersion: (archiveId: string, versionId: string) =>
    ipcRenderer.invoke(
      'video-note-archives:delete-version',
      archiveId,
      versionId
    ) as Promise<VideoNoteArchiveEntry[]>,
  setAssistantPetState: (state: AssistantPetState) =>
    ipcRenderer.send('assistant-pet:set-state', state),
  startFloatingSealDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:start-drag', screenX, screenY),
  startFloatingSealResize: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:start-resize', screenX, screenY),
  toggleFloatingAssistant: () => ipcRenderer.invoke('floating-assistant:toggle') as Promise<void>,
  toggleFloatingMenu: () => ipcRenderer.invoke('floating-menu:toggle') as Promise<void>
})
