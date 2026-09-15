import type { VideoNote } from '../../src/shared/types'

export type FaithfulTranscriptSegment = {
  id: string
  sourceIndex: number
  start: number | null
  end: number | null
  text: string
}

export type FaithfulTranscriptBatch = {
  contextSegments: FaithfulTranscriptSegment[]
  primarySegments: FaithfulTranscriptSegment[]
  sourceStartSegmentId: string
  sourceEndSegmentId: string
}

export type FaithfulTranscriptChangeType =
  | 'punctuation'
  | 'sentence-boundary'
  | 'transcription-error'
  | 'formatting'

export type FaithfulTranscriptCorrection = {
  segmentId: string
  originalText: string
  replacementText: string
  changeType: FaithfulTranscriptChangeType
  reason: string
  confidence: number
  highRisk: boolean
}

export type FaithfulTranscriptReviewItem = {
  segmentId: string
  originalText: string
  reason: string
  possibleInterpretation?: string
}

export type FaithfulProofreadingResponse = {
  sourceStartSegmentId: string
  sourceEndSegmentId: string
  changes: FaithfulTranscriptCorrection[]
  reviewItems: FaithfulTranscriptReviewItem[]
}

const VALID_CHANGE_TYPES = new Set<FaithfulTranscriptChangeType>([
  'punctuation',
  'sentence-boundary',
  'transcription-error',
  'formatting'
])

const DEFAULT_MAX_PRIMARY_CHARACTERS = 12_000
// Faster-whisper can emit hundreds of short segments. Keep the structured
// JSON response small enough for OpenAI-compatible gateways to finish reliably.
const DEFAULT_MAX_PRIMARY_SEGMENTS = 10
const DEFAULT_CONTEXT_SEGMENT_COUNT = 3

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`DeepSeek 保真精修结果无效：${label}为空。`)
  }
  return value
}

export function createFaithfulTranscriptSegments(note: VideoNote): FaithfulTranscriptSegment[] {
  return note.transcript.flatMap((segment, sourceIndex) => {
    const text = segment.text.trim()
    return text
      ? [{
          id: `segment-${sourceIndex + 1}`,
          sourceIndex,
          start: segment.start,
          end: segment.end,
          text
        }]
      : []
  })
}

export function createFaithfulTranscriptBatches(
  note: VideoNote,
  options: { maxPrimaryCharacters?: number; maxPrimarySegments?: number; contextSegmentCount?: number } = {}
): FaithfulTranscriptBatch[] {
  const segments = createFaithfulTranscriptSegments(note)
  const maxPrimaryCharacters = Math.max(1, options.maxPrimaryCharacters ?? DEFAULT_MAX_PRIMARY_CHARACTERS)
  const maxPrimarySegments = Math.max(1, options.maxPrimarySegments ?? DEFAULT_MAX_PRIMARY_SEGMENTS)
  const contextSegmentCount = Math.max(0, options.contextSegmentCount ?? DEFAULT_CONTEXT_SEGMENT_COUNT)
  const batches: FaithfulTranscriptBatch[] = []
  let offset = 0

  while (offset < segments.length) {
    const primarySegments: FaithfulTranscriptSegment[] = []
    let usedCharacters = 0

    while (offset + primarySegments.length < segments.length && primarySegments.length < maxPrimarySegments) {
      const candidate = segments[offset + primarySegments.length]
      const nextCharacters = usedCharacters + candidate.text.length
      if (primarySegments.length > 0 && nextCharacters > maxPrimaryCharacters) break
      primarySegments.push(candidate)
      usedCharacters = nextCharacters
    }

    const first = primarySegments[0]
    const last = primarySegments[primarySegments.length - 1]
    batches.push({
      contextSegments: segments.slice(Math.max(0, offset - contextSegmentCount), offset),
      primarySegments,
      sourceStartSegmentId: first.id,
      sourceEndSegmentId: last.id
    })
    offset += primarySegments.length
  }

  return batches
}

function parseCorrection(value: unknown): FaithfulTranscriptCorrection {
  if (!isRecord(value)) throw new Error('DeepSeek 保真精修结果无效：修改项格式错误。')
  const segmentId = requireString(value.segmentId, 'segmentId')
  const originalText = requireString(value.originalText, 'originalText')
  const replacementText = requireString(value.replacementText, 'replacementText')
  const changeType = requireString(value.changeType, 'changeType') as FaithfulTranscriptChangeType
  const reason = requireString(value.reason, 'reason')
  const confidence = value.confidence
  if (!VALID_CHANGE_TYPES.has(changeType)) {
    throw new Error(`DeepSeek 保真精修结果无效：不支持的修改类型 ${changeType}。`)
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('DeepSeek 保真精修结果无效：confidence 必须在 0 到 1 之间。')
  }
  if (typeof value.highRisk !== 'boolean') {
    throw new Error('DeepSeek 保真精修结果无效：缺少 highRisk。')
  }
  if (originalText.length >= 20 && replacementText.length / originalText.length < 0.7) {
    throw new Error('DeepSeek 保真精修结果无效：局部修改删除内容过多。')
  }
  return { segmentId, originalText, replacementText, changeType, reason, confidence, highRisk: value.highRisk }
}

function parseReviewItem(value: unknown, primaryIds: Set<string>): FaithfulTranscriptReviewItem {
  if (!isRecord(value)) throw new Error('DeepSeek 保真精修结果无效：待确认项格式错误。')
  const segmentId = requireString(value.segmentId, 'reviewItems.segmentId')
  if (!primaryIds.has(segmentId)) {
    throw new Error(`DeepSeek 保真精修结果无效：待确认项 ${segmentId} 不属于当前批次。`)
  }
  const possibleInterpretation =
    typeof value.possibleInterpretation === 'string' && value.possibleInterpretation.trim()
      ? value.possibleInterpretation.trim()
      : undefined
  return {
    segmentId,
    originalText: requireString(value.originalText, 'reviewItems.originalText'),
    reason: requireString(value.reason, 'reviewItems.reason'),
    possibleInterpretation
  }
}

