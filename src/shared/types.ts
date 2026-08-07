import type { PetHoverShortcutId } from './petHoverShortcuts'

export type {
  AccountFavoriteRepositorySnapshot,
  FavoriteRepositoryCommand,
  FavoriteRepositoryCommandResult,
  FavoriteRepositoryFolder,
  FavoriteRepositoryMembershipIndex,
  FavoriteRepositoryPage,
  FavoriteRepositoryPhysicalShard,
  FavoriteRepositorySyncRecord,
  FavoriteRepositoryVideo,
  FavoriteRepositoryWorkspace,
  FavoriteRepositoryWorkspaceRef
} from './favoriteRepository'

export type AssistantAction = '赏' | '藏' | '赐' | '表' | '阅'

export type BrowserSurfaceModel = {
  src: string
  partition: string
  allowpopups: 'true'
}

export type BrowserTabModel = {
  id: string
  title: string
  url: string
}

export type DefaultFavoriteLedgerId =
  | 'knowledge'
  | 'game'
  | 'movie-tv'
  | 'creative-aesthetic'
  | 'life-interest'
  | 'music'
  | 'entertainment'
  | 'inbox'

export type FavoriteLedgerId = string
export type RecommendationKind = FavoriteLedgerId
export type FavoriteLedgerRuleType = 'keyword' | 'author' | 'tag' | 'deepseek'
export type FavoriteLedgerSyncState = 'local-draft'

export type FavoriteLedger = {
  id: FavoriteLedgerId
  displayName: string
  keywords: string[]
  ruleType?: FavoriteLedgerRuleType
  enabled: boolean
  priority: number
  bilibiliFolderId?: string
  /** Local drafts are unconfigured rules and do not classify or sync until explicitly saved. */
  syncState?: FavoriteLedgerSyncState
  isDefault: boolean
}

export type FavoriteLedgerSaveOptions = {
  deleteDisabled?: boolean
}

export type FavoriteArchiveMultiMode = 'off' | 'two' | 'three'
export type CommentSubmitMode = 'choose' | 'random'
export type VideoAudioTranscriptionThreadLimit = 'unlimited' | 1 | 2 | 4
export type TranscriptionModelId =
  | 'sensevoice-small'
  | 'whisper-small'
  | 'faster-whisper-large-v3-turbo'
  | 'faster-whisper-large-v3'
export type TranscriptionRuntimeFamily = 'sensevoice' | 'whisper.cpp' | 'faster-whisper'
export type TranscriptionGpuProbe =
  | { modelId?: TranscriptionModelId; status: 'available'; device: 'cuda'; computeType: 'float16' | 'int8_float16'; gpuName: string; driverVersion: string; memoryMiB: number; freeMemoryMiB: number }
  | { modelId?: TranscriptionModelId; status: 'cpu-only'; reason: string }
export type TranscriptionModelInstallation = {
  id: TranscriptionModelId
  bundled: boolean
  installed: boolean
  /** A verified download may continue from this machine-wide partial directory. */
  resumable?: boolean
  /** This installation lives under bilimi's managed model directory and can be removed safely. */
  removable?: boolean
  /** The legacy bundled Whisper file can be copied into managed storage for unified management. */
  migratable?: boolean
  /** Shown only for a managed installation before the user confirms removal. */
  managedPath?: string
  /** Installed artifacts are selectable only after their runtime health check passes. */
  available: boolean
  version: string
  runtimeFamily: TranscriptionRuntimeFamily
  /** Optional for renderer/preload compatibility with an older main process. */
  hardware?: string
  license: string
  attribution: string
  downloadBytes: number
  installedBytes: number
}
export type TranscriptionModelInstallStage =
  | 'connecting'
  | 'downloading'
  | 'downloading-part'
  | 'verifying'
  | 'merging-parts'
  | 'installing'
  | 'validating-runtime'
  | 'available'
  | 'failed'
  | 'canceled'
