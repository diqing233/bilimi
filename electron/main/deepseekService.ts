import type {
  DeepSeekArchiveVideoResult,
  DeepSeekDailyClassificationReviewResult,
  DeepSeekErrorCode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteKeywordSuggestion,
  FavoriteKeywordSuggestionAction,
  NotePosterSummary,
  VideoNote
} from '../../src/shared/types'
import {
  applyFaithfulProofreadingBatch,
  assembleFaithfulTranscript,
  createFaithfulTranscriptBatches,
  createFaithfulTranscriptSegments,
  type FaithfulTranscriptBatch,
  type FaithfulTranscriptCorrection,
  type FaithfulTranscriptReviewItem
} from './faithfulTranscriptPolishing'
import { retryTransientDeepSeekRequest, type DeepSeekRetryDelay } from './deepseekRetry'

export type DeepSeekConfig = {
  enabled: boolean
  apiKey: string
  model: string
  baseUrl: string
}

type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type DeepSeekChoiceResponse = {
  model?: string
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
}

const REVIEW_COMMENT_CHARACTER_LIMIT = 100
const DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS = 90_000
const DEFAULT_PROOFREADING_REQUEST_TIMEOUT_MS = 20_000
const DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS = 300_000

const VALID_KEYWORD_SUGGESTION_ACTIONS = new Set<FavoriteKeywordSuggestionAction>([
  'add-keyword',
  'remove-keyword',
  'downgrade-to-weak',
  'replace-with-combination',
  'add-entity-alias',
  'add-concept-variant'
])

const BILIMI_PET_CHAT_CONTEXT = [
  'You are 小咪, the warm desktop pet assistant inside bilimi. Reply naturally, briefly, and in the user language.',
  'bilimi is a desktop app for watching Bilibili in an internal browser while organizing videos.',
  'Core features: 批阅 actions help like, coin, favorite, or draft comment choices for the current video; 掌库 manages bilimi· favorite ledgers and can create or sync folders; 札记 can generate video notes, transcribe audio, archive versions, and create DeepSeek summaries; settings configure the 小咪 pet and DeepSeek.',
  'DeepSeek-backed features include review comment drafting, video note summaries, and direct 小咪 chat. When DeepSeek is disabled, local button hints and fallback comments still work.',
  'When users ask about bilimi, explain these product features from 小咪’s point of view. Do not claim you can publish comments or change settings without the user choosing the relevant button.'
].join(' ')

export class DeepSeekServiceError extends Error {
  constructor(public readonly code: DeepSeekErrorCode, message: string) {
    super(message)
    this.name = 'DeepSeekServiceError'
  }
}

function createEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function trimTo(value: string, maxLength: number): string {
  const trimmed = value.trim()
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function coerceStringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, limit)
    : []
}

function isUnclassifiedLedgerId(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized === 'inbox' ||
    normalized === 'unclassified' ||
    normalized === '未分类' ||
    normalized === '未整理'
  )
}

function hasMeaningfulVideoSignal(video: {
  title?: string
  author?: string
  description?: string
  pageText?: string
  tags?: string[]
  category?: string
}): boolean {
  return [
    video.title,
    video.author,
    video.description,
    video.pageText,
    video.category,
    ...(video.tags ?? [])
  ].some((value) => typeof value === 'string' && value.trim().length >= 2)
}

function explainsUnclassifiedLastResort(reason: string): boolean {
  const normalized = reason.trim().toLowerCase()
  return [
    '空信息',
    '无有效信息',
    '信息不足',
    '无法判断',
    '无法归类',
    '不可分类',
    '广告',
    '垃圾',
    '风险',
    '违规',
    '不适合任何',
    '都不适合',
    '全部不适合',
    'no useful information',
    'insufficient information',
    'unsafe',
    'spam',
    'risk'
  ].some((keyword) => normalized.includes(keyword))
}

function shouldRejectUnclassifiedForMeaningfulVideo(args: {
  targetLedgerIds: string[]
  reason: string
  video?: {
    title?: string
    author?: string
    description?: string
    pageText?: string
    tags?: string[]
    category?: string
  }
}): boolean {
  return (
    args.targetLedgerIds.some(isUnclassifiedLedgerId) &&
    Boolean(args.video && hasMeaningfulVideoSignal(args.video)) &&
    !explainsUnclassifiedLastResort(args.reason)
  )
}

function isUsefulNoteKeyPoint(value: string): boolean {
  const normalized = value.replace(/\s+/g, '')
  return normalized.length >= 24
}