export function parseFaithfulProofreadingResponse(value: unknown): FaithfulProofreadingResponse {
  if (!isRecord(value)) throw new Error('DeepSeek 保真精修结果无效：返回值不是对象。')
  if (!Array.isArray(value.changes) || !Array.isArray(value.reviewItems)) {
    throw new Error('DeepSeek 保真精修结果无效：缺少 changes 或 reviewItems 数组。')
  }
  return {
    sourceStartSegmentId: requireString(value.sourceStartSegmentId, 'sourceStartSegmentId'),
    sourceEndSegmentId: requireString(value.sourceEndSegmentId, 'sourceEndSegmentId'),
    changes: value.changes.map(parseCorrection),
    reviewItems: value.reviewItems as FaithfulTranscriptReviewItem[]
  }
}

export function applyFaithfulProofreadingBatch(
  batch: FaithfulTranscriptBatch,
  rawResponse: unknown,
  finishReason?: string
): {
  polishedSegments: FaithfulTranscriptSegment[]
  corrections: FaithfulTranscriptCorrection[]
  reviewItems: FaithfulTranscriptReviewItem[]
} {
  if (finishReason === 'length') {
    throw new Error('DeepSeek 保真精修结果被长度限制截断。')
  }
  const parsed = parseFaithfulProofreadingResponse(rawResponse)
  if (
    parsed.sourceStartSegmentId !== batch.sourceStartSegmentId ||
    parsed.sourceEndSegmentId !== batch.sourceEndSegmentId
  ) {
    throw new Error('DeepSeek 保真精修结果的批次边界不匹配。')
  }

  const primaryById = new Map(batch.primarySegments.map((segment) => [segment.id, segment]))
  const primaryIds = new Set(primaryById.keys())
  const reviewItems = (isRecord(rawResponse) && Array.isArray(rawResponse.reviewItems)
    ? rawResponse.reviewItems
    : []).map((item) => parseReviewItem(item, primaryIds))
  const changesBySegment = new Map<string, Array<FaithfulTranscriptCorrection & { start: number; end: number }>>()

  for (const correction of parsed.changes) {
    const segment = primaryById.get(correction.segmentId)
    if (!segment) {
      throw new Error(`DeepSeek 保真精修结果无效：${correction.segmentId} 不属于当前主批次。`)
    }
    const start = segment.text.indexOf(correction.originalText)
    if (start < 0) {
      throw new Error(`DeepSeek 保真精修结果无效：${correction.segmentId} 找不到原文。`)
    }
    if (segment.text.indexOf(correction.originalText, start + correction.originalText.length) >= 0) {
      throw new Error(`DeepSeek 保真精修结果无效：${correction.segmentId} 的原文不是唯一匹配。`)
    }
    const positioned = { ...correction, start, end: start + correction.originalText.length }
    const existing = changesBySegment.get(correction.segmentId) ?? []
    if (existing.some((candidate) => positioned.start < candidate.end && positioned.end > candidate.start)) {
      throw new Error(`DeepSeek 保真精修结果无效：${correction.segmentId} 包含重叠修改。`)
    }
    existing.push(positioned)
    changesBySegment.set(correction.segmentId, existing)
  }

  const polishedSegments = batch.primarySegments.map((segment) => {
    let text = segment.text
    const changes = [...(changesBySegment.get(segment.id) ?? [])].sort((a, b) => b.start - a.start)
    for (const change of changes) {
      text = `${text.slice(0, change.start)}${change.replacementText}${text.slice(change.end)}`
    }
    return { ...segment, text }
  })

  return { polishedSegments, corrections: parsed.changes, reviewItems }
}

export function assembleFaithfulTranscript(
  sourceSegments: FaithfulTranscriptSegment[],
  polishedTextBySegmentId: ReadonlyMap<string, string>
): string {
  const fragments = sourceSegments
    .map((segment) => (polishedTextBySegmentId.get(segment.id) ?? segment.text).trim())
    .filter(Boolean)
  const paragraphs: string[] = []
  let paragraph = ''

  const closeParagraph = () => {
    if (!paragraph) return
    const needsChineseStop = /[\u4e00-\u9fff]/u.test(paragraph) && !/[。！？!?…]$/u.test(paragraph)
    paragraphs.push(needsChineseStop ? `${paragraph}。` : paragraph)
    paragraph = ''
  }

  for (const fragment of fragments) {
    const startsNewStage = /^(?:现在开始|接下来|随后|最后|最终|结尾|生日环节|规则说明)/u.test(fragment)
    const switchesScript = paragraph && /[\u4e00-\u9fff]/u.test(paragraph) !== /[\u4e00-\u9fff]/u.test(fragment)
    if ((startsNewStage && paragraph.length >= 18) || switchesScript || paragraph.length >= 180) closeParagraph()

    if (!paragraph) {
      paragraph = fragment
    } else if (/[，,：:；;、—-]$/u.test(paragraph) || /^[，,。！？!?：:；;]/u.test(fragment)) {
      paragraph += fragment
    } else if (/[。！？!?…]$/u.test(paragraph)) {
      paragraph += fragment
    } else {
      paragraph += `，${fragment}`
    }
  }
  closeParagraph()
  return paragraphs.join('\n\n')
}
