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
  | 'animation'
  | 'kichiku'
  | 'dance'
  | 'entertainment'
  | 'tech-digital'
  | 'food'
  | 'car'
  | 'sports'
  | 'game'
  | 'music'
  | 'movie-tv'
  | 'knowledge'
  | 'news'
  | 'short-drama'
  | 'fashion-beauty'
  | 'animal'
  | 'home-property'
  | 'travel'
  | 'emotion'
  | 'uhd'
  | 'vlog'
  | 'outdoor'
  | 'rural'
  | 'life-interest'
  | 'podcast'
  | 'painting'
  | 'fitness'
  | 'parenting'
  | 'life-tips'
  | 'ai'
  | 'handmade'
  | 'health'
  | 'public-good'
  | 'documentary'
  | 'inbox'

export type FavoriteLedgerId = string
export type RecommendationKind = FavoriteLedgerId

export type FavoriteLedger = {
  id: FavoriteLedgerId
  displayName: string
  keywords: string[]
  enabled: boolean
  priority: number
  bilibiliFolderId?: string
  isDefault: boolean
}

export type FavoriteLedgerSaveOptions = {
  deleteDisabled?: boolean
}

export type FavoriteLedgerClassification = {
  ledgerId: FavoriteLedgerId
  displayName: string
  matchedKeywords: string[]
  reviewRequired: boolean
  suggestedLedgerId?: FavoriteLedgerId
  suggestedDisplayName?: string
}

export type FavoriteLedgerStatus = {
  ok: boolean
  ledgers: FavoriteLedger[]
  missingLedgerIds: FavoriteLedgerId[]
  message: string
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
  hidePetDuringVideoFullscreen: boolean
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  preferenceCounts: Record<string, number>
  deepseekEnabled: boolean
  deepseekApiKeyStored: boolean
  deepseekModel: string
  deepseekBaseUrl: string
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

export type FavoriteLedgerCandidateSummary = {
  kind: FavoriteLedgerCandidateKind
  sourceName: string
  displayName: string
  keywords: string[]
  count: number
  confidence: FavoriteLedgerCandidateConfidence
  reason: string
  aiEnhanced: boolean
}

export type FavoriteLedgerAiSuggestion = {
  sourceKind: FavoriteLedgerCandidateKind
  sourceName: string
  displayName: string
  keywords: string[]
  reason: string
}

export type NotePosterSummary = {
  title: string
  subtitle: string
  keyPoints: string[]
  keywords: string[]
  prompt: string
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
      kind: 'favorite-ledger-insights'
      totalVideos: number
      topAuthors: FavoriteLedgerAuthorInsightSignal[]
      topTags: FavoriteLedgerInsightSignal[]
      topCategories: FavoriteLedgerInsightSignal[]
      titleSeries: FavoriteLedgerInsightSignal[]
      candidates: FavoriteLedgerCandidateSummary[]
    }
  | {
      kind: 'pet-chat'
      messages: DeepSeekChatMessage[]
      context?: { title?: string; pageText?: string }
    }

export type DeepSeekGenerateResult =
  | { kind: 'review-comment'; comments: string[] }
  | { kind: 'note-poster'; poster: NotePosterSummary }
  | { kind: 'favorite-ledger-insights'; suggestions: FavoriteLedgerAiSuggestion[] }
  | { kind: 'pet-chat'; message: string }

export type DeepSeekKeyStatus = { configured: boolean }

export type DeepSeekConnectionTestResult = { ok: boolean; message: string }

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

export type VideoAudioTranscriptionProgress = {
  step: VideoAudioTranscriptionProgressStep
  message: string
  segmentIndex?: number
  segmentCount?: number
}

export type VideoAudioTranscriptionRequest = {
  url: string
  title: string
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
}

export type VideoAudioTranscriptionQueueSnapshot = {
  items: VideoAudioTranscriptionQueueItem[]
  activeItemId?: string
}
