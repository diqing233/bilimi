import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferencePatchMeta,
  AssistantPreferences,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  DeepSeekArchiveMode,
  DeepSeekArchiveScope,
  FavoriteLedger,
  FavoriteLedgerEnabledPatch,
  FavoriteLedgerSaveOptions,
  StartupDiagnosticReport,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  TranscriptionModelId,
  TranscriptionModelInstallation,
  TranscriptionModelInstallProgress,
  TranscriptionGpuProbe,
  VideoNote,
  VideoNoteArchiveEntry,
  VideoNoteSourceMetadata
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
import type { MultipartVideoSnapshot } from '../../src/renderer/src/features/notes/videoNoteMultipart'
import type {
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryConfirmedReviewInput,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '../../src/shared/favoriteRepository'
import type {
  FavoriteRepositoryArchiveFullRestoreConfirmation,
  FavoriteRepositoryArchiveRestorePreview,
  FavoriteRepositoryArchiveRestoreScope,
  FavoriteRepositoryLibraryPage,
  FavoriteRepositoryLibraryPageOptions,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositoryOrganizationChanges
} from '../main/favoriteRepositoryIpc'
import type {
  FavoriteRepositoryRevisionChange,
  FavoriteRepositorySnapshotSummary
} from '../main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../main/favoriteLibraryCommands'
import type { FavoriteRepositoryRestorePlan } from '../main/favoriteRepositoryArchiveService'
import type { ManagedFavoriteRemoteFolderDeletionResult } from '../main/favoriteRepositorySyncService'
import type { FavoriteLibraryDrawerCommand } from '../main/favoriteLibraryEntryFlow'
import type { FavoriteLibraryOperationSource } from '../../src/shared/favoriteLibraryOperations'
import type {
  VideoNoteBatchExportPreview,
  VideoNoteBatchExportProgress,
  VideoNoteBatchExportRequest,
  VideoNoteBatchExportResult,
  VideoNoteBatchExportStartRequest,
  VideoNoteBatchFolderRequest
} from '../../src/shared/videoNoteBatchExport'

type FavoriteLibraryOperationSelection = number[] | {
  kind: 'scope'
  scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' }
  options: { query?: string; filter?: 'all' | 'pending' | 'protected' | 'unsynced'; sort?: 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'; transcriptionFilters?: Array<'completed' | 'none' | 'pending' | 'running' | 'failed'> }
  excludedAids: number[]
}
type FavoriteLibraryDocumentExportSelection = Exclude<FavoriteLibraryOperationSelection, number[]> | { kind: 'aids'; aids: number[] }
import type { OldFavoriteWorkspaceDeepSeekProcessedItem, OldFavoriteWorkspaceDeepSeekResult, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceView } from '../../src/shared/oldFavoriteWorkspace'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  closeAssistantPet: () => ipcRenderer.send('assistant-pet:close'),
  closeFloatingAssistant: () => ipcRenderer.send('floating-assistant:close'),
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  getMainWindowPresentationState: () => ipcRenderer.invoke('main-window:presentation-state') as Promise<{ visible: boolean; minimized: boolean }>,
  openFavoriteLibrary: () => ipcRenderer.invoke('favorite-library:open') as Promise<void>,
  controlFavoriteLibraryWindow: (action: 'minimize' | 'expand-and-maximize') => ipcRenderer.invoke('favorite-library:window-control', action) as Promise<void>,
  getFavoriteLibraryUiPreferences: (accountMid: string) => ipcRenderer.invoke('favorite-library:get-ui-preferences', accountMid) as Promise<Record<string, boolean>>,
  saveFavoriteLibraryUiPreferences: (accountMid: string, collapsedGroups: Record<string, boolean>) => ipcRenderer.invoke('favorite-library:save-ui-preferences', accountMid, collapsedGroups) as Promise<Record<string, boolean>>,
  openOldFavoriteWorkspaceV1: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:open', accountMid) as Promise<OldFavoriteWorkspaceView>,
  commandOldFavoriteWorkspaceV1: (accountMid: string, command: unknown) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:command', accountMid, command) as Promise<OldFavoriteWorkspaceView>,
  prepareOldFavoriteWorkspaceRecoveryV1: (accountMid: string) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:prepare-recovery', accountMid) as Promise<OldFavoriteWorkspaceRecoverySummary | null>,
  previewManagedFavoriteFolderDeletion: (accountMid: string, ledgerIds: string[], ledgerTitleHints?: Record<string, string>, remoteDraftTargets?: Record<string, { remoteFolderId: string; title: string }>) =>
    (remoteDraftTargets
      ? ipcRenderer.invoke('old-favorite-workspace-v1:managed-folder-deletion-preview', accountMid, ledgerIds, ledgerTitleHints, remoteDraftTargets)
      : ipcRenderer.invoke('old-favorite-workspace-v1:managed-folder-deletion-preview', accountMid, ledgerIds, ledgerTitleHints)) as Promise<Array<{ logicalLedgerId: string; remoteFolderId?: string; title: string; memberCount: number; state: string; requiresUnboundAcknowledgement: boolean }>>,
  deleteManagedFavoriteFolders: (accountMid: string, ledgerIds: string[], acknowledgeUnboundRemoteDeletion = false, ledgerTitleHints?: Record<string, string>, expectedRemoteFolderIds?: Record<string, string[]>) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:delete-managed-folders', accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds) as Promise<ManagedFavoriteRemoteFolderDeletionResult>,
  deleteManagedRemoteFolders: (accountMid: string, ledgerIds: string[], acknowledgeUnboundRemoteDeletion = false, ledgerTitleHints?: Record<string, string>, expectedRemoteFolderIds?: Record<string, string[]>, remoteDraftTargets?: Record<string, { remoteFolderId: string; title: string }>) =>
    (remoteDraftTargets
      ? ipcRenderer.invoke('old-favorite-workspace-v1:delete-managed-remote-folders', accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds, remoteDraftTargets)
      : ipcRenderer.invoke('old-favorite-workspace-v1:delete-managed-remote-folders', accountMid, ledgerIds, acknowledgeUnboundRemoteDeletion, ledgerTitleHints, expectedRemoteFolderIds)) as Promise<ManagedFavoriteRemoteFolderDeletionResult>,
  organizeOldFavoriteWorkspaceDeepSeekV1: (accountMid: string, mode: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope) =>
    ipcRenderer.invoke('old-favorite-workspace-v1:deepseek-current-segment', accountMid, mode, scope) as Promise<OldFavoriteWorkspaceDeepSeekResult>,
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
    processedItems?: OldFavoriteWorkspaceDeepSeekProcessedItem[]
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      accountMid: string
      workspaceId: string
      totalChunks: number
      completedChunks: number
      totalVideoCount: number
      successfulVideoCount: number
      failedVideoCount: number
      processedItems?: OldFavoriteWorkspaceDeepSeekProcessedItem[]
    }) => callback(progress)
    ipcRenderer.on('old-favorite-workspace-v1:deepseek-progress', listener)
    return () => ipcRenderer.removeListener('old-favorite-workspace-v1:deepseek-progress', listener)
  },
  onOldFavoriteWorkspacePreviewPreparationProgress: (callback: (progress: {
    accountMid: string
    workspaceId: string
    completedItemCount: number
    totalItemCount: number
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      accountMid: string
      workspaceId: string
      completedItemCount: number
      totalItemCount: number
    }) => callback(progress)
    ipcRenderer.on('old-favorite-workspace-v1:preview-preparation-progress', listener)
    return () => ipcRenderer.removeListener('old-favorite-workspace-v1:preview-preparation-progress', listener)
  },
  onOldFavoriteWorkspaceRuleAnalysisProgress: (callback: (progress: {
    accountMid: string
    workspaceId: string
    analysisId: string
    completedItemCount: number
    totalItemCount: number
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      accountMid: string
      workspaceId: string
      analysisId: string
      completedItemCount: number
      totalItemCount: number
    }) => callback(progress)
    ipcRenderer.on('old-favorite-workspace-v1:rule-analysis-progress', listener)
    return () => ipcRenderer.removeListener('old-favorite-workspace-v1:rule-analysis-progress', listener)
  },
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke('clipboard:write-text', text) as Promise<void>,
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadAssistantSidebarWidth: () =>
    ipcRenderer.invoke('layout:assistant-sidebar-width-load') as Promise<number | null>,
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
  adoptFavoriteRepositoryLedgerBinding: (accountMid: string, input: { logicalLedgerId: string; logicalTitle: string; remoteFolderId: string; remoteTitle: string; shardNumber?: number; allowRemoteRename?: boolean }) =>
    ipcRenderer.invoke('favorite-repository:adopt-ledger-binding', accountMid, input) as Promise<unknown>,
  previewFavoriteRepositoryLedgerBindingCandidates: (accountMid: string, ledgers: Array<{ ledgerId: string; title: string }>) =>
    ipcRenderer.invoke('favorite-repository:preview-ledger-binding-candidates', accountMid, ledgers) as Promise<Array<{
      ledgerId: string
      candidates: Array<{ id: string; title: string; memberCount: number }>
    }>>,
  getFavoriteRepositoryFolderPage: (accountMid: string, folderId: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-folder-page', accountMid, folderId, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
  searchFavoriteRepositoryPage: (accountMid: string, query: string, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:search-page', accountMid, query, options) as Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>,
  getFavoriteRepositoryLibraryPage: (
    accountMid: string,
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' },
    options: FavoriteRepositoryLibraryPageOptions
  ) => ipcRenderer.invoke('favorite-repository:get-library-page', accountMid, scope, options) as Promise<FavoriteRepositoryLibraryPage>,
  getFavoriteRepositoryLibraryVideoDetail: (accountMid: string, aid: number) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-detail', accountMid, aid) as Promise<FavoriteRepositoryLibraryVideoDetail>,
  getFavoriteRepositoryVideoEvents: (accountMid: string, aid: number, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-events', accountMid, aid, options) as Promise<import('../main/favoriteRepositoryIpc').FavoriteRepositoryEventPage>,
  getFavoriteRepositoryClassificationAdjustments: (accountMid: string, aid: number, options: { limit: number; cursor?: string }) =>
    ipcRenderer.invoke('favorite-repository:get-library-video-classification-adjustments', accountMid, aid, options) as Promise<import('../main/favoriteRepositoryIpc').FavoriteRepositoryClassificationAdjustmentPage>,
  getFavoriteRepositoryOrganizationChanges: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:get-organization-changes', accountMid) as Promise<FavoriteRepositoryOrganizationChanges>,
  getLocalDataInfo: () => ipcRenderer.invoke('local-data:get-info') as Promise<{ path: string; accounts: Array<{ uid: string; nickname?: string; retained: boolean }> }>,
  calculateLocalDataUsage: () => ipcRenderer.invoke('local-data:calculate-usage') as Promise<{
    totalBytes: number; calculatedAt: string
    categories: Record<'accountPersistent' | 'deviceShared' | 'cache' | 'temporaryAudio' | 'logs', { bytes: number }>
  }>,
  openLocalDataPath: () => ipcRenderer.invoke('local-data:open-path') as Promise<void>,
  exportLocalData: (input: { scope: 'current' | 'selected' | 'all'; uids?: string[] }) =>
    ipcRenderer.invoke('local-data:export', input) as Promise<unknown>,
  previewLocalDataImport: () => ipcRenderer.invoke('local-data:preview-import') as Promise<{ token?: string; accounts?: Array<{ uid: string; action: string }>; cancelled?: boolean }>,
  applyLocalDataImport: (previewToken: string, mode: 'merge' | 'overwrite') =>
    ipcRenderer.invoke('local-data:apply-import', previewToken, mode) as Promise<void>,
  previewLocalDataCleanup: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) =>
    ipcRenderer.invoke('local-data:preview-cleanup', level, uid, confirmation) as Promise<{ affectsBilibiliServerData: false; releasableBytes: number }>,
  applyLocalDataCleanup: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) =>
    ipcRenderer.invoke('local-data:apply-cleanup', level, uid, confirmation) as Promise<void>,
  onLocalDataReset: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('local-data:reset', listener)
    return () => ipcRenderer.removeListener('local-data:reset', listener)
  },
  onFavoriteRepositoryAccountDataCleared: (callback: (accountMid: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, accountMid: unknown) => {
      if (typeof accountMid === 'string') callback(accountMid)
    }
    ipcRenderer.on('favorite-library:account-data-cleared', listener)
    return () => ipcRenderer.removeListener('favorite-library:account-data-cleared', listener)
  },
  copyFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibraryOperationSelection, targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) =>
    ipcRenderer.invoke('favorite-library-operations:copy', accountMid, selection, targetFolderIds, expectedRevision, source) as Promise<FavoriteLibraryCommandResult>,
  moveFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibraryOperationSelection, sourceFolderId: string, targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) =>
    ipcRenderer.invoke('favorite-library-operations:move', accountMid, selection, sourceFolderId, targetFolderIds, expectedRevision, source) as Promise<FavoriteLibraryCommandResult>,
  deleteFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibraryOperationSelection, expectedRevision: number, source: FavoriteLibraryOperationSource) =>
    ipcRenderer.invoke('favorite-library-operations:delete-local', accountMid, selection, expectedRevision, source) as Promise<FavoriteLibraryCommandResult>,
  reconcileFavoriteLibraryRemoteUnfavoriteOperation: (accountMid: string, operationId: string) =>
    ipcRenderer.invoke('favorite-library-operations:reconcile-unfavorite', accountMid, operationId) as Promise<unknown>,
  previewFavoriteLibraryManagedPlacementRemoval: (accountMid: string, selection: FavoriteLibraryOperationSelection, logicalFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) =>
    ipcRenderer.invoke('favorite-library-operations:preview-managed-placement-removal', accountMid, selection, logicalFolderIds, expectedRevision, source) as Promise<unknown>,
  confirmFavoriteLibraryManagedPlacementRemoval: (accountMid: string, executionToken: string) =>
    ipcRenderer.invoke('favorite-library-operations:confirm-managed-placement-removal', accountMid, executionToken) as Promise<{ confirmationToken: string }>,
  executeFavoriteLibraryManagedPlacementRemoval: (accountMid: string, executionToken: string, confirmationToken: string) =>
    ipcRenderer.invoke('favorite-library-operations:execute-managed-placement-removal', accountMid, executionToken, confirmationToken) as Promise<unknown>,
  reconcileFavoriteLibraryManagedPlacementRemoval: (accountMid: string, operationId: string) =>
    ipcRenderer.invoke('favorite-library-operations:reconcile-managed-placement-removal', accountMid, operationId) as Promise<unknown>,
  previewFavoriteLibraryManagedFolderDelete: (accountMid: string, folderId: string) =>
    ipcRenderer.invoke('favorite-library-operations:preview-managed-folder-delete', accountMid, folderId) as Promise<unknown>,
  previewFavoriteLibraryManagedFolderGroupDelete: (accountMid: string) =>
    ipcRenderer.invoke('favorite-library-operations:preview-managed-folder-group-delete', accountMid) as Promise<unknown>,
  deleteFavoriteLibraryManagedFolderLocal: (accountMid: string, executionToken: string) =>
    ipcRenderer.invoke('favorite-library-operations:delete-managed-folder-local', accountMid, executionToken) as Promise<unknown>,
  deleteFavoriteLibraryManagedFoldersLocal: (accountMid: string, executionTokens: string[]) =>
    ipcRenderer.invoke('favorite-library-operations:delete-managed-folders-local', accountMid, executionTokens) as Promise<unknown>,
  confirmFavoriteLibraryManagedFolderRemoteDelete: (accountMid: string, executionToken: string) =>
    ipcRenderer.invoke('favorite-library-operations:confirm-managed-folder-remote-delete', accountMid, executionToken) as Promise<{ confirmationToken: string }>,
  executeFavoriteLibraryManagedFolderRemoteDelete: (accountMid: string, executionToken: string, confirmationToken: string) =>
    ipcRenderer.invoke('favorite-library-operations:execute-managed-folder-remote-delete', accountMid, executionToken, confirmationToken) as Promise<unknown>,
  reconcileFavoriteLibraryManagedFolderDelete: (accountMid: string, operationId: string) =>
    ipcRenderer.invoke('favorite-library-operations:reconcile-managed-folder-delete', accountMid, operationId) as Promise<unknown>,
  getFavoriteLedgerRemoteDraftReminderDismissals: (accountMid: string) =>
    ipcRenderer.invoke('favorite-repository:get-remote-draft-reminder-dismissals', accountMid) as Promise<string[]>,
  dismissFavoriteLedgerRemoteDraftReminder: (accountMid: string, remoteFolderId: string) =>
    ipcRenderer.invoke('favorite-repository:dismiss-remote-draft-reminder', accountMid, remoteFolderId) as Promise<unknown>,
  syncFavoriteLibrarySelection: (accountMid: string, selection: FavoriteLibrarySyncSelection | FavoriteLibraryOperationSelection) =>
    ipcRenderer.invoke('favorite-library:sync-selection', accountMid, selection) as Promise<FavoriteLibraryCommandResult>,
  synchronizeFavoriteLibraryPlacements: (accountMid: string, selection: FavoriteLibrarySyncSelection | FavoriteLibraryOperationSelection) =>
    ipcRenderer.invoke('favorite-library:synchronize-placements', accountMid, selection) as Promise<FavoriteLibraryCommandResult>,
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
  clearRecycledFavoriteLibraryVideo: (accountMid: string, aid: number, expectedRevision: number) =>
    ipcRenderer.invoke('favorite-library:clear-recycled', accountMid, aid, expectedRevision) as Promise<FavoriteLibraryCommandResult>,
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
    input: { aids: number[]; summarizeWithDeepSeek?: boolean } | { targets: Array<{ aid: number; cid?: number }>; summarizeWithDeepSeek?: boolean } | (Exclude<FavoriteLibraryOperationSelection, number[]> & { summarizeWithDeepSeek?: boolean })
  ) => ipcRenderer.invoke('favorite-library:enqueue-transcription', accountMid, input) as Promise<FavoriteLibraryCommandResult>,
  cancelFavoriteLibraryWaitingTranscription: (
    accountMid: string,
    input: { aids: number[] } | { targets: Array<{ aid: number; cid?: number }> } | FavoriteLibraryOperationSelection
  ) => ipcRenderer.invoke('favorite-library:cancel-waiting-transcription', accountMid, input) as Promise<FavoriteLibraryCommandResult>,
  resolveFavoriteLibraryDocumentExportSelection: (accountMid: string, selection: FavoriteLibraryDocumentExportSelection) =>
    ipcRenderer.invoke('favorite-library:resolve-document-export-selection', accountMid, selection) as Promise<{ selections: Array<{ archiveId: string; versionId: string }>; skippedAids: number[] }>,
  commitFavoriteRepositoryCommand: (accountMid: string, command: FavoriteRepositoryCommand) =>
    ipcRenderer.invoke('favorite-repository:commit-command', accountMid, command) as Promise<FavoriteRepositoryCommandResult>,
  commitConfirmedFavoriteReview: (accountMid: string, input: FavoriteRepositoryConfirmedReviewInput) =>
    ipcRenderer.invoke('favorite-repository:commit-confirmed-review', accountMid, input) as Promise<FavoriteRepositoryCommandResult>,
  checkpointConfirmedFavoriteReview: (accountMid: string, input: FavoriteRepositoryConfirmedReviewInput) =>
    ipcRenderer.invoke('favorite-repository:checkpoint-confirmed-review', accountMid, input) as Promise<void>,
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
  onAssistantPreferencePatchChanged: (callback: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => callback(patch, meta)
    ipcRenderer.on('assistant:preferences-patch-changed', listener)
    return () => ipcRenderer.removeListener('assistant:preferences-patch-changed', listener)
  },
  onAssistantSidebarWidthChanged: (callback: (widthPx: number | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, widthPx: number | null) => callback(widthPx)
    ipcRenderer.on('layout:assistant-sidebar-width-changed', listener)
    return () => ipcRenderer.removeListener('layout:assistant-sidebar-width-changed', listener)
  },
  onFavoriteLedgerEnabledChanged: (callback: (patch: FavoriteLedgerEnabledPatch, meta?: AssistantPreferencePatchMeta) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, patch: FavoriteLedgerEnabledPatch, meta?: AssistantPreferencePatchMeta) => callback(patch, meta)
    ipcRenderer.on('assistant:favorite-ledger-enabled-changed', listener)
    return () => ipcRenderer.removeListener('assistant:favorite-ledger-enabled-changed', listener)
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
  openVideoNoteArchiveSource: (source: VideoNoteSourceMetadata, seconds?: number) =>
    ipcRenderer.invoke('video-note-archives:open-source', source, seconds) as Promise<void>,
  onOpenVideoNoteArchiveSource: (callback: (request: { url: string; seconds?: number; aid?: number; cid?: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { url?: unknown; seconds?: unknown; aid?: unknown; cid?: unknown }) => {
      if (typeof request?.url !== 'string') return
      callback({
        url: request.url,
        ...(typeof request.seconds === 'number' && Number.isFinite(request.seconds) && request.seconds >= 0
          ? { seconds: request.seconds }
          : {}),
        ...(typeof request.aid === 'number' && Number.isSafeInteger(request.aid) ? { aid: request.aid } : {}),
        ...(typeof request.cid === 'number' && Number.isSafeInteger(request.cid) ? { cid: request.cid } : {})
      })
    }
    ipcRenderer.on('video-note-archives:open-source', listener)
    return () => ipcRenderer.removeListener('video-note-archives:open-source', listener)
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
  readCurrentVideoMultipart: () =>
    ipcRenderer.invoke('floating-assistant:read-current-video-multipart') as Promise<MultipartVideoSnapshot | null>,
  transcribeCurrentVideoAudio: (request: VideoAudioTranscriptionRequest) =>
    ipcRenderer.invoke('video-audio:transcribe-current', request) as Promise<VideoAudioTranscriptionResult>,
  loadTranscriptionModels: () =>
    ipcRenderer.invoke('video-audio:transcription-models-list') as Promise<TranscriptionModelInstallation[]>,
  loadCurrentTranscriptionModelInstallProgress: () =>
    ipcRenderer.invoke('video-audio:transcription-model-progress-current') as Promise<TranscriptionModelInstallProgress | undefined>,
  probeTranscriptionModelGpu: (id: TranscriptionModelId) =>
    ipcRenderer.invoke('video-audio:transcription-model-gpu-probe', id) as Promise<TranscriptionGpuProbe>,
  installTranscriptionModel: (id: TranscriptionModelId, options?: { restart?: boolean }) =>
    ipcRenderer.invoke('video-audio:transcription-model-install', id, options) as Promise<TranscriptionModelInstallation[]>,
  cancelTranscriptionModelInstall: (id: TranscriptionModelId) =>
    ipcRenderer.invoke('video-audio:transcription-model-install-cancel', id) as Promise<TranscriptionModelInstallation[]>,
  importTranscriptionModel: (id: TranscriptionModelId) =>
    ipcRenderer.invoke('video-audio:transcription-model-import', id) as Promise<TranscriptionModelInstallation[]>,
  migrateLegacyWhisperSmall: () =>
    ipcRenderer.invoke('video-audio:transcription-model-migrate-legacy-whisper') as Promise<TranscriptionModelInstallation[]>,
  revalidateTranscriptionModel: (id: TranscriptionModelId) =>
    ipcRenderer.invoke('video-audio:transcription-model-revalidate', id) as Promise<TranscriptionModelInstallation[]>,
  deleteTranscriptionModel: (id: TranscriptionModelId) =>
    ipcRenderer.invoke('video-audio:transcription-model-delete', id) as Promise<TranscriptionModelInstallation[]>,
  onTranscriptionModelInstallProgress: (callback: (value: TranscriptionModelInstallProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: TranscriptionModelInstallProgress) => callback(value)
    ipcRenderer.on('video-audio:transcription-model-progress', listener)
    return () => ipcRenderer.removeListener('video-audio:transcription-model-progress', listener)
  },
  loadVideoAudioTranscriptionQueue: () =>
    ipcRenderer.invoke('video-audio:transcription-queue-load') as Promise<VideoAudioTranscriptionQueueSnapshot>,
  enqueueVideoAudioTranscription: (request: VideoAudioTranscriptionRequest) =>
    ipcRenderer.invoke(
      'video-audio:transcription-queue-enqueue',
      request
    ) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  cancelVideoAudioTranscription: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-cancel', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  cancelVideoAudioTranscriptionSummary: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-cancel-summary', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  retryVideoAudioTranscription: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-retry', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  retryVideoAudioTranscriptionOnCpu: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-retry-cpu', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  retryVideoAudioArchiveRegistration: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-retry-archive-registration', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  retryVideoAudioSummary: (id: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-retry-summary', id) as Promise<VideoAudioTranscriptionQueueSnapshot>,
  cancelWaitingVideoAudioTranscriptions: (ids: string[]) =>
    ipcRenderer.invoke('video-audio:transcription-queue-batch-cancel-waiting', ids) as Promise<import('../main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>,
  retryVideoAudioTranscriptions: (ids: string[]) =>
    ipcRenderer.invoke('video-audio:transcription-queue-batch-retry', ids) as Promise<import('../main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>,
  removeVideoAudioTranscriptions: (ids: string[]) =>
    ipcRenderer.invoke('video-audio:transcription-queue-batch-remove', ids) as Promise<import('../main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>,
  previewStopVideoAudioTranscriptions: (ids: string[]) =>
    ipcRenderer.invoke('video-audio:transcription-queue-batch-stop-preview', ids) as Promise<{ confirmationToken: string; runningCount: number }>,
  stopVideoAudioTranscriptions: (ids: string[], confirmationToken: string) =>
    ipcRenderer.invoke('video-audio:transcription-queue-batch-stop', ids, confirmationToken) as Promise<import('../main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>,
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
  ensureFavoriteLedger: (logicalFolderId: string, options?: FavoriteLedgerSaveOptions) => ipcRenderer.invoke('floating-assistant:ensure-ledger', logicalFolderId, options),
  saveFavoriteLedgers: (ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) =>
    ipcRenderer.invoke('floating-assistant:save-ledgers', ledgers, options),
  openBilibiliFavorites: () => ipcRenderer.invoke('floating-assistant:open-bilibili-favorites'),

  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  patchPreferences: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) =>
    ipcRenderer.invoke('assistant:patch-preferences', patch, meta) as Promise<AssistantPreferences>,
  saveAssistantSidebarWidth: (widthPx: number | null) =>
    ipcRenderer.invoke('layout:assistant-sidebar-width-save', widthPx) as Promise<number | null>,
  writePreferencePatch: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) =>
    ipcRenderer.invoke('assistant:write-preference-patch', patch, meta) as Promise<Partial<AssistantPreferences>>,
  writeFavoriteLedgerEnabled: (accountMid: string, ledgerId: string, enabled: boolean, meta?: AssistantPreferencePatchMeta) =>
    ipcRenderer.invoke('assistant:write-favorite-ledger-enabled', accountMid, ledgerId, enabled, meta) as Promise<FavoriteLedgerEnabledPatch>,
  deleteFavoriteLedgerDraft: (accountMid: string, ledgerId: string) =>
    ipcRenderer.invoke('assistant:delete-favorite-ledger-draft', accountMid, ledgerId) as Promise<{ status: 'succeeded'; ledgerId: string }>,
  deleteFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[]) =>
    ipcRenderer.invoke('assistant:delete-favorite-ledgers-local', accountMid, ledgerIds) as Promise<{ status: 'succeeded'; ledgerIds: string[] }>,
  restoreFavoriteLedgersLocal: (accountMid: string, ledgerIds: string[]) =>
    ipcRenderer.invoke('assistant:restore-favorite-ledgers-local', accountMid, ledgerIds) as Promise<{ status: 'succeeded'; ledgerIds: string[] }>,
  releaseDefaultFavoriteLedgerBindings: (accountMid: string, ledgerIds: string[]) =>
    ipcRenderer.invoke('assistant:release-default-favorite-ledger-bindings', accountMid, ledgerIds) as Promise<{ status: 'succeeded'; ledgerIds: string[]; remoteFolderIds: string[] }>,
  getFavoriteLedgerRemoteDraftRediscoveryPending: (accountMid: string) =>
    ipcRenderer.invoke('assistant:get-favorite-ledger-remote-draft-rediscovery-pending', accountMid) as Promise<string[]>,
  consumeFavoriteLedgerRemoteDraftRediscoveryPending: (accountMid: string) =>
    ipcRenderer.invoke('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending', accountMid) as Promise<string[]>,
  writeDefaultFavoriteSystemEnabled: (accountMid: string, enabled: boolean) =>
    ipcRenderer.invoke('assistant:write-default-favorite-system-enabled', accountMid, enabled) as Promise<boolean>,
  previewPreferencePatch: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) =>
    ipcRenderer.send('assistant:preview-preference-patch', patch, meta),
  restoreDefaultLayoutSize: () =>
    ipcRenderer.invoke('layout:restore-default-size') as Promise<void>,
  saveDeepSeekApiKey: (apiKey: string) =>
    ipcRenderer.invoke('deepseek:save-key', apiKey) as Promise<DeepSeekKeyStatus>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>,
  saveVerifiedVideoNoteArchiveVersion: (note: VideoNote, summaryText?: string) =>
    ipcRenderer.invoke(
      'video-note-archives:save-version-verified',
      note,
      summaryText
    ) as Promise<{ archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string }>,
  saveVideoNoteArchiveSummary: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    summaryText: string
  ) => ipcRenderer.invoke(
    'video-note-archives:save-summary',
    archiveId,
    versionId,
    note,
    summaryText
  ) as Promise<{ archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string }>,
  previewVideoNoteArchiveBatch: (request: VideoNoteBatchExportRequest) =>
    ipcRenderer.invoke('video-note-archives:batch-preview', request) as Promise<VideoNoteBatchExportPreview>,
  startVideoNoteArchiveBatch: (request: VideoNoteBatchExportStartRequest) =>
    ipcRenderer.invoke('video-note-archives:batch-start', request) as Promise<VideoNoteBatchExportResult | undefined>,
  cancelVideoNoteArchiveBatch: (input: { batchId: string; accountMid: string }) => ipcRenderer.invoke('video-note-archives:batch-cancel', input) as Promise<boolean>,
  openVideoNoteArchiveBatchFolder: (input: VideoNoteBatchFolderRequest) => ipcRenderer.invoke('video-note-archives:batch-open-folder', input) as Promise<string>,
  onVideoNoteArchiveBatchProgress: (callback: (value: VideoNoteBatchExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: VideoNoteBatchExportProgress) => callback(value)
    ipcRenderer.on('video-note-archives:batch-progress', listener)
    return () => ipcRenderer.removeListener('video-note-archives:batch-progress', listener)
  },
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
  updateFloatingSealInteractiveRegions: (regions: Array<{ x: number; y: number; width: number; height: number }>) =>
    ipcRenderer.send('floating-seal:update-interactive-regions', regions),
  startFloatingSealDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:start-drag', screenX, screenY),
  toggleFloatingAssistant: () => ipcRenderer.invoke('floating-assistant:toggle') as Promise<void>,
  toggleFloatingMenu: () => ipcRenderer.invoke('floating-menu:toggle') as Promise<void>,
  wakeAssistantPet: () => ipcRenderer.invoke('assistant-pet:wake') as Promise<void>,
  testDeepSeekConnection: () =>
    ipcRenderer.invoke('deepseek:test-connection') as Promise<DeepSeekConnectionTestResult>
})
