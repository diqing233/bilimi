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

type BilimiDesktopApi = {
  version: string
  closeAssistantPet?: () => void
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  executeOldFavoritePlan?: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
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
  bindOldFavoriteRuntimeAccount?: (accountMid: string) => boolean
  resetOldFavoriteRuntime?: () => boolean
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
  readOldFavoriteTagEnrichment?: (action?: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan') => Promise<{
    accountMid?: string
    sourceFolders: import('./features/favorites/favoriteLedgerPreview').FavoriteSourceFolder[]
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
