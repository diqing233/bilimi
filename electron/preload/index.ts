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
  OldFavoriteRuntimeSetResult,
  OldFavoriteRuntimeSnapshot,
  OldFavoriteSessionsState,
  OldFavoriteTaskKind,
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
  OldFavoriteBatchCommitResult
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type { OldFavoriteBatchCommitToken } from '../../src/renderer/src/features/favorites/favoriteLedgerApi'
import type { OldFavoriteBatchLifecycleSnapshot } from '../main/oldFavoriteSessionStore'
import type {
  AssistantPetHint,
  AssistantPetState
} from '../../src/renderer/src/features/assistant/petState'
import type { FavoriteLedgerPreviewItem } from '../../src/renderer/src/features/favorites/favoriteLedgerPreview'
import type { OldFavoriteAccountIndex, OldFavoriteBatchDetail, OldFavoriteOverlayKind, OldFavoriteOverlayPatch } from '../main/oldFavoriteWorkspaceTypes'
import type {
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type {
  FavoriteRepositoryRevisionChange,
  FavoriteRepositorySnapshotSummary
} from '../main/favoriteRepositoryIpc'

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
  getOldFavoriteRuntimeSnapshot: (key: string, initialValue: unknown) =>
    ipcRenderer.sendSync('old-favorite-runtime:get', key, initialValue) as OldFavoriteRuntimeSnapshot,
  setOldFavoriteRuntimeValue: (key: string, value: unknown, expectedRevision: number) =>
    ipcRenderer.sendSync(
      'old-favorite-runtime:set',
      key,
      value,
      expectedRevision
    ) as OldFavoriteRuntimeSetResult,
  setOldFavoriteRuntimeTransientValue: (key: string, value: unknown, expectedRevision: number) =>
    ipcRenderer.invoke(
      'old-favorite-runtime:set-transient',
      key,
      value,
      expectedRevision
    ) as Promise<OldFavoriteRuntimeSetResult>,
  bindOldFavoriteRuntimeAccount: (accountMid: string) =>
    ipcRenderer.sendSync('old-favorite-runtime:bind-account', accountMid) as boolean,
  readBilibiliAccountMid: () => ipcRenderer.invoke('bilibili:account-mid') as Promise<string>,
  openFavoriteRepositoryAccount: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:open-account', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositorySnapshot: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:get-snapshot', accountMid) as Promise<FavoriteRepositorySnapshotSummary>,
  getFavoriteRepositoryFolderPage: (accountMid: string, folderId: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-folder-page', accountMid, folderId, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
  searchFavoriteRepositoryPage: (accountMid: string, query: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:search-page', accountMid, query, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
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
  openOldFavoriteWorkspaceAccount: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace:open-account', accountMid) as Promise<OldFavoriteAccountIndex>,
  loadOldFavoriteWorkspaceBatch: (accountMid: string, batchId: string) =>
    ipcRenderer.invoke('old-favorite-workspace:load-batch', accountMid, batchId) as Promise<OldFavoriteBatchDetail>,
  recoverOldFavoriteWorkspaceBatch: (accountMid: string, batchId: string) =>
    ipcRenderer.invoke('old-favorite-workspace:recover-batch', accountMid, batchId) as Promise<{ discardedTail: string | null }>,
  createOldFavoriteWorkspaceBatch: (input: { accountMid: string; kind: 'full' | 'incremental'; createdAt?: string; id?: string }) =>
    ipcRenderer.invoke('old-favorite-workspace:create-batch', input),
  appendOldFavoriteWorkspaceChunk: (accountMid: string, batchId: string, kind: 'base' | 'tags' | 'sources', items: unknown[]) =>
    ipcRenderer.invoke('old-favorite-workspace:append-chunk', accountMid, batchId, kind, items),
  appendOldFavoriteWorkspaceChunkGroup: (accountMid: string, batchId: string, chunks: Record<'base' | 'tags' | 'sources', unknown[]>) =>
    ipcRenderer.invoke('old-favorite-workspace:append-chunk-group', accountMid, batchId, chunks),
  patchOldFavoriteWorkspaceOverlay: (accountMid: string, batchId: string, kind: OldFavoriteOverlayKind, patch: OldFavoriteOverlayPatch | OldFavoriteOverlayPatch[]) =>
    ipcRenderer.invoke('old-favorite-workspace:patch-overlay', accountMid, batchId, kind, patch),
  markOldFavoriteWorkspaceOverlayDirty: () =>
    ipcRenderer.sendSync('old-favorite-workspace:renderer-dirty') as boolean,
  markOldFavoriteWorkspaceOverlayClean: () =>
    ipcRenderer.sendSync('old-favorite-workspace:renderer-clean') as boolean,
  onOldFavoriteWorkspaceFlushRequested: (callback: () => Promise<void>) => {
    const listener = async (_event: Electron.IpcRendererEvent, requestId: string) => {
      try {
        await callback()
        ipcRenderer.send('old-favorite-workspace:renderer-flushed', requestId, true)
      } catch {
        ipcRenderer.send('old-favorite-workspace:renderer-flushed', requestId, false)
      }
    }
    ipcRenderer.on('old-favorite-workspace:flush-requested', listener)
    return () => ipcRenderer.removeListener('old-favorite-workspace:flush-requested', listener)
  },
  finalizeOldFavoriteWorkspaceBatch: (accountMid: string, batchId: string) =>
    ipcRenderer.invoke('old-favorite-workspace:finalize-batch', accountMid, batchId),
  resetOldFavoriteWorkspaceAccount: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace:reset-account', accountMid),
  resetOldFavoriteAccount: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-account:reset', accountMid),
  resetOldFavoriteRuntime: () =>
    ipcRenderer.sendSync('old-favorite-runtime:reset') as boolean,
  resetOldFavoriteRuntimeAccount: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-runtime:reset-account', accountMid) as Promise<boolean>,
  loadOldFavoriteSessions: () =>
    ipcRenderer.invoke('old-favorite-sessions:load') as Promise<OldFavoriteSessionsState>,
  beginOldFavoriteFullScan: (accountMid: string, now: string, snapshot?: OldFavoriteSessionsState['batches'][number]['snapshot']) =>
    ipcRenderer.invoke('old-favorite-sessions:begin-full-scan', accountMid, now, snapshot) as Promise<{
      batch: OldFavoriteSessionsState['batches'][number]
      acquired: boolean
    }>,
  beginOldFavoriteIncrementalScan: (accountMid: string, now: string, snapshot?: OldFavoriteSessionsState['batches'][number]['snapshot']) =>
    ipcRenderer.invoke('old-favorite-sessions:begin-incremental-scan', accountMid, now, snapshot) as Promise<{
      batch: OldFavoriteSessionsState['batches'][number]
      acquired: boolean
    }>,
  endOldFavoriteBatch: (batchId: string, endedAt: string) =>
    ipcRenderer.invoke('old-favorite-sessions:end-batch', batchId, endedAt) as Promise<OldFavoriteBatchLifecycleSnapshot>,
  discardOldFavoriteEmptyIncrementalBatch: (batchId: string, accountMid: string) =>
    ipcRenderer.invoke('old-favorite-sessions:discard-empty-incremental', batchId, accountMid) as Promise<{
      batchId: string
      accountMid: string
      discarded: true
    }>,
  saveOldFavoriteSessions: (state: OldFavoriteSessionsState) =>
    ipcRenderer.invoke('old-favorite-sessions:save', state) as Promise<OldFavoriteSessionsState>,
  resetOldFavoriteSessionsAccount: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-sessions:reset-account', accountMid) as Promise<OldFavoriteSessionsState>,
  claimOldFavoriteTaskLease: (
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string
  ) => ipcRenderer.invoke(
    'old-favorite-sessions:claim-lease',
    batchId,
    segmentId,
    task,
    accountMid
  ) as Promise<boolean>,
  releaseOldFavoriteTaskLease: (batchId: string, segmentId: string) =>
    ipcRenderer.invoke('old-favorite-sessions:release-lease', batchId, segmentId) as Promise<boolean>,
  onOldFavoriteSessionsChanged: (callback: (state: OldFavoriteSessionsState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: OldFavoriteSessionsState) => callback(state)
    ipcRenderer.on('old-favorite-sessions:changed', listener)
    return () => ipcRenderer.removeListener('old-favorite-sessions:changed', listener)
  },
  setOldFavoriteBackgroundRunning: (running: boolean) =>
    ipcRenderer.send('old-favorite-background:set-running', running),
  setOldFavoriteBackgroundTarget: (webContentsId: number) =>
    ipcRenderer.send('old-favorite-background:set-target', webContentsId),
  retryBilibiliSessionDirect: () =>
    ipcRenderer.invoke('bilibili-session:retry-direct') as Promise<{ mode: 'direct' }>,
  onOldFavoriteRuntimeChanged: (
    callback: (snapshot: OldFavoriteRuntimeSnapshot | { type: 'reset'; accountMid: string }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      snapshot: OldFavoriteRuntimeSnapshot | { type: 'reset'; accountMid: string }
    ) => callback(snapshot)

    ipcRenderer.on('old-favorite-runtime:changed', listener)
    return () => ipcRenderer.removeListener('old-favorite-runtime:changed', listener)
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
  scanOldFavorites: (options?: {
    multiArchiveMode?: AssistantPreferences['favoriteArchiveMultiMode']
  }) => ipcRenderer.invoke('floating-assistant:scan-old-favorites', options),
  commitOldFavoriteBatchCheckpoint: (token: OldFavoriteBatchCommitToken) =>
    ipcRenderer.invoke(
      'floating-assistant:commit-old-favorite-batch',
      token
    ) as Promise<OldFavoriteBatchCommitResult>,
  readOldFavoriteBatchStatus: () =>
    ipcRenderer.invoke('floating-assistant:read-old-favorite-batch-status') as Promise<{
      pending: boolean
    }>,
  prepareOldFavoriteScan: () =>
    ipcRenderer.invoke('floating-assistant:prepare-old-favorite-scan') as Promise<AssistantAutomationResult>,
  readOldFavoriteTagEnrichment: (action: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan' = 'read') =>
    ipcRenderer.invoke('floating-assistant:old-favorite-tag-enrichment', action),
  rejudgeOldFavorite: (item: FavoriteLedgerPreviewItem) =>
    ipcRenderer.invoke('floating-assistant:rejudge-old-favorite', item) as Promise<FavoriteLedgerPreviewItem>,
  executeOldFavoritePlan: (items: FavoriteLedgerPreviewItem[], expectedAccountMid?: string) =>
    ipcRenderer.invoke('floating-assistant:execute-old-favorite-plan', items, expectedAccountMid),
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
