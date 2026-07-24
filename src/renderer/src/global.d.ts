import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  DeepSeekArchiveMode,
  AssistantPreferences,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  StartupDiagnosticReport,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote,
  VideoNoteArchiveEntry
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
import type { FavoriteRepositoryRestorePlan } from '../../../electron/main/favoriteRepositoryArchiveService'
import type { FavoriteLibraryDrawerCommand } from '../../../electron/main/favoriteLibraryEntryFlow'
import type { OldFavoriteWorkspaceDeepSeekResult, OldFavoriteWorkspaceRecoverySummary, OldFavoriteWorkspaceView } from '../../shared/oldFavoriteWorkspace'

type BilimiDesktopApi = {
  version: string
  closeAssistantPet?: () => void
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  openFavoriteLibrary?: () => Promise<void>
  controlFavoriteLibraryWindow?: (action: 'minimize' | 'toggle-maximize') => Promise<void>
  getFavoriteLibraryUiPreferences?: (accountMid: string) => Promise<Record<string, boolean>>
  saveFavoriteLibraryUiPreferences?: (accountMid: string, collapsedGroups: Record<string, boolean>) => Promise<Record<string, boolean>>
  openOldFavoriteWorkspaceV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceView>
  commandOldFavoriteWorkspaceV1?: (accountMid: string, command: unknown) => Promise<OldFavoriteWorkspaceView>
  getOldFavoriteWorkspaceRecoverySummaryV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceRecoverySummary | null>
  previewManagedFavoriteFolderDeletion?: (accountMid: string, ledgerIds: string[]) => Promise<Array<{ logicalLedgerId: string; remoteFolderId: string; title: string; memberCount: number }>>
  deleteManagedFavoriteFolders?: (accountMid: string, ledgerIds: string[]) => Promise<Array<{ id: string; title: string; memberCount: number }>>
  organizeOldFavoriteWorkspaceDeepSeekV1?: (accountMid: string, mode: DeepSeekArchiveMode) => Promise<OldFavoriteWorkspaceDeepSeekResult>
  retryOldFavoriteWorkspaceDeepSeekV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceDeepSeekResult>
  onOldFavoriteWorkspaceDeepSeekProgress?: (callback: (progress: {
    accountMid: string
    workspaceId: string
    totalChunks: number
    completedChunks: number
    totalVideoCount: number
    successfulVideoCount: number
    failedVideoCount: number
  }) => void) => () => void
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
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
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' } | { kind: 'protected' } | { kind: 'unsynced' },
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
  getLocalDataInfo?: () => Promise<{ path: string; accounts: Array<{ uid: string; retained: boolean }> }>
  calculateLocalDataUsage?: () => Promise<{
    totalBytes: number; calculatedAt: string
    categories: Record<'accountPersistent' | 'deviceShared' | 'cache' | 'temporaryAudio' | 'logs', { bytes: number }>
  }>
  openLocalDataPath?: () => Promise<void>
  exportLocalData?: (input: { scope: 'current' | 'selected' | 'all'; uids?: string[]; includeSharedSettings: boolean }) => Promise<unknown>
  previewLocalDataImport?: () => Promise<{ token?: string; accounts?: Array<{ uid: string; action: string }>; cancelled?: boolean }>
  applyLocalDataImport?: (previewToken: string, mode: 'merge' | 'overwrite') => Promise<void>
  previewLocalDataCleanup?: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) => Promise<{ affectsBilibiliServerData: false }>
  applyLocalDataCleanup?: (level: 'cache' | 'current-account-temp' | 'current-account-data' | 'all-user-data', uid?: string, confirmation?: string) => Promise<void>
  copyFavoriteLibrarySelection?: (accountMid: string, aids: number[], targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  moveFavoriteLibrarySelection?: (accountMid: string, aids: number[], sourceFolderId: string, targetFolderIds: string[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  deleteFavoriteLibrarySelection?: (accountMid: string, aids: number[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<FavoriteLibraryCommandResult>
  previewFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, aids: number[], expectedRevision: number, source: FavoriteLibraryOperationSource) => Promise<unknown>
  confirmFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, executionToken: string) => Promise<{ confirmationToken: string }>
  executeFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, executionToken: string, confirmationToken: string) => Promise<unknown>
  reconcileFavoriteLibraryRemoteUnfavoriteOperation?: (accountMid: string, operationId: string) => Promise<unknown>
  previewFavoriteLibraryManagedFolderDelete?: (accountMid: string, folderId: string) => Promise<unknown>
  deleteFavoriteLibraryManagedFolderLocal?: (accountMid: string, executionToken: string) => Promise<unknown>
  confirmFavoriteLibraryManagedFolderRemoteDelete?: (accountMid: string, executionToken: string) => Promise<{ confirmationToken: string }>
  executeFavoriteLibraryManagedFolderRemoteDelete?: (accountMid: string, executionToken: string, confirmationToken: string) => Promise<unknown>
  reconcileFavoriteLibraryManagedFolderDelete?: (accountMid: string, operationId: string) => Promise<unknown>
  syncFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibrarySyncSelection) => Promise<FavoriteLibraryCommandResult>
  setFavoriteLibraryLocalPlacements?: (accountMid: string, placements: Array<{ aid: number; folderIds: string[] }>, expectedRevision: number, synchronize?: boolean) => Promise<FavoriteLibraryCommandResult>
  adoptFavoriteLibraryRemotePlacement?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  deleteFavoriteLibraryVideo?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  restoreFavoriteLibraryVideo?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
  forgetFavoriteLibraryTombstone?: (accountMid: string, aid: number, expectedRevision: number) => Promise<FavoriteLibraryCommandResult>
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
    input: { aids: number[]; summarizeWithDeepSeek?: boolean }
  ) => Promise<FavoriteLibraryCommandResult>
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
  onAssistantPetStateChanged?: (callback: (state: AssistantPetState) => void) => () => void
  onAssistantPetHintChanged?: (callback: (hint: AssistantPetHint) => void) => () => void
  onAssistantSnapshotChanged?: (callback: () => void) => () => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenFavoriteLibraryDrawer?: (callback: (command: FavoriteLibraryDrawerCommand) => void) => () => void
  onOpenFloatingAssistantWorkspace?: (
    callback: (payload: FloatingAssistantWorkspaceRequest) => void
  ) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
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
  patchPreferences?: (patch: Partial<AssistantPreferences>) => Promise<AssistantPreferences>
  restoreDefaultLayoutSize?: () => Promise<void>
  saveDeepSeekApiKey?: (apiKey: string) => Promise<DeepSeekKeyStatus>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
  saveVideoNoteArchiveVersion?: (
    note: VideoNote,
    summaryText?: string
  ) => Promise<VideoNoteArchiveEntry[]>
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
  startFloatingSealDrag?: (screenX: number, screenY: number) => void
  toggleFloatingAssistant?: () => Promise<void>
  toggleFloatingMenu?: () => Promise<void>
  wakeAssistantPet?: () => Promise<void>
  testDeepSeekConnection?: () => Promise<DeepSeekConnectionTestResult>
  transcribeCurrentVideoAudio?: (
    request: VideoAudioTranscriptionRequest
  ) => Promise<VideoAudioTranscriptionResult>
  loadVideoAudioTranscriptionQueue?: () => Promise<VideoAudioTranscriptionQueueSnapshot>
  enqueueVideoAudioTranscription?: (
    request: VideoAudioTranscriptionRequest
  ) => Promise<VideoAudioTranscriptionQueueSnapshot>
  cancelVideoAudioTranscription?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
  retryVideoAudioTranscription?: (id: string) => Promise<VideoAudioTranscriptionQueueSnapshot>
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
