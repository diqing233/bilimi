import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  AssistantPreferences,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
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
} from '@shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  AssistantSnapshot,
  FloatingAssistantActionOptions,
  FloatingAssistantWorkspaceRequest,
  OldFavoriteBatchCommitResult
} from './features/assistant/assistantRuntimeTypes'
import type { AssistantPetHint, AssistantPetState } from './features/assistant/petState'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from './features/favorites/favoriteLedgerPreview'
import type { OldFavoriteBatchCommitToken } from './features/favorites/favoriteLedgerApi'
import type { OldFavoriteAccountIndex, OldFavoriteBatchDetail, OldFavoriteOverlayKind, OldFavoriteOverlayPatch } from '../../../electron/main/oldFavoriteWorkspaceTypes'
import type { OldFavoriteBatchLifecycleSnapshot } from '../../../electron/main/oldFavoriteSessionStore'
import type {
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryPage,
  FavoriteRepositoryVideo
} from '@shared/favoriteRepository'
import type {
  FavoriteRepositoryRevisionChange,
  FavoriteRepositorySnapshotSummary
} from '../../../electron/main/favoriteRepositoryIpc'
import type { FavoriteLibraryCommandResult, FavoriteLibrarySyncSelection } from '../../../electron/main/favoriteLibraryCommands'
import type { OldFavoriteWorkspaceView } from '../../shared/oldFavoriteWorkspace'

