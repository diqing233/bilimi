import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  DeepSeekArchiveMode,
  DeepSeekArchiveScope,
  AssistantPreferences,
  FavoriteLedger,
  FavoriteLedgerEnabledPatch,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
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
} from '@shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  AssistantSnapshot,
  FloatingAssistantActionOptions,
  FloatingAssistantWorkspaceRequest,
} from './features/assistant/assistantRuntimeTypes'
import type { AssistantPetHint, AssistantPetState } from './features/assistant/petState'
import type {
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '@shared/favoriteRepository'
import type {
  FavoriteRepositoryRevisionChange,
  FavoriteRepositoryLibraryVideoDetail,
  FavoriteRepositoryOrganizationChanges,
  FavoriteRepositorySnapshotSummary
} from '../../../electron/main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../../../electron/main/favoriteLibraryCommands'
import type { FavoriteLibraryOperationSource } from '../../shared/favoriteLibraryOperations'
import type {
  VideoNoteBatchExportPreview,
  VideoNoteBatchExportProgress,
  VideoNoteBatchExportRequest,
  VideoNoteBatchExportResult,
  VideoNoteBatchExportStartRequest,
  VideoNoteBatchFolderRequest
} from '@shared/videoNoteBatchExport'
import type { FavoriteRepositoryRestorePlan } from '../../../electron/main/favoriteRepositoryArchiveService'
import type { FavoriteLibraryDrawerCommand } from '../../../electron/main/favoriteLibraryEntryFlow'
import type { OldFavoriteWorkspaceDeepSeekProcessedItem, OldFavoriteWorkspaceDeepSeekResult, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceView } from '../../shared/oldFavoriteWorkspace'

type FavoriteLibraryOperationSelection = number[] | {
  kind: 'scope'
  scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' }
  options: { query?: string; filter?: 'all' | 'pending' | 'protected' | 'unsynced'; sort?: 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'; transcriptionFilters?: Array<'completed' | 'none' | 'pending' | 'running' | 'failed'> }
  excludedAids: number[]
}
type FavoriteLibraryDocumentExportSelection = Exclude<FavoriteLibraryOperationSelection, number[]> | { kind: 'aids'; aids: number[] }

type BilimiDesktopApi = {
  version: string
  closeAssistantPet?: () => void
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  openFavoriteLibrary?: () => Promise<void>
  controlFavoriteLibraryWindow?: (action: 'minimize' | 'expand-and-maximize') => Promise<void>
  getFavoriteLibraryUiPreferences?: (accountMid: string) => Promise<Record<string, boolean>>
  saveFavoriteLibraryUiPreferences?: (accountMid: string, collapsedGroups: Record<string, boolean>) => Promise<Record<string, boolean>>
  openOldFavoriteWorkspaceV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceView>
  commandOldFavoriteWorkspaceV1?: (accountMid: string, command: unknown) => Promise<OldFavoriteWorkspaceView>
  getOldFavoriteWorkspaceRecoverySummaryV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceRecoverySummary | null>
  previewManagedFavoriteFolderDeletion?: (accountMid: string, ledgerIds: string[]) => Promise<Array<{ logicalLedgerId: string; remoteFolderId: string; title: string; memberCount: number }>>
  deleteManagedFavoriteFolders?: (accountMid: string, ledgerIds: string[]) => Promise<Array<{ id: string; title: string; memberCount: number }>>
  organizeOldFavoriteWorkspaceDeepSeekV1?: (accountMid: string, mode: DeepSeekArchiveMode, scope?: DeepSeekArchiveScope) => Promise<OldFavoriteWorkspaceDeepSeekResult>
  retryOldFavoriteWorkspaceDeepSeekV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceDeepSeekResult>
  onOldFavoriteWorkspaceDeepSeekProgress?: (callback: (progress: {
    accountMid: string
    workspaceId: string
    totalChunks: number
    completedChunks: number
    totalVideoCount: number
    successfulVideoCount: number
    failedVideoCount: number
    processedItems?: OldFavoriteWorkspaceDeepSeekProcessedItem[]
  }) => void) => () => void
  onOldFavoriteWorkspacePreviewPreparationProgress?: (callback: (progress: {
    accountMid: string
    workspaceId: string
    completedItemCount: number
    totalItemCount: number
  }) => void) => () => void
  onOldFavoriteWorkspaceRuleAnalysisProgress?: (callback: (progress: {
    accountMid: string
    workspaceId: string
    analysisId: string
    completedItemCount: number
    totalItemCount: number
  }) => void) => () => void
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  ensureFavoriteLedger?: (logicalFolderId: string) => Promise<AssistantAutomationResult>
  finishFloatingSealDrag?: () => void
  generateDeepSeek?: (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
  generateVideoNote?: (manualTranscript?: string) => Promise<VideoNote | null>
  generateVideoNoteFromAudio?: () => Promise<VideoNote | null>
  enqueueCurrentVideoAudioTranscription?: (options?: {
    summarizeWithDeepSeek?: boolean
  }) => Promise<VideoAudioTranscriptionQueueSnapshot | null>
  writeClipboardText?: (text: string) => Promise<void>
  getCurrentVideoTime?: () => Promise<number>
  loadPendingFavoriteQueue?: () => Promise<PendingFavoriteQueueItem[]>
  clearPendingFavoriteQueue?: () => Promise<PendingFavoriteQueueItem[]>
  loadPreferences: () => Promise<AssistantPreferences>
  loadAssistantSidebarWidth?: () => Promise<number | null>
  loadVideoNotes?: () => Promise<VideoNote[]>
  loadVideoNoteArchives?: () => Promise<VideoNoteArchiveEntry[]>
  loadDeepSeekApiKeyStatus?: () => Promise<DeepSeekKeyStatus>
  runStartupDiagnostics?: () => Promise<StartupDiagnosticReport>
  moveFloatingSealBy?: (deltaX: number, deltaY: number) => Promise<void>
  moveFloatingSealTo?: (screenX: number, screenY: number) => void
  notifyAssistantSnapshotChanged?: () => void
  retryBilibiliSessionDirect?: () => Promise<{ mode: 'auto' | 'direct'; effectiveMode: 'direct' | 'system'; temporaryDirect: boolean }>
  readBilibiliAccountMid?: () => Promise<string>
  readBilibiliAccount?: () => Promise<{ mid: string; nickname?: string }>
  openFavoriteLibraryVideo?: (accountMid: string, aid: number) => Promise<void>
  openFavoriteLibrarySource?: (accountMid: string, folderId: string) => Promise<void>
  resolveFavoriteLibraryArchive?: (accountMid: string, aid: number, cid?: number) => Promise<{ archiveId: string; versionId: string }>
  toggleFavoriteLibraryArchiveStar?: (accountMid: string, aid: number, cid?: number) => Promise<void>
  saveFavoriteLibraryArchiveMemo?: (accountMid: string, aid: number, memo: string, cid?: number) => Promise<void>
  onBilibiliAccountChanged?: (callback: () => void) => () => void
  onBilibiliSessionReloadRequested?: (callback: () => void) => () => void
  onFavoriteLibraryTranscriptionChanged?: (callback: () => void) => () => void
  openFavoriteRepositoryAccount?: (accountMid: string) => Promise<FavoriteRepositorySnapshotSummary>
  getFavoriteRepositorySnapshot?: (accountMid: string) => Promise<FavoriteRepositorySnapshotSummary>
  getFavoriteRepositoryFolderPage?: (
    accountMid: string,
    folderId: string,
    options: { limit: number; cursor?: string }
  ) => Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>
  searchFavoriteRepositoryPage?: (
    accountMid: string,
    query: string,
    options: { limit: number; cursor?: string }
  ) => Promise<FavoriteRepositoryPage<FavoriteRepositoryVideo>>
  getFavoriteRepositoryLibraryPage?: (
    accountMid: string,
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' } | { kind: 'recycle' },
    options: import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryLibraryPageOptions
  ) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryLibraryPage>
  getFavoriteRepositoryLibraryVideoDetail?: (
    accountMid: string,
    aid: number
  ) => Promise<FavoriteRepositoryLibraryVideoDetail>
  getFavoriteRepositoryVideoEvents?: (
    accountMid: string,
    aid: number,
    options: { limit: number; cursor?: string }
  ) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryEventPage>
  getFavoriteRepositoryOrganizationChanges?: (accountMid: string) => Promise<FavoriteRepositoryOrganizationChanges>
  getLocalDataInfo?: () => Promise<{ path: string; accounts: Array<{ uid: string; nickname?: string; retained: boolean }> }>
  calculateLocalDataUsage?: () => Promise<{
    totalBytes: number; calculatedAt: string
    categories: Record<'accountPersistent' | 'deviceShared' | 'cache' | 'temporaryAudio' | 'logs', { bytes: number }>
  }>
  openLocalDataPath?: () => Promise<void>
  exportLocalData?: (input: { scope: 'current' | 'selected' | 'all'; uids?: string[] }) => Promise<unknown>
  previewLocalDataImport?: () => Promise<{ token?: string; accounts?: Array<{ uid: string; action: string }>; cancelled?: boolean }>
  applyLocalDataImport?: (previewToken: string, mode: 'merge' | 'overwrite') => Promise<void>
  previewLocalDataCleanup?: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) => Promise<{ affectsBilibiliServerData: false; releasableBytes: number }>
  applyLocalDataCleanup?: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) => Promise<void>
  onLocalDataReset?: (callback: () => void) => () => void
  onFavoriteRepositoryAccountDataCleared?: (callback: (accountMid: string) => void) => () => void
  copyFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibraryOperationSelection, targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  moveFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibraryOperationSelection, sourceFolderId: string, targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  deleteFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibraryOperationSelection, expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  previewFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, selection: FavoriteLibraryOperationSelection, expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<unknown>
  confirmFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, executionToken: string) => Promise<{ confirmationToken: string }>
  executeFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, executionToken: string, confirmationToken: string) => Promise<unknown>
  reconcileFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, operationId: string) => Promise<unknown>
  previewFavoriteLibraryManagedPlacementRemoval?: (accountMid: string, selection: FavoriteLibraryOperationSelection, logicalFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<unknown>
  confirmFavoriteLibraryManagedPlacementRemoval?: (accountMid: string, executionToken: string) => Promise<{ confirmationToken: string }>
  executeFavoriteLibraryManagedPlacementRemoval?: (accountMid: string, executionToken: string, confirmationToken: string) => Promise<unknown>
  reconcileFavoriteLibraryManagedPlacementRemoval?: (accountMid: string, operationId: string) => Promise<unknown>
  previewFavoriteLibraryManagedFolderDelete?: (accountMid: string, folderId: string) => Promise<unknown>
  previewFavoriteLibraryManagedFolderGroupDelete?: (accountMid: string) => Promise<unknown>
  deleteFavoriteLibraryManagedFolderLocal?: (accountMid: string, executionToken: string) => Promise<unknown>
  confirmFavoriteLibraryManagedFolderRemoteDelete?: (accountMid: string, executionToken: string) => Promise<{ confirmationToken: string }>
  executeFavoriteLibraryManagedFolderRemoteDelete?: (accountMid: string, executionToken: string, confirmationToken: string) => Promise<unknown>
  reconcileFavoriteLibraryManagedFolderDelete?: (accountMid: string, operationId: string) => Promise<unknown>
  dismissFavoriteLibraryOrdinaryFolder?: (accountMid: string, folderId: string) => Promise<unknown>
  syncFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibrarySyncSelection | FavoriteLibraryOperationSelection) => Promise<FavoriteLibraryCommandResult>
  synchronizeFavoriteLibraryPlacements?: (accountMid: string, selection: FavoriteLibrarySyncSelection | FavoriteLibraryOperationSelection) => Promise<FavoriteLibraryCommandResult>
  setFavoriteLibraryLocalPlacements?: (accountMid: string, placements: Array<{ aid: number; folderIds: string[] }>, expectedRevision: number, synchronize?: boolean) => Promise<FavoriteLibraryCommandResult>
  adoptFavoriteLibraryRemotePlacement?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  deleteFavoriteLibraryVideo?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  restoreFavoriteLibraryVideo?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  forgetFavoriteLibraryTombstone?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  clearRecycledFavoriteLibraryVideo?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  previewFavoriteLibraryBilibiliUnfavorite?: (accountMid: string, aids: number[]) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteLibraryUnfavoritePreview>
  confirmFavoriteLibraryBilibiliUnfavorite?: (accountMid: string, aids: number[], executionToken: string) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteLibraryUnfavoriteConfirmation>
  executeFavoriteLibraryBilibiliUnfavorite?: (accountMid: string, aids: number[], executionToken: string, confirmationToken: string) => Promise<FavoriteLibraryCommandResult>
  exportFavoriteRepositoryArchive?: (accountMid: string) => Promise<unknown>
  previewFavoriteRepositoryArchiveImport?: (accountMid: string, input: unknown) => Promise<unknown>
  applyFavoriteRepositoryArchiveImport?: (accountMid: string, input: unknown) => Promise<unknown>
  createFavoriteRepositoryArchiveRestorePlan?: (
    accountMid: string, input: unknown, mode: 'safe' | 'full', scope: import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryArchiveRestoreScope
  ) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryArchiveRestorePreview>
  confirmFavoriteRepositoryArchiveFullRestore?: (
    accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string
  ) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryArchiveFullRestoreConfirmation>
  executeFavoriteRepositoryArchiveRestore?: (
    accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string, fullConfirmationToken?: string
  ) => Promise<unknown>
  reconcileFavoriteRepositoryArchiveRestore?: (
    accountMid: string, plan: FavoriteRepositoryRestorePlan, executionToken: string
  ) => Promise<unknown>
  enqueueFavoriteLibraryTranscription?: (
    accountMid: string,
    input: { aids: number[]; summarizeWithDeepSeek?: boolean } | { targets: Array<{ aid: number; cid?: number }>; summarizeWithDeepSeek?: boolean } | (Exclude<FavoriteLibraryOperationSelection, number[]> & { summarizeWithDeepSeek?: boolean })
  ) => Promise<FavoriteLibraryCommandResult>
  cancelFavoriteLibraryWaitingTranscription?: (
    accountMid: string,
    input: { aids: number[] } | { targets: Array<{ aid: number; cid?: number }> } | FavoriteLibraryOperationSelection
  ) => Promise<FavoriteLibraryCommandResult>
  resolveFavoriteLibraryDocumentExportSelection?: (accountMid: string, selection: FavoriteLibraryDocumentExportSelection) => Promise<{ selections: Array<{ archiveId: string; versionId: string }>; skippedAids: number[] }>
  commitFavoriteRepositoryCommand?: (
    accountMid: string,
    command: FavoriteRepositoryCommand
  ) => Promise<FavoriteRepositoryCommandResult>
  subscribeFavoriteRepository?: (
    accountMid: string,
    folderId: string | undefined,
    callback: (change: FavoriteRepositoryRevisionChange) => void
  ) => () => void
  onAssistantPreferencesChanged?: (callback: (preferences: AssistantPreferences) => void) => () => void
  onAssistantPreferencePatchChanged?: (callback: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => void) => () => void
  onAssistantSidebarWidthChanged?: (callback: (widthPx: number | null) => void) => () => void
  onFavoriteLedgerEnabledChanged?: (callback: (patch: FavoriteLedgerEnabledPatch, meta?: AssistantPreferencePatchMeta) => void) => () => void
  onAssistantPetStateChanged?: (callback: (state: AssistantPetState) => void) => () => void
  onAssistantPetHintChanged?: (callback: (hint: AssistantPetHint) => void) => () => void
  getMainWindowPresentationState?: () => Promise<{ visible: boolean; minimized: boolean }>
  onAssistantSnapshotChanged?: (callback: () => void) => () => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenFavoriteLibraryDrawer?: (callback: (command: FavoriteLibraryDrawerCommand) => void) => () => void
  onOpenFloatingAssistantWorkspace?: (
    callback: (payload: FloatingAssistantWorkspaceRequest) => void
  ) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
  openVideoNoteArchiveSource?: (source: VideoNoteSourceMetadata, seconds?: number) => Promise<void>
  onOpenVideoNoteArchiveSource?: (callback: (request: { url: string; seconds?: number; aid?: number; cid?: number }) => void) => () => void
  openBilibiliFavorites?: () => Promise<AssistantAutomationResult>
  onRunAssistantAction?: (callback: (payload: { action: AssistantAction }) => void) => () => void
  onVideoAudioTranscriptionProgress?: (
    callback: (progress: VideoAudioTranscriptionProgress) => void
  ) => () => void
  registerAssistantRuntime?: (
    handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>
  ) => () => void
  restoreMainWindowFromPet?: () => Promise<void>
  requestAssistantSnapshot?: () => Promise<AssistantSnapshot>
  resizeFloatingSealByStep?: (step: number) => void
  runAssistantAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<AssistantAutomationResult>
  runFloatingMenuAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<AssistantAutomationResult>
  openFloatingAssistantWorkspace?: (
    payload: FloatingAssistantWorkspaceRequest
  ) => Promise<void>
  upsertPendingFavoriteQueueItems?: (
    items: PendingFavoriteQueueItem[]
  ) => Promise<PendingFavoriteQueueItem[]>
  updatePendingFavoriteQueueItemStatus?: (
    aid: number,
    status: PendingFavoriteQueueStatus
  ) => Promise<PendingFavoriteQueueItem[]>
  saveFavoriteLedgers?: (
    ledgers: FavoriteLedger[],
    options?: FavoriteLedgerSaveOptions
  ) => Promise<AssistantAutomationResult>
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  patchPreferences?: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => Promise<AssistantPreferences>
  saveAssistantSidebarWidth?: (widthPx: number | null) => Promise<number | null>
  writePreferencePatch?: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => Promise<Partial<AssistantPreferences>>
  writeFavoriteLedgerEnabled?: (accountMid: string, ledgerId: string, enabled: boolean, meta?: AssistantPreferencePatchMeta) => Promise<FavoriteLedgerEnabledPatch>
  writeDefaultFavoriteSystemEnabled?: (accountMid: string, enabled: boolean) => Promise<boolean>
  previewPreferencePatch?: (patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => void
  restoreDefaultLayoutSize?: () => Promise<void>
  saveDeepSeekApiKey?: (apiKey: string) => Promise<DeepSeekKeyStatus>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
  saveVerifiedVideoNoteArchiveVersion?: (
    note: VideoNote,
    summaryText?: string
  ) => Promise<{ archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string }>
  saveVideoNoteArchiveSummary?: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    summaryText: string
  ) => Promise<{ archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string }>
  previewVideoNoteArchiveBatch?: (request: VideoNoteBatchExportRequest) => Promise<VideoNoteBatchExportPreview>
  startVideoNoteArchiveBatch?: (request: VideoNoteBatchExportStartRequest) => Promise<VideoNoteBatchExportResult | undefined>
  cancelVideoNoteArchiveBatch?: (input: { batchId: string; accountMid: string }) => Promise<boolean>
  openVideoNoteArchiveBatchFolder?: (input: VideoNoteBatchFolderRequest) => Promise<string>
  onVideoNoteArchiveBatchProgress?: (callback: (value: VideoNoteBatchExportProgress) => void) => () => void
  updateVideoNoteArchiveVersion?: (
    archiveId: string,
    versionId: string,
    note: VideoNote,
    summaryText?: string
  ) => Promise<VideoNoteArchiveEntry[]>
  deleteVideoNoteArchiveEntry?: (archiveId: string) => Promise<VideoNoteArchiveEntry[]>
  deleteVideoNoteArchiveVersion?: (
    archiveId: string,
    versionId: string
  ) => Promise<VideoNoteArchiveEntry[]>
  clearDeepSeekApiKey?: () => Promise<DeepSeekKeyStatus>
  seekVideoTime?: (seconds: number) => Promise<boolean>
  setAssistantPetState?: (state: AssistantPetState) => void
  setAssistantPetHint?: (hint: AssistantPetHint) => void
  setFloatingSealMouseTransparent?: (transparent: boolean) => void
  updateFloatingSealInteractiveRegions?: (regions: Array<{ x: number; y: number; width: number; height: number }>) => void
  startFloatingSealDrag?: (screenX: number, screenY: number) => void
  toggleFloatingAssistant?: () => Promise<void>
  toggleFloatingMenu?: () => Promise<void>
  wakeAssistantPet?: () => Promise<void>
  testDeepSeekConnection?: () => Promise<DeepSeekConnectionTestResult>
  transcribeCurrentVideoAudio?: (
    request: VideoAudioTranscriptionRequest
  ) => Promise<VideoAudioTranscriptionResult>
  loadTranscriptionModels?: () => Promise<TranscriptionModelInstallation[]>
  loadCurrentTranscriptionModelInstallProgress?: () => Promise<TranscriptionModelInstallProgress | undefined>
  probeTranscriptionModelGpu?: (id: TranscriptionModelId) => Promise<TranscriptionGpuProbe>
  installTranscriptionModel?: (id: TranscriptionModelId, options?: { restart?: boolean }) => Promise<TranscriptionModelInstallation[]>
  cancelTranscriptionModelInstall?: (id: TranscriptionModelId) => Promise<TranscriptionModelInstallation[]>
  importTranscriptionModel?: (id: TranscriptionModelId) => Promise<TranscriptionModelInstallation[]>
  migrateLegacyWhisperSmall?: () => Promise<TranscriptionModelInstallation[]>
  revalidateTranscriptionModel?: (id: TranscriptionModelId) => Promise<TranscriptionModelInstallation[]>
  deleteTranscriptionModel?: (id: TranscriptionModelId) => Promise<TranscriptionModelInstallation[]>
  onTranscriptionModelInstallProgress?: (callback: (value: TranscriptionModelInstallProgress) => void) => () => void
  loadVideoAudioTranscriptionQueue?: () => Promise<VideoAudioTranscriptionQueueSnapshot>
  enqueueVideoAudioTranscription?: (
    request: VideoAudioTranscriptionRequest
  ) => Promise<VideoAudioTranscriptionQueueSnapshot>
  cancelVideoAudioTranscription?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  cancelVideoAudioTranscriptionSummary?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  retryVideoAudioTranscription?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  retryVideoAudioTranscriptionOnCpu?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  retryVideoAudioArchiveRegistration?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  retryVideoAudioSummary?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  cancelWaitingVideoAudioTranscriptions?: (ids: string[]) => Promise<import('../../../electron/main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>
  retryVideoAudioTranscriptions?: (ids: string[]) => Promise<import('../../../electron/main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>
  removeVideoAudioTranscriptions?: (ids: string[]) => Promise<import('../../../electron/main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>
  previewStopVideoAudioTranscriptions?: (ids: string[]) => Promise<{ confirmationToken: string; runningCount: number }>
  stopVideoAudioTranscriptions?: (ids: string[], confirmationToken: string) => Promise<import('../../../electron/main/videoTranscriptionQueue').VideoTranscriptionQueueBatchResult>
  onVideoAudioTranscriptionQueueChanged?: (
    callback: (snapshot: VideoAudioTranscriptionQueueSnapshot) => void
  ) => () => void
}

type AssistantOpenPayload = {
  position?: {
    left: number
    top: number
  }
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
