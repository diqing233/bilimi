import type {
  FavoriteCorrectionFeedbackType,
  FavoriteCorrectionRecord,
  FavoriteCorrectionSource,
  FavoriteKeywordSuggestion,
  FavoriteKeywordSuggestionAction,
  FavoriteKeywordSuggestionStatus,
  FavoriteLedgerId
} from '@shared/types'

type CorrectionDraftInput = {
  aid: number
  title: string
  originalLedgerId?: FavoriteLedgerId
  userLedgerIds: FavoriteLedgerId[]
  source: FavoriteCorrectionSource
  feedbackType?: FavoriteCorrectionFeedbackType
  sourceScene: FavoriteCorrectionRecord['sourceScene']
  sourceFolderTitle?: string
  author?: string
  tags: string[]
  matchedKeywords?: string[]
  score?: number
  confidence?: FavoriteCorrectionRecord['confidence']
  scoreGap?: number
  createdAt?: string
}

const VALID_KEYWORD_SUGGESTION_ACTIONS = new Set<FavoriteKeywordSuggestionAction>([
  'add-keyword',
  'remove-keyword',
  'downgrade-to-weak',
  'replace-with-combination',
  'add-entity-alias',
  'add-concept-variant'
])

const VALID_KEYWORD_SUGGESTION_STATUSES = new Set<FavoriteKeywordSuggestionStatus>([
  'pending',
  'accepted',
  'ignored',
  'deleted'
])

const VALID_CORRECTION_SOURCES = new Set<FavoriteCorrectionSource>([
  'user',
  'deepseek',
  'user-confirmed-deepseek',
  'classifier'
])

const VALID_CORRECTION_FEEDBACK_TYPES = new Set<FavoriteCorrectionFeedbackType>([
  'strong-correction',
  'weak-negative'
])

const VALID_CORRECTION_SOURCE_SCENES = new Set<FavoriteCorrectionRecord['sourceScene']>([
  'archive-preview',
  'daily-favorite'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))
      )
    : []
}

function correctionRecordId(
  input: Pick<CorrectionDraftInput, 'aid' | 'source' | 'sourceScene' | 'userLedgerIds'> & {
    createdAt: string
  }
) {
  const targets = uniqueLedgerIds(input.userLedgerIds).join(',')
  return `${input.sourceScene}:${input.source}:${input.aid}:${input.createdAt}:${targets}`
}

function uniqueLedgerIds(ledgerIds: unknown[]) {
  return Array.from(
    new Set(
      ledgerIds
        .filter((ledgerId): ledgerId is string => typeof ledgerId === 'string' && ledgerId.trim().length > 0)
        .map((ledgerId) => ledgerId.trim() as FavoriteLedgerId)
    )
  )
}

export function createCorrectionDraft(input: CorrectionDraftInput): FavoriteCorrectionRecord {
  const createdAt = input.createdAt ?? new Date().toISOString()

  return {
    id: correctionRecordId({ ...input, createdAt }),
    aid: input.aid,
    title: input.title,
    originalLedgerId: input.originalLedgerId,
    userLedgerIds: uniqueLedgerIds(input.userLedgerIds),
    source: input.source,
    feedbackType: input.feedbackType ?? 'strong-correction',
    sourceScene: input.sourceScene,
    sourceFolderTitle: input.sourceFolderTitle,
    author: input.author,
    tags: [...input.tags],
    matchedKeywords: [...(input.matchedKeywords ?? [])],
    score: input.score,
    confidence: input.confidence,
    scoreGap: input.scoreGap,
    createdAt
  }
}

export function confirmCorrectionDrafts(
  drafts: FavoriteCorrectionRecord[],
  now: string
): FavoriteCorrectionRecord[] {
  return drafts.map((draft) => ({
    ...draft,
    userLedgerIds: uniqueLedgerIds(draft.userLedgerIds),
    tags: [...draft.tags],
    matchedKeywords: [...draft.matchedKeywords],
    confirmedAt: draft.confirmedAt ?? now
  }))
}

