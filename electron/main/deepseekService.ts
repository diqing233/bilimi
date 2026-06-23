import type {
  DeepSeekErrorCode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteLedgerAiSuggestion,
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

const BILIMI_PET_CHAT_CONTEXT = [
  'You are 小咪, the warm desktop pet assistant inside Bilimi. Reply naturally, briefly, and in the user language.',
  'Bilimi is a desktop app for watching Bilibili in an internal browser while organizing videos.',
  'Core features: 批阅 actions help like, coin, favorite, or draft comment choices for the current video; 掌库 manages Bilimi· favorite ledgers and can create or sync folders; 札记 can generate video notes, transcribe audio, archive versions, and create one-image summaries; settings configure the 小咪 pet and DeepSeek.',
  'DeepSeek-backed features include review comment drafting, note poster summaries, and direct 小咪 chat. When DeepSeek is disabled, local button hints and fallback comments still work.',
  'When users ask about Bilimi, explain these product features from 小咪’s point of view. Do not claim you can publish comments or change settings without the user choosing the relevant button.'
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

function coerceStringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, limit)
    : []
}

function coerceFavoriteLedgerSuggestions(value: unknown): FavoriteLedgerAiSuggestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item): FavoriteLedgerAiSuggestion | null => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const candidate = item as Partial<FavoriteLedgerAiSuggestion>
      const sourceKind = candidate.sourceKind
      const sourceName = typeof candidate.sourceName === 'string' ? candidate.sourceName.trim() : ''
      const displayName =
        typeof candidate.displayName === 'string' ? candidate.displayName.trim() : ''
      const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : ''
      const keywords = coerceStringArray(candidate.keywords, 6)

      if (
        !sourceName ||
        !displayName ||
        !reason ||
        keywords.length === 0 ||
        !['author', 'tag-cluster', 'category', 'series'].includes(String(sourceKind))
      ) {
        return null
      }

      return {
        sourceKind: sourceKind as FavoriteLedgerAiSuggestion['sourceKind'],
        sourceName,
        displayName,
        keywords,
        reason
      }
    })
    .filter((item): item is FavoriteLedgerAiSuggestion => Boolean(item))
    .slice(0, 8)
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
    transcript: note.transcript.slice(0, 30),
    chapters: note.chapters.slice(0, 12),
    annotations: note.annotations.slice(0, 12),
    userMemo: note.userMemo
  })
}

function buildMessages(request: DeepSeekGenerateRequest): DeepSeekMessage[] {
  if (request.kind === 'review-comment') {
    return [
      {
        role: 'system',
        content:
          'You write concise, playful Bilibili review comment candidates in Chinese. Each comment must mention the video title and the UP name when provided. Return JSON only: {"comments":["...","...","..."]}.'
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
          'Create a compact one-image video note poster. Return JSON only: {"title":"","subtitle":"","keyPoints":[],"keywords":[],"prompt":""}.'
      },
      {
        role: 'user',
        content: summarizeNote(request.note)
      }
    ]
  }

  if (request.kind === 'favorite-ledger-insights') {
    return [
      {
        role: 'system',
        content:
          'You help organize Bilibili favorite folders. Only enhance the provided deterministic candidates; do not invent new candidates. Return JSON only: {"suggestions":[{"sourceKind":"tag-cluster|author|category|series","sourceName":"","displayName":"Bilimi·...","keywords":[],"reason":""}]}'
      },
      {
        role: 'user',
        content: JSON.stringify({
          totalVideos: request.totalVideos,
          topAuthors: request.topAuthors,
          topTags: request.topTags,
          topCategories: request.topCategories,
          titleSeries: request.titleSeries,
          candidates: request.candidates
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
    if (comments.length !== 3) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek did not return three comments.')
    }

    return { kind: 'review-comment', comments }
  }

  if (request.kind === 'note-poster') {
    const parsed = parseJsonContent(content) as Partial<NotePosterSummary>
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const subtitle = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : ''
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
    const keyPoints = coerceStringArray(parsed.keyPoints, 5)
    const keywords = coerceStringArray(parsed.keywords, 8)

    if (!title || !subtitle || keyPoints.length === 0) {
      throw new DeepSeekServiceError('invalid-output', 'DeepSeek did not return a usable poster.')
    }

    return {
      kind: 'note-poster',
      poster: {
        title,
        subtitle,
        keyPoints,
        keywords,
        prompt
      }
    }
  }

  if (request.kind === 'favorite-ledger-insights') {
    const parsed = parseJsonContent(content) as { suggestions?: unknown }
    const suggestions = coerceFavoriteLedgerSuggestions(parsed.suggestions)

    if (suggestions.length === 0) {
      throw new DeepSeekServiceError(
        'invalid-output',
        'DeepSeek did not return usable favorite ledger suggestions.'
      )
    }

    return {
      kind: 'favorite-ledger-insights',
      suggestions
    }
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
