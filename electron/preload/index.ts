import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  DeepSeekArchiveMode,
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
  FloatingAssistantWorkspaceRequest,
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type {
  AssistantPetHint,
  AssistantPetState
} from '../../src/renderer/src/features/assistant/petState'
import type {
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type {
  FavoriteRepositoryArchiveFullRestoreConfirmation,
  FavoriteRepositoryArchiveRestorePreview,
  FavoriteRepositoryArchiveRestoreScope,
  FavoriteLibraryUnfavoriteConfirmation,
  FavoriteLibraryUnfavoritePreview,
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositoryOrganizationChanges
} from '../main/favoriteRepositoryIpc'
import type {
  FavoriteRepositoryRevisionChange,
  FavoriteRepositorySnapshotSummary
} from '../main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../main/favoriteLibraryCommands'
import type { FavoriteRepositoryRestorePlan } from '../main/favoriteRepositoryArchiveService'
import type { FavoriteLibraryDrawerCommand } from '../main/favoriteLibraryEntryFlow'
import type { OldFavoriteWorkspaceDeepSeekResult, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceView } from '../../src/shared/oldFavoriteWorkspace'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  closeAssistantPet: () => ipcRenderer.send('assistant-pet:close'),
  closeFloatingAssistant: () => ipcRenderer.send('floating-assistant:close'),
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  openFavoriteLibrary: () => ipcRenderer.invoke('favorite-library:open') as Promise<void>,
  controlFavoriteLibraryWindow: (action: 'minimize' | 'toggle-maximize') => ipcRenderer.invoke('favorite-library:window-control', action) as Promise<void>,
  getFavoriteLibraryUiPreferences: (accountMid: string) => ipcRenderer.invoke('favorite-library:get-ui-preferences', accountMid) as Promise<Record<string, boolean>>,
  saveFavoriteLibraryUiPreferences: (accountMid: string, collapsedGroups: Record<string, boolean>) => ipcRenderer.invoke('favorite-library:save-ui-preferences', accountMid, collapsedGroups) as Promise<Record<string, boolean>>,
  openOldFavoriteWorkspaceV1: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:open', accountMid) as Promise<OldFavoriteWorkspaceView>,
  commandOldFavoriteWorkspaceV1: (accountMid: string, command: unknown) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:command', accountMid, command) as Promise<OldFavoriteWorkspaceView>,
  getOldFavoriteWorkspaceRecoverySummaryV1: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:recovery-summary', accountMid) as Promise<OldFavoriteWorkspaceRecoverySummary | null>,
  previewManagedFavoriteFolderDeletion: (accountMid: string, ledgerIds: string[]) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:managed-folder-deletion-preview', accountMid, ledgerIds) as Promise<Array<{ logicalLedgerId: string; remoteFolderId: string; title: string; memberCount: number }>>,
  deleteManagedFavoriteFolders: (accountMid: string, ledgerIds: string[]) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:delete-managed-folders', accountMid, ledgerIds) as Promise<Array<{ id: string; title: string; memberCount: number }>>,
  organizeOldFavoriteWorkspaceDeepSeekV1: (accountMid: string, mode: DeepSeekArchiveMode) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:deepseek-current-segment', accountMid, mode) as Promise<OldFavoriteWorkspaceDeepSeekResult>,
  retryOldFavoriteWorkspaceDeepSeekV1: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:retry-failed-deepseek', accountMid) as Promise<OldFavoriteWorkspaceDeepSeekResult>,
  onOldFavoriteWorkspaceDeepSeekProgress: (callback: (progress: {
    accountMid: string
    workspaceId: string
    totalChunks: number
    completedChunks: number
    totalVideoCount: number
    successfulVideoCount: number
    failedVideoCount: number
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      accountMid: string
      totalChunks: number
      completedChunks: number
      totalVideoCount: number
      successfulVideoCount: number
      failedVideoCount: number
    }) => callback(progress)
    ipcRenderer.on('old-favorite-workspace-v1:deepseek-progress', listener)
    return () => ipcRenderer.removeListener('old-favorite-workspace-v1:deepseek-progress', listener)
  },
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
  retryBilibiliSessionDirect: () => ipcRenderer.invoke('bilibili-session:retry-direct') as Promise<{ mode: 'auto' | 'direct'; effectiveMode: 'direct' | 'system'; temporaryDirect: boolean }>,
  readBilibiliAccountMid: () => ipcRenderer.invoke('bilibili:account-mid') as Promise<string>,
  readBilibiliAccount: () =>
    ipcRenderer.invoke('favorite-library:read-account') as Promise<{ mid: string; nickname?: string }>,
  openFavoriteLibraryVideo: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-library:open-video', accountMid, aid) as Promise<void>,
  openFavoriteLibrarySource: (accountMid: string, folderId: string) =>
    ipcRenderer.invoke('favorite-library:open-source', accountMid, folderId) as Promise<void>,
  resolveFavoriteLibraryArchive: (accountMid: string, aid: number, cid?: number) =>
    ipcRenderer.invoke('favorite-library:resolve-archive', accountMid, aid, cid) as Promise<{ archiveId: string; versionId: string }>,
  toggleFavoriteLibraryArchiveStar: (accountMid: string, aid: number, cid?: number) =>
    ipcRenderer.invoke('favorite-library:toggle-archive-star', accountMid, aid, cid) as Promise<void>,
  saveFavoriteLibraryArchiveMemo: (accountMid: string, aid: number, memo: string, cid?: number) =>
    ipcRenderer.invoke('favorite-library:save-archive-memo', accountMid, aid, memo, cid) as Promise<void>,
  onBilibiliAccountChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('bilibili:account-changed', listener)
    return () => ipcRenderer.removeListener('bilibili:account-changed', listener)
  },
  onBilibiliSessionReloadRequested: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('bilibili-session:reload-requested', listener)
    return () => ipcRenderer.removeListener('bilibili-session:reload-requested', listener)
  },
  onFavoriteLibraryTranscriptionChanged: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('favorite-library:transcription-changed', listener)
    return () => ipcRenderer.removeListener('favorite-library:transcription-changed', listener)
  },
  openFavoriteRepositoryAccount: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:open-account', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositorySnapshot: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:get-snapshot', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositoryFolderPage: (accountMid: string, folderId: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-folder-page', accountMid, folderId, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
  searchFavoriteRepositoryPage: (accountMid: string, query: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:search-page', accountMid, query, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
  getFavoriteRepositoryLibraryPage: (
    accountMid: string,
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' },
    options: { limit: number; cursor?: string }
  ) => ipcRenderer.invoke('favorite-repository:get-library-page', accountMid, scope, options) as Promise<FavoriteRepositoryLibraryPage>,
  getFavoriteRepositoryLibraryVideoDetail: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-detail', accountMid, aid) as Promise<FavoriteRepositoryLibraryVideoDetail>,
  getFavoriteRepositoryVideoEvents: (accountMid: string, aid: number, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-events', accountMid, aid, options) as Promise<import('../main/favoriteRepositoryIpc').FavoriteRepositoryEventPage>,
  getFavoriteRepositoryOrganizationChanges: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:get-organization-changes', accountMid) as Promise<FavoriteRepositoryOrganizationChanges>,
  getLocalDataInfo: () => ipcRenderer.invoke('local-data:get-info') as Promise<{ path: string; accounts: Array<{ uid: string; retained: boolean }> }>,
  calculateLocalDataUsage: () => ipcRenderer.invoke('local-data:calculate-usage') as Promise<{ totalBytes: number; calculatedAt: string }>,
  openLocalDataPath: () => ipcRenderer.invoke('local-data:open-path') as Promise<void>,
  exportLocalData: (input: { scope: 'current' | 'selected' | 'all'; includeSharedSettings: boolean }) =>
    ipcRenderer.invoke('local-data:export', input) as Promise<unknown>,
  previewLocalDataImport: () => ipcRenderer.invoke('local-data:preview-import') as Promise<{ accounts?: Array<{ uid: string; action: string }>; cancelled?: boolean }>,
  applyLocalDataImport: (preview: unknown, mode: 'merge' | 'overwrite') =>
    ipcRenderer.invoke('local-data:apply-import', preview, mode) as Promise<void>,
  previewLocalDataCleanup: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) =>
    ipcRenderer.invoke('local-data:preview-cleanup', level, uid, confirmation) as Promise<{ affectsBilibiliServerData: false }>,
  applyLocalDataCleanup: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) =>
    ipcRenderer.invoke('local-data:apply-cleanup', level, uid, confirmation) as Promise<void>,
  syncFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibrarySyncSelection) =>
    ipcRenderer.invoke('favorite-library:sync-selection', accountMid, selection) as Promise<FavoriteLibraryCommandResult>,
  setFavoriteLibraryLocalPlacements: (accountMid: string, placements: Array<{ aid: number; folderIds: string[] }>, expectedRevision: number, synchronize = false) =>
    ipcRenderer.invoke('favorite-library:set-local-placements', accountMid, placements, expectedRevision, synchronize) as Promise<FavoriteLibraryCommandResult>,
  adoptFavoriteLibraryRemotePlacement: (accountMid: string, aid: number, expectedRevision: number) =>
    ipcRenderer.invoke('favorite-library:adopt-remote-placement', accountMid, aid, expectedRevision) as Promise<FavoriteLibraryCommandResult>,
  deleteFavoriteLibraryVideo: (accountMid: string, aid: number, expectedRevision: number) =>
    ipcRenderer.invoke('favorite-library:delete-from-library', accountMid, aid, expectedRevision) as Promise<FavoriteLibraryCommandResult>,
  restoreFavoriteLibraryVideo: (accountMid: string, aid: number, expectedRevision: number) =>
    ipcRenderer.invoke('favorite-library:restore-to-library', accountMid, aid, expectedRevision) as Promise<FavoriteLibraryCommandResult>,
  forgetFavoriteLibraryTombstone: (accountMid: string, aid: number, expectedRevision: number) =>
    ipcRenderer.invoke('favorite-library:forget-tombstone', accountMid, aid, expectedRevision) as Promise<FavoriteLibraryCommandResult>,
  previewFavoriteLibraryBilibiliUnfavorite: (accountMid: string, aids: number[]) =>
    ipcRenderer.invoke('favorite-library:unfavorite-preview', accountMid, aids) as Promise<FavoriteLibraryUnfavoritePreview>,
  confirmFavoriteLibraryBilibiliUnfavorite: (accountMid: string, aids: number[], executionToken: string) =>
    ipcRenderer.invoke('favorite-library:unfavorite-confirm', accountMid, aids, executionToken) as Promise<FavoriteLibraryUnfavoriteConfirmation>,
  executeFavoriteLibraryBilibiliUnfavorite: (accountMid: string, aids: number[], executionToken: string, confirmationToken: string) =>
    ipcRenderer.invoke('favorite-library:execute-unfavorite', accountMid, aids, executionToken, confirmationToken) as Promise<FavoriteLibraryCommandResult>,
  exportFavoriteRepositoryArchive: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:archive-export', accountMid) as Promise<unknown>,
  previewFavoriteRepositoryArchiveImport: (accountMid: string, input: unknown) =>
    ipcRenderer.invoke('favorite-repository:archive-preview-import', accountMid, input) as Promise<unknown>,
  applyFavoriteRepositoryArchiveImport: (accountMid: string, input: unknown) =>
    ipcRenderer.invoke('favorite-repository:archive-apply-import', accountMid, input) as Promise<unknown>,
  createFavoriteRepositoryArchiveRestorePlan: (accountMid: string, input: unknown, mode: 'safe' | 'full', scope: FavoriteRepositoryArchiveRestoreScope) =>
    ipcRenderer.invoke('favorite-repository:archive-restore-plan', accountMid, input, mode, scope) as Promise<FavoriteRepositoryArchiveRestorePreview>,
  confirmFavoriteRepositoryArchiveFullRestore: (accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string) =>
    ipcRenderer.invoke('favorite-repository:archive-confirm-full-restore', accountMid, plan, executionToken) as Promise<FavoriteRepositoryArchiveFullRestoreConfirmation>,
  executeFavoriteRepositoryArchiveRestore: (
    accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string, fullConfirmationToken?: string
  ) => ipcRenderer.invoke(
    'favorite-repository:archive-execute-restore', accountMid, plan, executionToken, fullConfirmationToken
  ) as Promise<unknown>,
  reconcileFavoriteRepositoryArchiveRestore: (accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string) =>
    ipcRenderer.invoke('favorite-repository:archive-reconcile-restore', accountMid, plan, executionToken) as Promise<unknown>,
  enqueueFavoriteLibraryTranscription: (
    accountMid: string,
    input: { aids: number[]; summarizeWithDeepSeek?: boolean }
  ) => ipcRenderer.invoke('favorite-library:enqueue-transcription', accountMid, input) as Promise<FavoriteLibraryCommandResult>,
  commitFavoriteRepositoryCommand: (accountMid: string, command: FavoriteRepositoryCommand) =>
    ipcRenderer.invoke('favorite-repository:commit-command', accountMid, command) as Promise<FavoriteRepositoryCommandResult>,
  subscribeFavoriteRepository: (
    accountMid: string,
    folderId: string | undefined,
    callback: (change: FavoriteRepositoryRevisionChange) => void
  ) => {
    let subscriptionId: string | undefined
    let disposed = false
    const listener = (_event: Electron.IpcRendererEvent, change: FavoriteRepositoryRevisionChange) => {
      if (change.subscriptionId === subscriptionId) callback(change)
    }
    ipcRenderer.on('favorite-repository:revision-changed', listener)
    void ipcRenderer.invoke('favorite-repository:subscribe', accountMid, folderId)
      .then((id: string) => {
        subscriptionId = id
        if (disposed) void ipcRenderer.invoke('favorite-repository:unsubscribe', accountMid, id).catch(() => undefined)
      })
      .catch(() => {
        ipcRenderer.removeListener('favorite-repository:revision-changed', listener)
      })
    return () => {
      disposed = true
      ipcRenderer.removeListener('favorite-repository:revision-changed', listener)
      if (subscriptionId) void ipcRenderer.invoke('favorite-repository:unsubscribe', accountMid, subscriptionId).catch(() => undefined)
    }
  },
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
  onOpenFavoriteLibraryDrawer: (callback: (command: FavoriteLibraryDrawerCommand) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: FavoriteLibraryDrawerCommand) => callback(command)
    ipcRenderer.on('favorite-library:drawer-command', listener)
    return () => ipcRenderer.removeListener('favorite-library:drawer-command', listener)
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
    ipcRenderer.send('assistant-runtime:ready')

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

  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  patchPreferences: (patch: Partial<AssistantPreferences>) =>
    ipcRenderer.invoke('assistant:patch-preferences', patch) as Promise<AssistantPreferences>,
  restoreDefaultLayoutSize: () =>
    ipcRenderer.invoke('layout:restore-default-size') as Promise<void>,
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
  updateVideoNoteArchiveVersion: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    summaryText?: string
  ) =>
    ipcRenderer.invoke(
      'video-note-archives:update-version',
      archiveId,
      versionId,
      note,
      summaryText
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