function isUsefulShortNoteKeyPoint(value: string): boolean {
  return value.replace(/\s+/g, '').length >= 8
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim()

  try {
    return JSON.parse(trimmed)
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek returned invalid JSON.')
    }

    try {
      return JSON.parse(match[0])
    } catch {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek returned invalid JSON.')
    }
  }
}

function invalidArchiveResult(
  row: Record<string, unknown> | undefined,
  errorMessage: string
): DeepSeekArchiveVideoResult {
  const aid = typeof row?.aid === 'number' && Number.isFinite(row.aid) ? row.aid : undefined
  const sourceFolderTitle =
    typeof row?.sourceFolderTitle === 'string' && row.sourceFolderTitle.trim()
      ? row.sourceFolderTitle.trim()
      : undefined
  return {
    aid,
    sourceFolderTitle,
    targetLedgerIds: coerceStringArray(row?.targetLedgerIds, 3),
    keepOriginal: row?.keepOriginal === true,
    reason: typeof row?.reason === 'string' ? row.reason.trim() : '',
    lowConfidence: row?.lowConfidence === true,
    secondPassChanged: row?.secondPassChanged === true,
    invalid: true,
    errorMessage
  }
}

function findArchiveRequestVideo(
  request: Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>,
  aid: number | undefined,
  sourceFolderTitle: string | undefined
) {
  if (aid === undefined) {
    return undefined
  }

  const matches = request.videos.filter(
    (video) =>
      video.aid === aid &&
      (!sourceFolderTitle || video.sourceFolderTitle.trim() === sourceFolderTitle)
  )
  return matches.length === 1 ? matches[0] : request.videos.find((video) => video.aid === aid)
}

function parseArchiveResultRow(
  request: Extract<DeepSeekGenerateRequest, { kind: 'favorite-archive-organize' }>,
  row: unknown
): DeepSeekArchiveVideoResult {
  if (!isRecord(row)) {
    return invalidArchiveResult(undefined, 'DeepSeek returned a non-object result row.')
  }

  const aid = typeof row.aid === 'number' && Number.isFinite(row.aid) ? row.aid : undefined
  const sourceFolderTitle =
    typeof row.sourceFolderTitle === 'string' && row.sourceFolderTitle.trim()
      ? row.sourceFolderTitle.trim()
      : undefined
  const targetLedgerIds = coerceStringArray(row.targetLedgerIds, 3)
  const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
  const invalidReasons: string[] = []

  if (aid === undefined) {
    invalidReasons.push('invalid aid')
  }
  if (!Array.isArray(row.targetLedgerIds) || targetLedgerIds.length === 0) {
    invalidReasons.push('invalid targetLedgerIds')
  }
  if (
    shouldRejectUnclassifiedForMeaningfulVideo({
      targetLedgerIds,
      reason,
      video: findArchiveRequestVideo(request, aid, sourceFolderTitle)
    })
  ) {
    invalidReasons.push('unclassified target should choose the closest existing enabled ledger')
  }

  const result: DeepSeekArchiveVideoResult = {
    aid,
    sourceFolderTitle,
    targetLedgerIds,
    keepOriginal: row.keepOriginal === true,
    reason,
    confidence: typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : undefined,
    lowConfidence: row.lowConfidence === true,
    secondPassChanged: row.secondPassChanged === true
  }

  if (invalidReasons.length > 0) {
    return {
      ...result,
      invalid: true,
      errorMessage: `DeepSeek result row is invalid: ${invalidReasons.join(', ')}.`
    }
  }

  return result
}

function enabledLedgerIdsForRequest(request: DeepSeekGenerateRequest): Set<string> {
  if (
    request.kind !== 'favorite-archive-organize' &&
    request.kind !== 'favorite-daily-classify-review'
  ) {
    return new Set()
  }

  return new Set(
    request.ledgers
      .filter((ledger) => ledger.enabled || ledger.id === 'inbox')
      .map((ledger) => ledger.id)
  )
}

function normalizeKeywordSuggestionId(input: {
  action: FavoriteKeywordSuggestionAction
  ledgerId?: string
  keyword?: string
  replacement?: string
}) {
  return [
    'deepseek',
    input.ledgerId ?? 'none',
    input.action,
    input.keyword ?? '',
    input.replacement ?? ''
  ].join(':')
}