export type TranscriptionModelInstallProgress = {
  id: TranscriptionModelId
  stage: TranscriptionModelInstallStage
  receivedBytes?: number
  totalBytes?: number
  percentage?: number
  bytesPerSecond?: number
  etaSeconds?: number
  source?: 'ModelScope' | 'GitHub Release' | 'Official source'
  sourceFallbackMessage?: string
  partIndex?: number
  partCount?: number
  error?: string
}
export type MainWindowCloseBehavior = 'minimize-to-tray' | 'exit-launcher'

export type PendingFavoriteQueueSource = 'old-favorite-scan' | 'new-favorite'

export type PendingFavoriteQueueStatus = 'pending' | 'archived' | 'dismissed'

export type PendingFavoriteQueueItem = {
  aid: number
  title: string
  source: PendingFavoriteQueueSource
  sourceFolderTitle?: string
  originalTargetLedgerId?: FavoriteLedgerId
  suggestedLedgerIds: FavoriteLedgerId[]
  candidateLedgerNames: string[]
  reason: string
  createdAt: string
  updatedAt: string
  status: PendingFavoriteQueueStatus
}

export type PendingFavoriteQueueSummary = {
  totalPending: number
  suggestedExistingCount: number
  suggestedCandidateLedgerCount: number
  stagingCount: number
}

export type FavoriteLedgerClassification = {
  ledgerId: FavoriteLedgerId
  displayName: string
  matchedKeywords: string[]
  reviewRequired: boolean
  suggestedLedgerId?: FavoriteLedgerId
  suggestedDisplayName?: string
  diagnostic?: FavoriteLedgerClassificationDiagnostic
}

export type FavoriteArchiveStrategy = 'aggressive' | 'balanced' | 'conservative'

export type ClassificationConfidenceLevel = 'high' | 'medium' | 'low'

export type FavoriteCorrectionSource = 'user' | 'deepseek' | 'user-confirmed-deepseek' | 'classifier'
export type FavoriteCorrectionFeedbackType = 'strong-correction' | 'weak-negative'
export type FavoriteKeywordSuggestionAction =
  | 'add-keyword'
  | 'remove-keyword'
  | 'downgrade-to-weak'
  | 'replace-with-combination'
  | 'add-entity-alias'
  | 'add-concept-variant'
export type FavoriteKeywordSuggestionStatus = 'pending' | 'accepted' | 'ignored' | 'deleted'

export type FavoriteCorrectionRecord = {
  id: string
  aid: number
  title: string
  originalLedgerId?: FavoriteLedgerId
  userLedgerIds: FavoriteLedgerId[]
  source: FavoriteCorrectionSource
  feedbackType: FavoriteCorrectionFeedbackType
  sourceScene: 'archive-preview' | 'daily-favorite'
  sourceFolderTitle?: string
  author?: string
  tags: string[]
  matchedKeywords: string[]
  score?: number
  confidence?: ClassificationConfidenceLevel
  scoreGap?: number
  createdAt: string
  confirmedAt?: string
}

export type FavoriteKeywordSuggestion = {
  id: string
  action: FavoriteKeywordSuggestionAction
  ledgerId?: FavoriteLedgerId
  keyword?: string
  replacement?: string
  reason: string
  source: FavoriteCorrectionSource
  status: FavoriteKeywordSuggestionStatus
  createdAt: string
}

export type FavoriteLedgerClassificationDiagnostic = {
  score: number
  runnerUpLedgerId?: FavoriteLedgerId
  runnerUpScore?: number
  scoreGap: number
  confidence: ClassificationConfidenceLevel
  lowConfidence: boolean
  matchedKeywords: string[]
  strongSignals: string[]
  weakSignals: string[]
  entityAliases: string[]
  conceptClusters: string[]
  positiveRules: string[]
  negativeRules: string[]
}

export type FavoriteLedgerStatus = {
  ok: boolean
  ledgers: FavoriteLedger[]
  missingLedgerIds: FavoriteLedgerId[]
  backupConflictLedgerIds?: FavoriteLedgerId[]
  message: string
}

