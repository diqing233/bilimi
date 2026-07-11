import type { PetHoverShortcutId } from './petHoverShortcuts'

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

export type FavoriteLedger = {
  id: FavoriteLedgerId
  displayName: string
  keywords: string[]
  ruleType?: FavoriteLedgerRuleType
  enabled: boolean
  priority: number
  bilibiliFolderId?: string
  isDefault: boolean
}

export type FavoriteLedgerSaveOptions = {
  deleteDisabled?: boolean
}

export type FavoriteArchiveMultiMode = 'off' | 'two' | 'three'
export type CommentSubmitMode = 'choose' | 'random'
export type VideoAudioTranscriptionThreadLimit = 'unlimited' | 1 | 2 | 4
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

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  petStyle: 'big-head' | 'classic'
  petHoverShortcuts: PetHoverShortcutId[]
  showPetAssistantShortcut: boolean
  hidePetDuringVideoFullscreen: boolean
  closeBehavior: MainWindowCloseBehavior
  confirmBeforeExit: boolean
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  favoriteArchiveStrategy: FavoriteArchiveStrategy
  favoriteCorrectionLearningEnabled: boolean
  favoriteCorrectionLearningClassificationEnabled: boolean
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
  deepseekDailyClassificationMode: 'all' | 'low-confidence-only'
  deepseekModel: string
  deepseekBaseUrl: string
  permissionOnboardingCompleted: boolean
  assistantSidebarWidthPx: number | null
}

export type AssistantAutomationResult = {
  ok: boolean
  steps: string[]
  missingTargets: string[]
  message: string
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

export type FavoriteLedgerCandidateKind = 'author' | 'tag-cluster' | 'category' | 'series'

export type FavoriteLedgerCandidateConfidence = 'high' | 'medium'

export type NotePosterSummary = {
  title: string
  subtitle: string
  keyPoints: string[]
  keywords: string[]
  prompt: string
  polishedTranscriptText?: string
  auditChecklistText?: string
}

export type DeepSeekArchiveMode =
  | 'all'
  | 'classified-only'
  | 'unclassified-only'
  | 'low-confidence-and-unclassified'

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

export type DeepSeekKeyStatus = {
  configured: boolean
  protection: 'encrypted' | 'plaintext' | 'error' | 'unavailable'
}

export type DeepSeekConnectionTestResult = { ok: boolean; message: string }

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
  | 'queue-completed'

export type VideoAudioTranscriptionProgress = {
  step: VideoAudioTranscriptionProgressStep
  message: string
  segmentIndex?: number
  segmentCount?: number
}

export type VideoAudioTranscriptionRequest = {
  url: string
  title: string
  author?: string
  bvid?: string
  aid?: number | string
  cid?: number | string
  summarizeWithDeepSeek?: boolean
}

export type VideoAudioTranscriptionResult = {
  transcript: TranscriptSegment[]
  transcriptSource: 'audio'
}

export type VideoAudioTranscriptionQueueStatus =
  | 'pending'
  | 'running'
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
  progress?: VideoAudioTranscriptionProgress
  errorMessage?: string
  archiveNoteId?: string
  draftNote?: VideoNote
}

export type VideoAudioTranscriptionQueueSnapshot = {
  items: VideoAudioTranscriptionQueueItem[]
  activeItemId?: string
  sessionCompletedCount: number
}