type BilimiDesktopApi = {
  version: string
  closeAssistantPet?: () => void
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  openFavoriteLibrary?: () => Promise<void>
  isOldFavoriteEmergencyFallbackEnabled?: () => boolean
  openOldFavoriteWorkspaceV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceView>
  commandOldFavoriteWorkspaceV1?: (accountMid: string, command: unknown) => Promise<OldFavoriteWorkspaceView>
  organizeOldFavoriteWorkspaceDeepSeekV1?: (accountMid: string) => Promise<OldFavoriteWorkspaceView>
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  executeOldFavoritePlan?: (
    items: FavoriteLedgerPreviewItem[],
    expectedAccountMid?: string
  ) => Promise<AssistantAutomationResult>
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
  getOldFavoriteRuntimeSnapshot?: (key: string, initialValue: unknown) => OldFavoriteRuntimeSnapshot
  setOldFavoriteRuntimeValue?: (
    key: string,
    value: unknown,
    expectedRevision: number
  ) => OldFavoriteRuntimeSetResult
  setOldFavoriteRuntimeTransientValue?: (
    key: string,
    value: unknown,
    expectedRevision: number
  ) => Promise<OldFavoriteRuntimeSetResult>
  bindOldFavoriteRuntimeAccount?: (accountMid: string) => boolean
  readBilibiliAccountMid?: () => Promise<string>
  onBilibiliAccountChanged?: (callback: () => void) => () => void
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
    scope: { kind: 'all' } | { kind: 'folder'; folderId: string } | { kind: 'pending' },
    options: { limit: number; cursor?: string }
  ) => Promise<import('../../../electron/main/favoriteRepositoryIpc').FavoriteRepositoryLibraryPage>
  syncFavoriteLibrarySelection?: (accountMid: string, selection: FavoriteLibrarySyncSelection) => Promise<FavoriteLibraryCommandResult>
  reconcileFavoriteLibrarySync?: (accountMid: string, runId: string) => Promise<FavoriteLibraryCommandResult>
  retryFavoriteLibrarySync?: (accountMid: string, runId: string) => Promise<FavoriteLibraryCommandResult>
  bindFavoriteLibrarySyncPage?: (accountMid: string, runId: string) => Promise<FavoriteLibraryCommandResult>
  getPendingFavoriteLibrarySyncRuns?: (accountMid: string) => Promise<FavoriteLibraryCommandResult[]>
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
  openOldFavoriteWorkspaceAccount?: (accountMid: string) => Promise<OldFavoriteAccountIndex>
  loadOldFavoriteWorkspaceBatch?: (accountMid: string, batchId: string) => Promise<OldFavoriteBatchDetail>
  recoverOldFavoriteWorkspaceBatch?: (accountMid: string, batchId: string) => Promise<{ discardedTail: string | null }>
  createOldFavoriteWorkspaceBatch?: (input: { accountMid: string; kind: 'full' | 'incremental'; createdAt?: string; id?: string }) => Promise<unknown>
  appendOldFavoriteWorkspaceChunk?: (accountMid: string, batchId: string, kind: 'base' | 'tags' | 'sources', items: unknown[]) => Promise<unknown>
  appendOldFavoriteWorkspaceChunkGroup?: (accountMid: string, batchId: string, chunks: Record<'base' | 'tags' | 'sources', unknown[]>) => Promise<unknown>
  patchOldFavoriteWorkspaceOverlay?: (accountMid: string, batchId: string, kind: OldFavoriteOverlayKind, patch: OldFavoriteOverlayPatch | OldFavoriteOverlayPatch[]) => Promise<void>
  markOldFavoriteWorkspaceOverlayDirty?: () => boolean
  markOldFavoriteWorkspaceOverlayClean?: () => boolean
  onOldFavoriteWorkspaceFlushRequested?: (callback: () => Promise<void>) => () => void
  finalizeOldFavoriteWorkspaceBatch?: (accountMid: string, batchId: string) => Promise<unknown>
  resetOldFavoriteWorkspaceAccount?: (accountMid: string) => Promise<void>
  resetOldFavoriteAccount?: (accountMid: string) => Promise<OldFavoriteSessionsState>
  resetOldFavoriteRuntime?: () => boolean
  resetOldFavoriteRuntimeAccount?: (accountMid: string) => Promise<boolean>
      loadOldFavoriteSessions?: () => Promise<OldFavoriteSessionsState>
      beginOldFavoriteFullScan?: (
        accountMid: string,
        now: string,
        snapshot?: OldFavoriteSessionsState['batches'][number]['snapshot']
      ) => Promise<{ batch: OldFavoriteSessionsState['batches'][number]; acquired: boolean }>
      beginOldFavoriteIncrementalScan?: (
        accountMid: string,
        now: string,
        snapshot?: OldFavoriteSessionsState['batches'][number]['snapshot']
      ) => Promise<{ batch: OldFavoriteSessionsState['batches'][number]; acquired: boolean }>
      endOldFavoriteBatch?: (batchId: string, endedAt: string) => Promise<OldFavoriteBatchLifecycleSnapshot>
      discardOldFavoriteEmptyIncrementalBatch?: (
        batchId: string,
        accountMid: string
      ) => Promise<{ batchId: string; accountMid: string; discarded: true }>
  saveOldFavoriteSessions?: (state: OldFavoriteSessionsState) => Promise<OldFavoriteSessionsState>
  resetOldFavoriteSessionsAccount?: (accountMid: string) => Promise<OldFavoriteSessionsState>
  claimOldFavoriteTaskLease?: (
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string
  ) => Promise<boolean>
  releaseOldFavoriteTaskLease?: (batchId: string, segmentId: string) => Promise<boolean>
  onOldFavoriteSessionsChanged?: (
    callback: (state: OldFavoriteSessionsState) => void
  ) => () => void
  setOldFavoriteBackgroundRunning?: (running: boolean) => void
  setOldFavoriteBackgroundTarget?: (webContentsId: number) => void
  retryBilibiliSessionDirect?: () => Promise<{ mode: 'direct' }>
  onOldFavoriteRuntimeChanged?: (
    callback: (snapshot: OldFavoriteRuntimeSnapshot | { type: 'reset'; accountMid: string }) => void
  ) => () => void
  onAssistantPreferencesChanged?: (callback: (preferences: AssistantPreferences) => void) => () => void
  onAssistantPetStateChanged?: (callback: (state: AssistantPetState) => void) => () => void
  onAssistantPetHintChanged?: (callback: (hint: AssistantPetHint) => void) => () => void
  onAssistantSnapshotChanged?: (callback: () => void) => () => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenFloatingAssistantWorkspace?: (
    callback: (payload: FloatingAssistantWorkspaceRequest) => void
  ) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
  openBilibiliFavorites?: () => Promise<AssistantAutomationResult>
  rejudgeOldFavorite?: (item: FavoriteLedgerPreviewItem) => Promise<FavoriteLedgerPreviewItem>
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
  scanOldFavorites?: (options?: {
    multiArchiveMode?: AssistantPreferences['favoriteArchiveMultiMode']
  }) => Promise<FavoriteLedgerPreview>
  commitOldFavoriteBatchCheckpoint?: (
    token: OldFavoriteBatchCommitToken
  ) => Promise<OldFavoriteBatchCommitResult>
  readOldFavoriteBatchStatus?: () => Promise<{ pending: boolean }>
  prepareOldFavoriteScan?: () => Promise<AssistantAutomationResult>
  readOldFavoriteTagEnrichment?: (action?: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan') => Promise<{
    accountMid?: string
    sourceFolders: import('./features/favorites/favoriteLedgerPreview').FavoriteSourceFolder[]
    discoveredAids?: number[]
    scanProgress: NonNullable<FavoriteLedgerPreview['scanProgress']>
  }>
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