function normalizeArchiveKeywordSuggestions(value: unknown): FavoriteKeywordSuggestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  const createdAt = new Date().toISOString()

  return value.flatMap((suggestion) => {
    if (
      !isRecord(suggestion) ||
      !VALID_KEYWORD_SUGGESTION_ACTIONS.has(suggestion.action as FavoriteKeywordSuggestionAction) ||
      typeof suggestion.reason !== 'string' ||
      !suggestion.reason.trim()
    ) {
      return []
    }

    const normalized: FavoriteKeywordSuggestion = {
      id: normalizeKeywordSuggestionId({
        action: suggestion.action as FavoriteKeywordSuggestionAction,
        ledgerId: typeof suggestion.ledgerId === 'string' ? suggestion.ledgerId.trim() : undefined,
        keyword: typeof suggestion.keyword === 'string' ? suggestion.keyword.trim() : undefined,
        replacement:
          typeof suggestion.replacement === 'string' ? suggestion.replacement.trim() : undefined
      }),
      action: suggestion.action as FavoriteKeywordSuggestionAction,
      ledgerId: typeof suggestion.ledgerId === 'string' ? suggestion.ledgerId.trim() : undefined,
      keyword: typeof suggestion.keyword === 'string' ? suggestion.keyword.trim() : undefined,
      replacement:
        typeof suggestion.replacement === 'string' ? suggestion.replacement.trim() : undefined,
      reason: suggestion.reason.trim(),
      source: 'deepseek',
      status: 'pending',
      createdAt
    }

    return [normalized]
  })
}

function invalidDailyClassificationReviewResult(
  row: Record<string, unknown>,
  targetLedgerIds: string[],
  reason: string,
  errorMessage: string
): DeepSeekDailyClassificationReviewResult {
  return {
    targetLedgerIds,
    appliedConstraintLedgerIds: [],
    corrected: false,
    reason,
    confidence:
      typeof row.confidence === 'number' && Number.isFinite(row.confidence)
        ? row.confidence
        : undefined,
    keywordSuggestions: normalizeArchiveKeywordSuggestions(row.keywordSuggestions),
    invalid: true,
    errorMessage
  }
}

function parseDailyClassificationReviewResult(
  request: Extract<DeepSeekGenerateRequest, { kind: 'favorite-daily-classify-review' }>,
  content: string
): DeepSeekGenerateResult {
  const parsed = parseJsonContent(content)
  const row = isRecord(parsed) ? parsed : {}
  const allowedLedgerIds = enabledLedgerIdsForRequest(request)
  const targetLedgerIds = coerceStringArray(row.targetLedgerIds, 3).filter((ledgerId) =>
    allowedLedgerIds.has(ledgerId)
  )
  const constrainedLedgerIds = new Set(request.ledgers
    .filter((ledger) => ledger.enabled && Boolean(ledger.deepSeekConstraint?.trim()))
    .map((ledger) => ledger.id))
  const appliedConstraintLedgerIds = coerceStringArray(row.appliedConstraintLedgerIds, 3).filter(
    (ledgerId) => targetLedgerIds.includes(ledgerId) && constrainedLedgerIds.has(ledgerId)
  )
  const confidence =
    typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : undefined
  const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
  const invalidReasons: string[] = []

  if (!Array.isArray(row.targetLedgerIds) || targetLedgerIds.length === 0) {
    invalidReasons.push('invalid targetLedgerIds')
  }
  if (confidence === undefined || confidence < 0 || confidence > 1) {
    invalidReasons.push('invalid confidence')
  }
  if (!reason) {
    invalidReasons.push('invalid reason')
  }
  if (
    shouldRejectUnclassifiedForMeaningfulVideo({
      targetLedgerIds,
      reason,
      video: request.video
    })
  ) {
    invalidReasons.push('unclassified target should choose the closest existing enabled ledger')
  }

  if (invalidReasons.length > 0) {
    return {
      kind: 'favorite-daily-classify-review',
      ...invalidDailyClassificationReviewResult(
        row,
        targetLedgerIds,
        reason,
        `DeepSeek daily classification review is invalid: ${invalidReasons.join(', ')}.`
      )
    }
  }

  return {
    kind: 'favorite-daily-classify-review',
    targetLedgerIds,
    appliedConstraintLedgerIds,
    corrected: row.corrected === true,
    reason,
    confidence,
    keywordSuggestions: normalizeArchiveKeywordSuggestions(row.keywordSuggestions)
  }
}