export type FavoriteArchiveProtectionRecord = {
  accountMid: string
  aid: number
  targetLedgerIds: string[]
  targetFolderIds: string[]
  completedAt: string
}

export type RecommendationLabel = {
  badge: '可赏' | '可阅' | '请陛下过目' | '慎入' | '可藏' | '待分拣'
  summary: string
  hint?: string
}

export type AssistantPreferencePatchMeta = {
  originId: string
  mutationId: number
}

export type FavoriteLedgerEnabledPatch = {
  accountMid: string
  ledgerId: FavoriteLedgerId
  enabled: boolean
}

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  favoriteAccountPreferences?: Record<string, FavoriteAccountPreferences>
  ledgerPromptDismissed: boolean
  petStyle: 'big-head' | 'classic'
  petHoverShortcuts: PetHoverShortcutId[]
  showPetAssistantShortcut: boolean
  hidePetDuringVideoFullscreen: boolean
  closeBehavior: MainWindowCloseBehavior
  confirmBeforeExit: boolean
  rememberCloseChoice?: boolean
  closeChoiceMigrationVersion?: number
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  /** Device-wide Bilibili session network preference, never account-scoped. */
  bilibiliConnectionMode: 'auto' | 'direct'
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  /** Maximum detailed items in each batch of the next old-favorite organization round. */
  oldFavoriteWorkspaceSegmentSize: number
  favoriteArchiveStrategy: FavoriteArchiveStrategy
  favoriteCorrectionLearningEnabled: boolean
  favoriteCorrectionLearningClassificationEnabled: boolean
  favoriteAdjustmentRecordsVersion: 1
  favoriteCorrectionRecords: FavoriteCorrectionRecord[]
  favoriteArchiveProtectionRecords?: FavoriteArchiveProtectionRecord[]
  favoriteArchiveProtectionInitializedAccountMids?: string[]
  favoriteKeywordSuggestions: FavoriteKeywordSuggestion[]
  defaultCoinCount: 1 | 2
  commentSubmitMode: CommentSubmitMode
  videoAudioTranscriptionThreadLimit: VideoAudioTranscriptionThreadLimit
  preferenceCounts: Record<string, number>
  deepseekEnabled: boolean
  deepseekApiKeyStored: boolean
  deepseekCommentEnabled: boolean
  deepseekAutoSummaryEnabled: boolean
  deepseekPetChatEnabled: boolean
  deepseekDailyClassificationEnabled: boolean
  deepseekArchiveOrganizationEnabled: boolean
  deepseekFeatureDefaultsInitialized: boolean
  deepseekDailyClassificationMode: 'all' | 'low-confidence-only'
  deepseekModel: string
  deepseekBaseUrl: string
  permissionOnboardingCompleted: boolean
  assistantSidebarWidthPx: number | null
}

export type FavoriteAccountPreferences = {
  defaultFavoriteSystemEnabled: boolean
  favoriteLedgers: FavoriteLedger[]
  /** UI-only navigation state, keyed by stable group ID and isolated per Bilibili UID. */
  favoriteLibraryCollapsedGroups?: Record<string, boolean>
  transcriptionModelId?: TranscriptionModelId
  /** Durable conflict-resolution timestamp for portable account settings. */
  updatedAt?: string
}

export type AssistantAutomationResult = {
  ok: boolean
  steps: string[]
  missingTargets: string[]
  message: string
  resultUnknown?: boolean
  /** Remote Bilibili folder ids confirmed by a successful favorite API call. */
  favoriteFolderIdsByLedgerId?: Record<string, string>
}

export type VisualAutomationContext = {
  favoriteFolders: Record<string, string>
  favoritesFolderName: string
  targetLedgerId: FavoriteLedgerId
}

export type VisualAutomationOptions = {
  openWithShortcut?: boolean
}

export type VisualAutomationFallback = (
  context: VisualAutomationContext,
  options?: VisualAutomationOptions
) => Promise<AssistantAutomationResult>

