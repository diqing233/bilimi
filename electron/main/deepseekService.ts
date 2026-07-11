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
  choices?: Array<{ message?: { content?: string } }>
}

const REVIEW_COMMENT_CHARACTER_LIMIT = 100

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

function trimJsonPayload<T>(items: T[], maxLength: number): T[] {
  const selected: T[] = []
  let usedLength = 2

  for (const item of items) {
    const serialized = JSON.stringify(item)
    const nextLength = usedLength + serialized.length + (selected.length > 0 ? 1 : 0)
    if (nextLength > maxLength) {
      break
    }

    selected.push(item)
    usedLength = nextLength
  }

  return selected
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function selectTranscriptForSummary(note: VideoNote): VideoNote['transcript'] {
  const transcript = note.transcript.filter((segment) => Boolean(segment.text.trim()))
  if (transcript.length <= 30) {
    return transcript
  }

  const head = trimJsonPayload(transcript, 18000)
  if (head.length === transcript.length) {
    return head
  }

  const tail = trimJsonPayload([...transcript].reverse(), 6000).reverse()
  const selected = [...head, ...tail].filter(
    (segment, index, segments) =>
      segments.findIndex(
        (candidate) =>
          candidate.start === segment.start &&
          candidate.end === segment.end &&
          candidate.text === segment.text
      ) === index
  )

  return selected
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

function summarizeNote(note: VideoNote): string {
  return JSON.stringify({
    source: note.source,
    overview: note.overview,
    transcript: selectTranscriptForSummary(note),
    chapters: note.chapters.slice(0, 12),
    annotations: note.annotations.slice(0, 12),
    userMemo: note.userMemo
  })
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
  const confidence =
    typeof row.confidence === 'number' && Number.isFinite(row.confidence) ? row.confidence : undefined
  const invalidReasons: string[] = []

  if (aid === undefined) {
    invalidReasons.push('invalid aid')
  }
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
    confidence,
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

  if (request.kind === 'note-poster') {
    return [
      {
        role: 'system',
        content:
          [
            '你是 DeepSeek 视频札记总结助手，请使用简体中文处理视频文稿。',
            '第一阶段：先作为专业文稿整理编辑，基于用户提供的视频标题、简介、完整可用文稿、章节、批注和备注生成“精修文稿” polishedTranscriptText。严格按视频讲述顺序整理，尽量信息不失真，不得总结、压缩、简化、合并删减案例、数据、对话、观点、举例、数字、问答细节或限制条件；保留所有人物对话、数值、时间、案例、正反观点、专有名词、分点论述和问答内容；只修正明显错别字、口误、断句和语病，修改后原意不变；非中文内容翻译成中文来分析；识别不确定处用“疑似：”标注。',
            '第二阶段：再基于 polishedTranscriptText 生成精准总结。title 点出主题；subtitle 写整体主旨；keyPoints 输出 6 到 8 条可复习的核心内容，每条保留关键数据、核心结论、中心观点、重要举例、限制条件，去掉口水话、重复话和铺垫话，但禁止过度精简导致信息缺失；keywords 输出 4 到 8 个关键词。',
            '最后生成“内容核对清单” auditChecklistText，列出原文全部核心信息点，包括人物、数据、时间、案例、观点、问答、结论和可能需要人工确认的内容，证明无遗漏。不要编造材料外的信息。',
            'Return JSON only: {"title":"","subtitle":"","keyPoints":[],"keywords":[],"prompt":"","polishedTranscriptText":"","auditChecklistText":""}.'
          ].join(' ')
      },
      {
        role: 'user',
        content: summarizeNote(request.note)
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
          'When choosing a closest existing ledger for a missing exact topic, include keywordSuggestions only for the final chosen ledger.',
          'If a ledger has deepSeekConstraint, you must use it as folder-specific decision guidance. It is not a keyword list; do not classify a video only because a word appears inside the constraint text.',
          'You cannot create folders and cannot directly edit keywords; keywordSuggestions are only pending suggestions for the user to review.',
          'Echo sourceFolderTitle from each input video in every result so duplicate aid rows from different source folders can be applied to the intended row.',
          'Respect multiArchiveLimit for targetLedgerIds. Use keepOriginal only when the current targets should remain alongside the suggested targets.',
          'Return JSON only: {"results":[{"aid":1,"sourceFolderTitle":"默认收藏夹","targetLedgerIds":["ledger-id"],"keepOriginal":false,"reason":"","confidence":0.8,"lowConfidence":false,"secondPassChanged":false}],"keywordSuggestions":[{"action":"replace-with-combination","ledgerId":"game","keyword":"攻略","replacement":"游戏攻略","reason":""}]}'
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
          'If a ledger has deepSeekConstraint, use it as folder-specific decision guidance. It is not a keyword list; do not classify a video only because a word appears inside the constraint text.',
          'Do not create folders and do not directly edit keywords; keywordSuggestions are only pending suggestions for the user to review.',
          'Set corrected=true only when the local classification should be replaced before executing. If local targets are correct, echo them and set corrected=false.',
          'Return JSON only: {"targetLedgerIds":["ledger-id"],"corrected":false,"reason":"","confidence":0.8,"keywordSuggestions":[{"action":"replace-with-combination","ledgerId":"game","keyword":"攻略","replacement":"游戏攻略","reason":""}]}'
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
  content: string
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

  if (request.kind === 'note-poster') {
    const parsed = parseJsonContent(content) as Partial<NotePosterSummary>
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const subtitle = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : ''
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
    const keyPoints = coerceStringArray(parsed.keyPoints, 8)
    const keywords = coerceStringArray(parsed.keywords, 8)
    const polishedTranscriptText =
      typeof parsed.polishedTranscriptText === 'string' ? parsed.polishedTranscriptText.trim() : ''
    const auditChecklistText =
      typeof parsed.auditChecklistText === 'string' ? parsed.auditChecklistText.trim() : ''

    if (
      !title ||
      !subtitle ||
      keyPoints.length < 2 ||
      !polishedTranscriptText ||
      !auditChecklistText ||
      !keyPoints.every(isUsefulNoteKeyPoint)
    ) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek did not return a usable poster.')
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
        auditChecklistText
      }
    }
  }

  if (request.kind === 'favorite-archive-organize') {
    const parsed = parseJsonContent(content) as {
      results?: unknown
      keywordSuggestions?: unknown
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
}): Promise<DeepSeekGenerateResult> {
  const apiKey = options.config.apiKey.trim()
  if (!options.config.enabled || !apiKey) {
    throw new DeepSeekServiceError('not-configured', 'DeepSeek is not configured.')
  }

  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response

  try {
    response = await fetchImpl(createEndpoint(options.config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: options.signal,
      body: JSON.stringify({
        model: options.config.model,
        messages: buildMessages(options.request),
        temperature: options.request.kind === 'pet-chat' ? 0.7 : 0.4
      })
    })
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

  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new DeepSeekServiceError('invalid-output', 'DeepSeek response did not include content.')
  }

  return parseResult(options.request, content)
}