export function discardCorrectionDrafts(
  drafts: FavoriteCorrectionRecord[],
  aid?: number
): FavoriteCorrectionRecord[] {
  return drafts.filter((draft) => draft.confirmedAt || (aid !== undefined && draft.aid !== aid))
}

export function applyAidCorrectionMemory(
  context: { aid?: number | string },
  records: FavoriteCorrectionRecord[]
): { ledgerIds: FavoriteLedgerId[]; record: FavoriteCorrectionRecord } | null {
  const aid = Number(context.aid)
  if (!Number.isFinite(aid)) {
    return null
  }

  const record = [...records]
    .reverse()
    .find(
      (candidate) =>
        candidate.confirmedAt &&
        candidate.feedbackType === 'strong-correction' &&
        candidate.aid === aid &&
        Array.isArray(candidate.userLedgerIds) &&
        candidate.userLedgerIds.length > 0
    )

  return record ? { ledgerIds: [...record.userLedgerIds], record } : null
}

export function normalizeCorrectionRecords(records: unknown): FavoriteCorrectionRecord[] {
  if (!Array.isArray(records)) {
    return []
  }

  return records.flatMap((record) => {
    if (
      !isRecord(record) ||
      typeof record.id !== 'string' ||
      typeof record.aid !== 'number' ||
      !Number.isFinite(record.aid) ||
      typeof record.title !== 'string' ||
      !Array.isArray(record.userLedgerIds) ||
      !VALID_CORRECTION_SOURCES.has(record.source as FavoriteCorrectionSource) ||
      !VALID_CORRECTION_FEEDBACK_TYPES.has(record.feedbackType as FavoriteCorrectionFeedbackType) ||
      !VALID_CORRECTION_SOURCE_SCENES.has(record.sourceScene as FavoriteCorrectionRecord['sourceScene']) ||
      typeof record.createdAt !== 'string'
    ) {
      return []
    }

    const normalized: FavoriteCorrectionRecord = {
      id: record.id,
      aid: record.aid,
      title: record.title,
      originalLedgerId:
        typeof record.originalLedgerId === 'string' ? (record.originalLedgerId as FavoriteLedgerId) : undefined,
      userLedgerIds: uniqueLedgerIds(record.userLedgerIds as FavoriteLedgerId[]),
      source: record.source as FavoriteCorrectionSource,
      feedbackType: record.feedbackType as FavoriteCorrectionFeedbackType,
      sourceScene: record.sourceScene as FavoriteCorrectionRecord['sourceScene'],
      sourceFolderTitle:
        typeof record.sourceFolderTitle === 'string' ? record.sourceFolderTitle : undefined,
      author: typeof record.author === 'string' ? record.author : undefined,
      tags: normalizeStringArray(record.tags),
      matchedKeywords: normalizeStringArray(record.matchedKeywords),
      score: typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : undefined,
      confidence:
        record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low'
          ? record.confidence
          : undefined,
      scoreGap:
        typeof record.scoreGap === 'number' && Number.isFinite(record.scoreGap)
          ? record.scoreGap
          : undefined,
      createdAt: record.createdAt,
      confirmedAt: typeof record.confirmedAt === 'string' ? record.confirmedAt : undefined
    }

    return [normalized]
  })
}

export function normalizeKeywordSuggestions(
  suggestions: unknown
): FavoriteKeywordSuggestion[] {
  if (!Array.isArray(suggestions)) {
    return []
  }

  return suggestions
    .filter(
      (suggestion) =>
        isRecord(suggestion) &&
        typeof suggestion.id === 'string' &&
        VALID_KEYWORD_SUGGESTION_ACTIONS.has(suggestion.action as FavoriteKeywordSuggestionAction) &&
        VALID_KEYWORD_SUGGESTION_STATUSES.has(suggestion.status as FavoriteKeywordSuggestionStatus) &&
        VALID_CORRECTION_SOURCES.has(suggestion.source as FavoriteCorrectionSource) &&
        typeof suggestion.reason === 'string' &&
        typeof suggestion.createdAt === 'string'
    )
    .map((suggestion) => ({ ...(suggestion as FavoriteKeywordSuggestion) }))
}