export type VideoNoteSourceMetadata = {
  /** Archive ownership. Entries created before this field stay unassigned and private to the archive library. */
  accountMid?: string
  /** Stable Bilibili video identity for archive navigation and exports. */
  aid?: number
  /** Stable Bilibili part identity; absent only for single-part/legacy notes. */
  cid?: number
  title: string
  author?: string
  description?: string
  tags: string[]
  bvid?: string
  url: string
}

export type TranscriptSegment = {
  start: number | null
  end: number | null
  text: string
}

export type TranscriptChapter = {
  start: number | null
  title: string
  summary: string
  segmentIndexes: number[]
}

export type VideoNoteTranscriptSource = 'auto' | 'manual' | 'audio'

export type VideoNoteTimelineItem = {
  start: number | null
  title: string
  detail: string
}

export type VideoNoteOverview = {
  shortSummary: string[]
  keywords: string[]
  timeline: VideoNoteTimelineItem[]
  highlights: VideoNoteTimelineItem[]
}

export type VideoNoteAnnotation = {
  id: string
  start: number | null
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type VideoNote = {
  id: string
  source: VideoNoteSourceMetadata
  transcriptSource: VideoNoteTranscriptSource
  transcript: TranscriptSegment[]
  chapters: TranscriptChapter[]
  overview: VideoNoteOverview
  annotations: VideoNoteAnnotation[]
  userMemo: string
  starred?: boolean
  createdAt: string
  updatedAt: string
}

export type DeepSeekErrorCode =
  | 'not-configured'
  | 'network-error'
  | 'api-error'
  | 'invalid-output'
  | 'unknown'

export type DeepSeekChatMessage = { role: 'user' | 'assistant'; content: string }

export type FavoriteLedgerInsightSignal = {
  name: string
  count: number
}

export type FavoriteLedgerAuthorInsightSignal = FavoriteLedgerInsightSignal & {
  share: number
}

export type FavoriteLedgerCandidateKind = 'author' | 'tag-cluster' | 'category'

export type FavoriteLedgerCandidateConfidence = 'high' | 'medium'

export type NotePosterSummary = {
  title: string
  subtitle: string
  keyPoints: string[]
  keywords: string[]
  /** Ordered, source-grounded detail for the readable summary/export. */
  detailedOutline?: string[]
  /** Uncertain source tokens are intentionally kept out of the asserted detail. */
  reviewItems?: Array<{ text: string; reason: string }>
  /** Retained solely to render pre-structure archives without rewriting them. */
  prompt: string
  polishedTranscriptText?: string
  auditChecklistText?: string
}

export type DeepSeekArchiveMode =
  | 'all'
  | 'classified-only'
  | 'unclassified-only'
  | 'low-confidence-and-unclassified'

export type DeepSeekArchiveScope = 'current' | 'all'

export type DeepSeekArchiveVideoInput = {
  aid: number
  title: string
  author?: string
  description?: string
  tags?: string[]
  category?: string
  sourceFolderTitle: string
  originalSuggestedLedgerIds: FavoriteLedgerId[]
  currentTargetLedgerIds: FavoriteLedgerId[]
  selectedTargetLedgerIds: FavoriteLedgerId[]
  lowConfidence?: boolean
  classificationDiagnostic?: FavoriteLedgerClassificationDiagnostic
}

export type DeepSeekArchiveLedgerInput = {
  id: FavoriteLedgerId
  displayName: string
  keywords: string[]
  deepSeekConstraint?: string
  ruleType?: FavoriteLedgerRuleType
  enabled: boolean
}

export type DeepSeekArchiveVideoResult = {
  aid?: number
  sourceFolderTitle?: string
  targetLedgerIds: FavoriteLedgerId[]
  keepOriginal: boolean
  reason: string
  confidence?: number
  lowConfidence: boolean
  secondPassChanged?: boolean
  invalid?: boolean
  failureKind?: 'invalid-result' | 'request-failed'
  errorMessage?: string
}

export type DeepSeekDailyVideoContext = {
  aid?: number
  title?: string
  author?: string
  description?: string
  pageText?: string
  tags?: string[]
  category?: string
}

export type DeepSeekDailyClassificationDiagnosticInput =
  FavoriteLedgerClassificationDiagnostic & {
    ledgerId: FavoriteLedgerId
  }

export type DeepSeekDailyClassificationInput = {
  targetLedgerIds: FavoriteLedgerId[]
  primaryLedgerId: FavoriteLedgerId
  displayNames: string[]
  reason?: string
  diagnostics: DeepSeekDailyClassificationDiagnosticInput[]
}

export type DeepSeekDailyClassificationReviewResult = {
  targetLedgerIds: FavoriteLedgerId[]
  /** Enabled DeepSeek-constraint ledgers that the model applied to this decision. */
  appliedConstraintLedgerIds?: FavoriteLedgerId[]
  corrected: boolean
  reason: string
  confidence?: number
  keywordSuggestions: FavoriteKeywordSuggestion[]
  invalid?: boolean
  errorMessage?: string
}

export type DeepSeekGenerateRequest =
  | {
      kind: 'review-comment'
      intent: string
      title: string
      author?: string
      description?: string
      tags: string[]
      classification: string
    }
  | { kind: 'note-poster'; note: VideoNote }
  | {
      kind: 'pet-chat'
      messages: DeepSeekChatMessage[]
      context?: { title?: string; pageText?: string }
    }
  | {
      kind: 'favorite-archive-organize'
      mode: DeepSeekArchiveMode
      videos: DeepSeekArchiveVideoInput[]
      ledgers: DeepSeekArchiveLedgerInput[]
      multiArchiveLimit: 1 | 2 | 3
    }
  | {
      kind: 'favorite-daily-classify-review'
      video: DeepSeekDailyVideoContext
      localClassification: DeepSeekDailyClassificationInput
      ledgers: DeepSeekArchiveLedgerInput[]
    }

export type DeepSeekGenerateResult =
  | { kind: 'review-comment'; comments: string[] }
  | { kind: 'note-poster'; poster: NotePosterSummary }
  | { kind: 'pet-chat'; message: string }
  | {
      kind: 'favorite-archive-organize'
      results: DeepSeekArchiveVideoResult[]
      keywordSuggestions: FavoriteKeywordSuggestion[]
    }
  | ({ kind: 'favorite-daily-classify-review' } & DeepSeekDailyClassificationReviewResult)

export type DeepSeekTaskKind =
  | 'comment'
  | 'classification'
  | 'summary'
  | 'archive-organize'
  | 'pet-chat'
  | 'connection-test'

export type DeepSeekTask = {
  id: string
  kind: DeepSeekTaskKind
  detail?: string
}

export type DeepSeekKeyStatus = {
  configured: boolean
  protection: 'encrypted' | 'plaintext' | 'error' | 'unavailable'
}

export type DeepSeekConnectionTestResult = {
  ok: boolean
  message: string
  requestedModel?: string
  responseModel?: string
}

export type StartupDiagnosticStatus = 'ok' | 'warning' | 'error'

export type StartupDiagnosticItem = {
  id:
    | 'bilibili-network'
    | 'bilibili-page'
    | 'windows-firewall'
    | 'media-tools'
    | 'deepseek'
    | 'storage'
  label: string
  status: StartupDiagnosticStatus
  message: string
  action?: string
}

export type StartupDiagnosticReport = {
  ok: boolean
  checkedAt: string
  items: StartupDiagnosticItem[]
}

export type VideoNoteArchiveVersion = {
  id: string
  note: VideoNote
  plainTranscript: string
  summaryText: string
  createdAt: string
}

export type VideoNoteArchiveEntry = {
  id: string
  source: VideoNoteSourceMetadata
  versions: VideoNoteArchiveVersion[]
  createdAt: string
  updatedAt: string
}

export type VideoNoteArchiveSearchFilters = {
  query: string
  hasMemo?: boolean
  hasStarred?: boolean
}

export type VideoNoteExtractionResult = {
  source: VideoNoteSourceMetadata
  transcript: TranscriptSegment[]
  transcriptSource: VideoNoteTranscriptSource
  error?: string
}

export type VideoAudioTranscriptionProgressStep =
  | 'preparing-session'
  | 'downloading-audio'
  | 'preparing-segments'
  | 'transcribing-segment'
  | 'merging-transcript'
  | 'generating-note'
  | 'summarizing-deepseek'
  | 'saving-archive'
  | 'canceling'
  | 'canceling-summary'
  | 'queue-completed'

export type VideoAudioTranscriptionProgress = {
  step: VideoAudioTranscriptionProgressStep
  message: string
  segmentIndex?: number
  segmentCount?: number
  actualDevice?: 'cpu' | 'cuda'
  actualComputeType?: 'int8' | 'float16' | 'int8_float16'
  runtimeFallbackMessage?: string
}

export type VideoAudioTranscriptionRequest = {
  /** Library-originated requests are scoped to their Bilibili account. */
  accountMid?: string
  url: string
  title: string
  author?: string
  bvid?: string
  aid?: number | string
  cid?: number | string
  /** Immutable local metadata snapshot used when this item was enqueued. */
  metadataRevision?: number
  summarizeWithDeepSeek?: boolean
  /** Captured by the queue so a preference change cannot switch an active job. */
  transcriptionModelId?: TranscriptionModelId
  /** A user-selected one-shot retry after a CUDA out-of-memory failure. */
  transcriptionDeviceOverride?: 'cpu'
}

export type VideoAudioTranscriptionFailureKind = 'cuda-oom'
/** A summary is only saved once its exact archive version can be re-read. */
export type VideoAudioTranscriptionSummaryStatus = 'not-requested' | 'generating' | 'generated' | 'saved' | 'failed'

export type VideoAudioTranscriptionResult = {
  transcript: TranscriptSegment[]
  transcriptSource: 'audio'
  runtime?: { device: 'cpu' | 'cuda'; computeType: 'int8' | 'float16' | 'int8_float16'; fallbackMessage?: string }
}

export type VideoAudioTranscriptionQueueStatus =
  | 'pending'
  | 'running'
  /** Imported work that was active on another device; only an explicit retry may resume it. */
  | 'waiting-restart'
  | 'completed'
  | 'failed'
  | 'canceled'

export type VideoAudioTranscriptionQueueItem = VideoAudioTranscriptionRequest & {
  id: string
  status: VideoAudioTranscriptionQueueStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  /** A running worker acknowledges cancellation only after it exits. */
  cancelRequested?: boolean
  progress?: VideoAudioTranscriptionProgress
  errorMessage?: string
  /** Diagnostics are intentionally separate so the queue can show a concise actionable error. */
  errorDetails?: string
  failureKind?: VideoAudioTranscriptionFailureKind
  /** Authoritative runtime selected by the main-process provider for this job. */
  actualDevice?: 'cpu' | 'cuda'
  actualComputeType?: 'int8' | 'float16' | 'int8_float16'
  runtimeFallbackMessage?: string
  archiveNoteId?: string
  /** Exact immutable archive version registered for this completed queue job. */
  archiveVersionId?: string
  draftNote?: VideoNote
  /** Registration is separate from transcription so a retry never re-downloads audio. */
  archiveRegistrationStatus?: 'pending' | 'registered' | 'failed'
  archiveRegistrationError?: string
  archiveSummaryText?: string
  /** Empty ASR output is a normal completion and must not be presented as a summary failure. */
  transcriptOutcome?: 'no-speech'
  /** Independent from transcription/archive registration so summary-only retry never retranscribes audio. */
  summaryStatus?: VideoAudioTranscriptionSummaryStatus
}

export type VideoAudioTranscriptionQueueSnapshot = {
  items: VideoAudioTranscriptionQueueItem[]
  activeItemId?: string
  sessionCompletedCount: number
}