function buildMessages(request: DeepSeekGenerateRequest): DeepSeekMessage[] {
  if (request.kind === 'review-comment') {
    return [
      {
        role: 'system',
        content:
          'You write concise, playful Bilibili review comment candidates in Chinese. Each comment must be 100 characters or fewer. Mention the video title or UP name only when it fits naturally; do not force either into every comment. Return JSON only: {"comments":["...","...","..."]}.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          intent: request.intent,
          title: request.title,
          author: request.author,
          description: request.description,
          tags: request.tags,
          classification: request.classification
        })
      }
    ]
  }

  if (request.kind === 'favorite-archive-organize') {
    return [
      {
        role: 'system',
        content: [
          'You organize Bilibili favorite archive preview rows for bilimi.',
          'You may only output existing enabled bilimi ledgers from the provided ledger list, or 未分类 when the video should not be archived.',
          'When no exact ledger exists but the video has meaningful topic signals, choose the closest existing enabled ledger instead of 未分类.',
          'Use 未分类 only as a last resort for empty, unsafe, spammy, or genuinely unclassifiable videos; if you choose it, explain why no existing ledger fits.',
          'If a ledger has deepSeekConstraint, you must use it as folder-specific decision guidance. A matching constraint takes precedence over local keywords, automatic classifications, and existing targets. When a constraint applies, include that ledger in targetLedgerIds. It is not a keyword list; do not classify a video only because a word appears inside the constraint text. If applicable constraints conflict, choose the best-supported ledger.',
          'You cannot create folders and cannot directly edit keywords.',
          'Respect multiArchiveLimit for targetLedgerIds. Use keepOriginal only when the current targets should remain alongside the suggested targets.',
          'Return JSON only: {"results":[{"aid":1,"targetLedgerIds":["ledger-id"],"keepOriginal":false}]}. Include a short reason only when targetLedgerIds is ["未分类"].'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          mode: request.mode,
          multiArchiveLimit: request.multiArchiveLimit,
          ledgers: request.ledgers,
          videos: request.videos
        })
      }
    ]
  }

  if (request.kind === 'favorite-daily-classify-review') {
    return [
      {
        role: 'system',
        content: [
          'You review one daily Bilibili favorite classification for bilimi before the real action executes.',
          'You may only output existing enabled bilimi ledgers from the provided ledger list, or inbox/unclassified when the video should stay unclassified.',
          'When no exact ledger exists but the video has meaningful topic signals, choose the closest existing enabled ledger instead of inbox/unclassified.',
          'Use inbox/unclassified only as a last resort for empty, unsafe, spammy, or genuinely unclassifiable videos; if you choose it, explain why no existing ledger fits.',
          'When choosing a closest existing ledger for a missing exact topic, include keywordSuggestions only for the final chosen ledger.',
          'If a ledger has deepSeekConstraint, use it as folder-specific decision guidance. A matching constraint takes precedence over local keywords, automatic classifications, and existing targets. When a constraint applies, include that ledger in targetLedgerIds. It is not a keyword list; do not classify a video only because a word appears inside the constraint text. If applicable constraints conflict, choose the best-supported ledger and explain the conflict in reason.',
          'Do not create folders and do not directly edit keywords; keywordSuggestions are only pending suggestions for the user to review.',
          'Set corrected=true only when the local classification should be replaced before executing. If local targets are correct, echo them and set corrected=false.',
          'Return JSON only: {"targetLedgerIds":["ledger-id"],"appliedConstraintLedgerIds":["ledger-id"],"corrected":false,"reason":"","confidence":0.8,"keywordSuggestions":[{"action":"replace-with-combination","ledgerId":"game","keyword":"攻略","replacement":"游戏攻略","reason":""}]} Use appliedConstraintLedgerIds only for enabled ledgers whose deepSeekConstraint you actually applied, and only when that ledger is included in targetLedgerIds.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          video: request.video,
          localClassification: request.localClassification,
          ledgers: request.ledgers.filter((ledger) => ledger.enabled || ledger.id === 'inbox')
        })
      }
    ]
  }

  return [
    {
      role: 'system',
      content: BILIMI_PET_CHAT_CONTEXT
    },
    ...(request.context
      ? [
          {
            role: 'user' as const,
            content: `Current page context: ${JSON.stringify(request.context)}`
          }
        ]
      : []),
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content
    }))
  ]
}

function parseResult(
  request: DeepSeekGenerateRequest,
  content: string,
  finishReason?: string
): DeepSeekGenerateResult {
  if (request.kind === 'review-comment') {
    const parsed = parseJsonContent(content) as { comments?: unknown }
    const comments = coerceStringArray(parsed.comments, 3)
    if (
      comments.length !== 3 ||
      comments.some((comment) => comment.length > REVIEW_COMMENT_CHARACTER_LIMIT)
    ) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek did not return three comments.')
    }

    return { kind: 'review-comment', comments }
  }

  if (request.kind === 'favorite-archive-organize') {
    let parsed: { results?: unknown; keywordSuggestions?: unknown }
    try {
      parsed = parseJsonContent(content) as { results?: unknown; keywordSuggestions?: unknown }
    } catch (error) {
      if (error instanceof DeepSeekServiceError && finishReason === 'length') {
        throw new DeepSeekServiceError('invalid-output', `${error.message} (finish_reason: length)`)
      }
      throw error
    }

    if (!Array.isArray(parsed.results)) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek did not return archive results.')
    }

    return {
      kind: 'favorite-archive-organize',
      results: parsed.results.map((row) => parseArchiveResultRow(request, row)),
      keywordSuggestions: normalizeArchiveKeywordSuggestions(parsed.keywordSuggestions)
    }
  }

  if (request.kind === 'favorite-daily-classify-review') {
    return parseDailyClassificationReviewResult(request, content)
  }

  const message = trimTo(content, 220)
  if (!message) {
    throw new DeepSeekServiceError('invalid-output', 'DeepSeek returned an empty chat response.')
  }

  return { kind: 'pet-chat', message }
}

export async function generateDeepSeekResult(options: {
  config: DeepSeekConfig
  request: DeepSeekGenerateRequest
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Bounds each provider HTTP attempt so a stalled compatible endpoint cannot leave IPC pending forever. */
  requestTimeoutMs?: number
  onResponseMetadata?: (metadata: { model?: string; finishReason?: string }) => void
  retryDelay?: DeepSeekRetryDelay
  notePosterCheckpoint?: {
    polishedTranscriptText?: string
    completedBatchIds?: string[]
    polishedTextBySegmentId?: Record<string, string>
    corrections?: FaithfulTranscriptCorrection[]
    reviewItems?: FaithfulTranscriptReviewItem[]
    proofreadingCompleted: boolean
  }
  onNotePosterCheckpoint?: (checkpoint: {
    completedBatchIds: string[]
    polishedTextBySegmentId: Record<string, string>
    corrections: FaithfulTranscriptCorrection[]
    reviewItems: FaithfulTranscriptReviewItem[]
    proofreadingCompleted: boolean
  }) => void
  onNotePosterProgress?: (progress: {
    stage: 'proofreading-batch' | 'summary'
    batchIndex?: number
    batchCount?: number
  }) => void
}): Promise<DeepSeekGenerateResult> {
  const apiKey = options.config.apiKey.trim()
  if (!options.config.enabled || !apiKey) {
    throw new DeepSeekServiceError('not-configured', 'DeepSeek is not configured.')
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_DEEPSEEK_REQUEST_TIMEOUT_MS

  const requestMessages = async (
    messages: DeepSeekMessage[],
    temperature: number,
    responseFormatJson = false,
    timeoutMs = requestTimeoutMs
  ): Promise<{ content: string; finishReason?: string }> => {
    let response: Response
    try {
      response = await retryTransientDeepSeekRequest(async () => {
        const request = createBoundedRequestSignal(options.signal, timeoutMs)
        try {
          const next = await fetchImpl(createEndpoint(options.config.baseUrl), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            signal: request.signal,
            body: JSON.stringify({
              model: options.config.model,
              messages,
              temperature,
              ...(responseFormatJson ? { response_format: { type: 'json_object' } } : {})
            })
          })
          if (!next.ok) {
            throw new DeepSeekServiceError(
              'api-error',
              `DeepSeek API request failed: ${next.status} ${next.statusText}`.trim()
            )
          }
          return next
        } catch (error) {
          if (request.timedOut()) {
            throw new DeepSeekServiceError(
              'network-error',
              `DeepSeek request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
            )
          }
          throw error
        } finally {
          request.dispose()
        }
      }, { delay: options.retryDelay, signal: options.signal })
    } catch (error) {
      if (error instanceof DeepSeekServiceError) throw error
      throw new DeepSeekServiceError(
        'network-error',
        error instanceof Error ? error.message : 'DeepSeek network request failed.'
      )
    }

    let payload: DeepSeekChoiceResponse
    try {
      payload = JSON.parse(await response.text()) as DeepSeekChoiceResponse
    } catch {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek returned invalid response JSON.')
    }

    const finishReason =
      typeof payload.choices?.[0]?.finish_reason === 'string' && payload.choices[0].finish_reason.trim()
        ? payload.choices[0].finish_reason.trim()
        : undefined
    options.onResponseMetadata?.({
      model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : undefined,
      finishReason
    })
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek response did not include content.')
    }
    return { content, finishReason }
  }

  if (options.request.kind === 'note-poster') {
    const note = options.request.note
    const sourceSegments = createFaithfulTranscriptSegments(note)
    const batches = createFaithfulTranscriptBatches(note)
    const sourceTextById = new Map(sourceSegments.map((segment) => [segment.id, segment.text]))
    const polishedTextBySegmentId = new Map(sourceTextById)
    for (const [id, text] of Object.entries(options.notePosterCheckpoint?.polishedTextBySegmentId ?? {})) {
      if (sourceTextById.has(id) && typeof text === 'string') polishedTextBySegmentId.set(id, text)
    }
    const completedBatchIds = new Set(options.notePosterCheckpoint?.completedBatchIds ?? [])
    const corrections: FaithfulTranscriptCorrection[] = [...(options.notePosterCheckpoint?.corrections ?? [])]
    const reviewItems: FaithfulTranscriptReviewItem[] = [...(options.notePosterCheckpoint?.reviewItems ?? [])]

    for (const [batchIndex, batch] of batches.entries()) {
      if (options.notePosterCheckpoint?.proofreadingCompleted || completedBatchIds.has(batch.sourceStartSegmentId)) continue
      options.onNotePosterProgress?.({
        stage: 'proofreading-batch',
        batchIndex: batchIndex + 1,
        batchCount: batches.length
      })
      let response: Awaited<ReturnType<typeof requestMessages>>
      try {
        response = await requestMessages(
          createProofreadingMessages(batch),
          0.1,
          true,
          Math.min(requestTimeoutMs, DEFAULT_PROOFREADING_REQUEST_TIMEOUT_MS)
        )
      } catch (error) {
        const proofreadingTimedOut =
          error instanceof DeepSeekServiceError &&
          error.code === 'network-error' &&
          /timed out/i.test(error.message)
        if (!proofreadingTimedOut) throw error

        // Some compatible gateways cannot finish structured proofreading even
        // for tiny batches. Preserve the source transcript and continue with
        // the user's requested summary instead of blocking the whole action.
        for (const remainingBatch of batches.slice(batchIndex)) {
          completedBatchIds.add(remainingBatch.sourceStartSegmentId)
        }
        options.onNotePosterCheckpoint?.({
          completedBatchIds: [...completedBatchIds],
          polishedTextBySegmentId: Object.fromEntries([...polishedTextBySegmentId]
            .filter(([id, text]) => sourceTextById.get(id) !== text)),
          corrections,
          reviewItems,
          proofreadingCompleted: true
        })
        break
      }
      let parsed: unknown
      try {
        parsed = parseJsonContent(response.content)
        const result = applyFaithfulProofreadingBatch(batch, parsed, response.finishReason)
        for (const segment of result.polishedSegments) polishedTextBySegmentId.set(segment.id, segment.text)
        corrections.push(...result.corrections)
        reviewItems.push(...result.reviewItems)
        completedBatchIds.add(batch.sourceStartSegmentId)
        options.onNotePosterCheckpoint?.({
          completedBatchIds: [...completedBatchIds],
          polishedTextBySegmentId: Object.fromEntries([...polishedTextBySegmentId]
            .filter(([id, text]) => sourceTextById.get(id) !== text)),
          corrections,
          reviewItems,
          proofreadingCompleted: completedBatchIds.size === batches.length
        })
      } catch (error) {
        throw new DeepSeekServiceError(
          'invalid-output',
          error instanceof Error ? error.message : 'DeepSeek 保真精修结果无效。'
        )
      }
    }

    const polishedTranscriptText = options.notePosterCheckpoint?.proofreadingCompleted && options.notePosterCheckpoint.polishedTranscriptText
      ? options.notePosterCheckpoint.polishedTranscriptText
      : assembleFaithfulTranscript(sourceSegments, polishedTextBySegmentId)
    options.onNotePosterProgress?.({ stage: 'summary' })
    const summaryTimeoutMs = options.requestTimeoutMs === undefined
      ? DEFAULT_SUMMARY_REQUEST_TIMEOUT_MS
      : Math.max(requestTimeoutMs, requestTimeoutMs * 2)
    const summaryResponse = await requestMessages(
      createSummaryMessages(note, polishedTranscriptText),
      0.3,
      true,
      summaryTimeoutMs
    )
    if (summaryResponse.finishReason === 'length') {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek 总结结果被长度限制截断。')
    }
    const parsedRoot = parseJsonContent(summaryResponse.content) as Partial<NotePosterSummary> & Record<string, unknown>
    const parsed = parsedRoot.summary && typeof parsedRoot.summary === 'object'
      ? parsedRoot.summary as Partial<NotePosterSummary> & Record<string, unknown>
      : parsedRoot
    let title = [parsed.title, parsed.标题, parsed.heading]
      .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
      ?.trim() ?? ''
    let subtitle = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : ''
    // Poster prompt had no consumer; do not spend output tokens persisting it.
    const prompt = ''
    let keyPoints = coerceStringArray(parsed.keyPoints, Number.MAX_SAFE_INTEGER)
    const keywords: string[] = []
    let returnedDetailedOutline = coerceStringArray(parsed.detailedOutline, Number.MAX_SAFE_INTEGER)
    const missingFields = [
      ...(!title ? ['title'] : []),
      ...(!subtitle ? ['subtitle'] : []),
      ...(keyPoints.length === 0 ? ['keyPoints'] : []),
      ...(returnedDetailedOutline.length === 0 ? ['detailedOutline'] : [])
    ]
    if (missingFields.length > 0) {
      try {
        const repairResponse = await requestMessages(
          createSummaryRepairMessages({
            note,
            polishedTranscriptText,
            missingFields,
            existing: { title, subtitle, keyPoints, detailedOutline: returnedDetailedOutline }
          }),
          0.1,
          true,
          summaryTimeoutMs
        )
        const repaired = parseJsonContent(repairResponse.content) as Partial<NotePosterSummary> & Record<string, unknown>
        if (!title) {
          title = [repaired.title, repaired.标题, repaired.heading]
            .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
            ?.trim() ?? ''
        }
        if (!subtitle && typeof repaired.subtitle === 'string') subtitle = repaired.subtitle.trim()
        if (keyPoints.length === 0) keyPoints = coerceStringArray(repaired.keyPoints, Number.MAX_SAFE_INTEGER)
        if (returnedDetailedOutline.length === 0) {
          returnedDetailedOutline = coerceStringArray(repaired.detailedOutline, Number.MAX_SAFE_INTEGER)
        }
      } catch (error) {
        if (options.signal?.aborted) throw error
      }
    }
    const detailedOutline = mergeReviewItemsIntoDetailedOutline(returnedDetailedOutline, [
      ...reviewItems.map((item) => ({ text: item.originalText, reason: item.reason }))
    ])
    if (!title && subtitle && keyPoints.length > 0 && detailedOutline.length > 0) {
      title = note.source.title.trim()
    }
    const invalidReasons: string[] = []
    if (!title) invalidReasons.push('缺少标题')
    if (!subtitle) invalidReasons.push('缺少主旨')
    if (keyPoints.length === 0) invalidReasons.push('缺少核心内容')
    if (detailedOutline.length === 0) invalidReasons.push('缺少详细内容提要')
    if (invalidReasons.length > 0) {
      throw new DeepSeekServiceError('invalid-output', `DeepSeek 总结内容不完整：${invalidReasons.join('、')}。`)
    }

    return {
      kind: 'note-poster',
      poster: {
        title,
        subtitle,
        keyPoints,
        keywords,
        prompt,
        polishedTranscriptText,
        detailedOutline,
        reviewItems: []
      }
    }
  }

  let response: Response

  try {
    response = await fetchWithBoundedTimeout(fetchImpl, createEndpoint(options.config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: options.config.model,
        messages: buildMessages(options.request),
        temperature: options.request.kind === 'pet-chat' ? 0.7 : 0.4,
        ...(options.request.kind === 'favorite-archive-organize'
          ? {
              response_format: { type: 'json_object' }
            }
          : {})
      })
    }, options.signal, requestTimeoutMs)
  } catch (error) {
    throw new DeepSeekServiceError(
      'network-error',
      error instanceof Error ? error.message : 'DeepSeek network request failed.'
    )
  }

  if (!response.ok) {
    throw new DeepSeekServiceError(
      'api-error',
      `DeepSeek API request failed: ${response.status} ${response.statusText}`.trim()
    )
  }

  let payload: DeepSeekChoiceResponse
  try {
    payload = JSON.parse(await response.text()) as DeepSeekChoiceResponse
  } catch {
    throw new DeepSeekServiceError('invalid-output', 'DeepSeek returned invalid response JSON.')
  }

  options.onResponseMetadata?.({
    model: typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : undefined,
    finishReason: typeof payload.choices?.[0]?.finish_reason === 'string' && payload.choices[0].finish_reason.trim()
      ? payload.choices[0].finish_reason.trim()
      : undefined
  })

  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new DeepSeekServiceError('invalid-output', 'DeepSeek response did not include content.')
  }

  return parseResult(options.request, content, payload.choices?.[0]?.finish_reason)
}

function createBoundedRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }
}

async function fetchWithBoundedTimeout(
  fetchImpl: typeof fetch,
  endpoint: string,
  init: Omit<RequestInit, 'signal'>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<Response> {
  const request = createBoundedRequestSignal(parentSignal, timeoutMs)
  try {
    return await fetchImpl(endpoint, { ...init, signal: request.signal })
  } catch (error) {
    if (request.timedOut()) {
      throw new DeepSeekServiceError(
        'network-error',
        `DeepSeek request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
      )
    }
    throw error
  } finally {
    request.dispose()
  }
}

function mergeReviewItemsIntoDetailedOutline(
  outline: string[],
  reviewItems: Array<{ text: string; reason: string }>
): string[] {
  const merged = [...outline]
  for (const item of reviewItems) {
    const index = merged.findIndex((detail) => detail.includes(item.text))
    const marker = `${item.text}（待确认：${item.reason}）`
    if (index >= 0) merged[index] = merged[index].replace(item.text, marker).replace(/）\s+/gu, '）')
    else merged.push(`待确认：${item.text}（${item.reason}）`)
  }
  return merged
}

const FAITHFUL_PROOFREADING_SYSTEM_PROMPT = [
  '你是视频转写文稿校对助手。你的任务是保真校对，不是总结、缩写、润色或重新创作。',
  '原始文稿不可删减。不得删除、压缩、概括、合并、调换或补写任何内容。',
  '必须保留嗯、啊、然后、就是说等口语词，保留所有重复词和重复句，不添加重复标记。',
  '外语原文必须保留，不得用中文翻译覆盖。不得猜测或添加说话人身份。',
  '只允许提出标点、断句、词语断裂、基础格式和结合完整上下文高度确定的转写错误修改。优先补齐自然的逗号、句号、问号和感叹号，避免把每个短语都改成句号。',
  '不得纠正讲者本人的事实观点。无法确定时保持原文并加入 reviewItems。',
  '不得返回重写后的完整文稿，只返回需要修改的唯一原文位置。未列出的内容由程序原样保留。',
  '数字、人名、机构、品牌、型号、日期、单位、标识、否定词、程度词、条件词、转折词属于高风险内容；修改时 highRisk 必须为 true。',
  '每项 originalText 必须与对应主处理片段中的唯一子串完全一致。上下文片段只用于理解，禁止修改。',
  '只返回合法 JSON：{"sourceStartSegmentId":"","sourceEndSegmentId":"","changes":[{"segmentId":"","originalText":"","replacementText":"","changeType":"punctuation | sentence-boundary | transcription-error | formatting","reason":"","confidence":0.0,"highRisk":false}],"reviewItems":[{"segmentId":"","originalText":"","reason":"","possibleInterpretation":""}]}。'
].join(' ')

const FAITHFUL_SUMMARY_SYSTEM_PROMPT = [
  '你是视频文稿整理助手，只依据精修文稿使用简体中文输出。',
  '精准总结：title 点明主题，subtitle 概括主旨，keyPoints 保留重要过程、数字、条件和结论；不设固定条数，不为简短遗漏信息。',
  '详细内容提要：detailedOutline 按讲述顺序或主题完整展开，可用二级列表；保留人物、名称、数字、时间、案例、规则、观点归属、结论和限定条件，禁止机械字段拼接。',
  '无法确认的名称在相关提要中简短注明，不另设待人工确认。不得猜测或编造材料外信息。精修文稿由程序原样保留，无需重新输出。',
  '只返回 JSON：{"title":"","subtitle":"","keyPoints":[],"detailedOutline":[]}。'
].join(' ')

function createProofreadingMessages(batch: FaithfulTranscriptBatch): DeepSeekMessage[] {
  return [
    { role: 'system', content: FAITHFUL_PROOFREADING_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        task: {
          sourceStartSegmentId: batch.sourceStartSegmentId,
          sourceEndSegmentId: batch.sourceEndSegmentId,
          instruction: 'contextSegments 只用于理解；只允许修改 primarySegments。'
        },
        contextSegments: batch.contextSegments,
        primarySegments: batch.primarySegments
      })
    }
  ]
}

function createSummaryMessages(note: VideoNote, polishedTranscriptText: string): DeepSeekMessage[] {
  return [
    { role: 'system', content: FAITHFUL_SUMMARY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        source: note.source,
        polishedTranscriptText,
        chapters: note.chapters,
        annotations: note.annotations,
        userMemo: note.userMemo
      })
    }
  ]
}

function createSummaryRepairMessages(input: {
  note: VideoNote
  polishedTranscriptText: string
  missingFields: string[]
  existing: Pick<NotePosterSummary, 'title' | 'subtitle' | 'keyPoints' | 'detailedOutline'>
}): DeepSeekMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你只补全视频总结缺失字段，不重写已有字段。只依据提供的精修文稿，不得猜测。',
        '核心内容和详细内容提要不设固定条数或字数；内容有效、具体且非空即可。',
        `只返回这些字段的 JSON：${input.missingFields.join('、')}。`
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        missingFields: input.missingFields,
        existing: input.existing,
        source: input.note.source,
        polishedTranscriptText: input.polishedTranscriptText
      })
    }
  ]
}
