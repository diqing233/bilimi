import { describe, expect, it } from 'vitest'
import type { VideoNote } from '../../src/shared/types'
import {
  applyFaithfulProofreadingBatch,
  assembleFaithfulTranscript,
  createFaithfulTranscriptBatches,
  createFaithfulTranscriptSegments
} from './faithfulTranscriptPolishing'

function createNote(texts: string[]): VideoNote {
  return {
    id: 'note-1',
    source: { title: '测试视频', url: 'https://www.bilibili.com/video/BV1test' },
    transcriptSource: 'audio',
    transcript: texts.map((text, index) => ({ start: index * 3, end: index * 3 + 2, text })),
    chapters: [],
    overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
    annotations: [],
    userMemo: '',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  }
}

describe('faithful transcript polishing', () => {
  it('covers every non-empty source segment exactly once as primary content', () => {
    const note = createNote(['第一段', '', '嗯，然后然后继续。', 'battery health management', '最后一段'])
    const batches = createFaithfulTranscriptBatches(note, { maxPrimaryCharacters: 12, contextSegmentCount: 1 })

    expect(batches.flatMap((batch) => batch.primarySegments.map((segment) => segment.id))).toEqual([
      'segment-1',
      'segment-3',
      'segment-4',
      'segment-5'
    ])
    expect(batches[1]?.contextSegments.map((segment) => segment.id)).toEqual(['segment-3'])
    expect(batches[1]?.primarySegments.map((segment) => segment.id)).not.toContain('segment-3')
  })

  it('splits high-segment transcripts before their serialized request becomes oversized', () => {
    const note = createNote(Array.from({ length: 764 }, (_, index) => `短句 ${index + 1}`))
    const batches = createFaithfulTranscriptBatches(note)

    expect(batches.length).toBeGreaterThan(1)
    expect(Math.max(...batches.map((batch) => batch.primarySegments.length))).toBeLessThanOrEqual(10)
    expect(batches.flatMap((batch) => batch.primarySegments)).toHaveLength(764)
  })

  it('preserves filler words, repetitions, and foreign text when no changes are returned', () => {
    const note = createNote(['嗯，然后然后继续。', 'battery health management'])
    const segments = createFaithfulTranscriptSegments(note)
    const batch = createFaithfulTranscriptBatches(note)[0]!
    const result = applyFaithfulProofreadingBatch(batch, {
      sourceStartSegmentId: 'segment-1',
      sourceEndSegmentId: 'segment-2',
      changes: [],
      reviewItems: []
    })

    expect(assembleFaithfulTranscript(segments, new Map(result.polishedSegments.map((segment) => [segment.id, segment.text])))).toBe(
      '嗯，然后然后继续。\n\nbattery health management'
    )
  })

  it('reflows short transcript fragments into natural sentences and paragraphs without dropping text', () => {
    const note = createNote(['本次挑战', '二百抽', '抽到七个为基准', '每多一个加一分', '现在开始', '二十抽直接出金'])
    const segments = createFaithfulTranscriptSegments(note)

    expect(assembleFaithfulTranscript(segments, new Map())).toBe(
      '本次挑战，二百抽，抽到七个为基准，每多一个加一分。\n\n现在开始，二十抽直接出金。'
    )
  })

  it('applies only exact localized changes and records them', () => {
    const note = createNote(['这个爱疯的电池是七千毫安。'])
    const batch = createFaithfulTranscriptBatches(note)[0]!
    const result = applyFaithfulProofreadingBatch(batch, {
      sourceStartSegmentId: 'segment-1',
      sourceEndSegmentId: 'segment-1',
      changes: [{
        segmentId: 'segment-1',
        originalText: '爱疯',
        replacementText: 'iPhone',
        changeType: 'transcription-error',
        reason: '上下文明确指向产品名',
        confidence: 0.98,
        highRisk: true
      }],
      reviewItems: []
    })

    expect(result.polishedSegments[0]?.text).toBe('这个iPhone的电池是七千毫安。')
    expect(result.corrections).toEqual([expect.objectContaining({ originalText: '爱疯', replacementText: 'iPhone' })])
  })

  it.each([
    ['truncated output', { finishReason: 'length' }],
    ['wrong batch bounds', { response: { sourceStartSegmentId: 'segment-9', sourceEndSegmentId: 'segment-9', changes: [], reviewItems: [] } }],
    ['unknown segment', { changes: [{ segmentId: 'segment-9', originalText: '原文', replacementText: '修改', changeType: 'transcription-error', reason: 'x', confidence: 1, highRisk: false }] }],
    ['missing source text', { changes: [{ segmentId: 'segment-1', originalText: '不存在', replacementText: '修改', changeType: 'transcription-error', reason: 'x', confidence: 1, highRisk: false }] }],
    ['duplicate source match', { noteText: '重复重复', changes: [{ segmentId: 'segment-1', originalText: '重复', replacementText: '修正', changeType: 'transcription-error', reason: 'x', confidence: 1, highRisk: false }] }],
    ['empty replacement', { changes: [{ segmentId: 'segment-1', originalText: '原文', replacementText: '', changeType: 'transcription-error', reason: 'x', confidence: 1, highRisk: false }] }],
    ['unsupported type', { changes: [{ segmentId: 'segment-1', originalText: '原文', replacementText: '修正', changeType: 'rewrite', reason: 'x', confidence: 1, highRisk: false }] }],
    ['invalid confidence', { changes: [{ segmentId: 'segment-1', originalText: '原文', replacementText: '修正', changeType: 'transcription-error', reason: 'x', confidence: 2, highRisk: false }] }],
    ['destructive replacement', { noteText: '这是一整段包含大量重要信息且不能被压缩删除的原始文稿', changes: [{ segmentId: 'segment-1', originalText: '这是一整段包含大量重要信息且不能被压缩删除的原始文稿', replacementText: '摘要', changeType: 'transcription-error', reason: 'x', confidence: 1, highRisk: false }] }]
  ])('rejects %s', (_label, options) => {
    const note = createNote([String(options.noteText ?? '原文')])
    const batch = createFaithfulTranscriptBatches(note)[0]!
    const response = options.response ?? {
      sourceStartSegmentId: 'segment-1',
      sourceEndSegmentId: 'segment-1',
      changes: options.changes ?? [],
      reviewItems: []
    }

    expect(() => applyFaithfulProofreadingBatch(batch, response, options.finishReason)).toThrow()
  })

  it('rejects overlapping localized changes', () => {
    const note = createNote(['abcdef'])
    const batch = createFaithfulTranscriptBatches(note)[0]!

    expect(() => applyFaithfulProofreadingBatch(batch, {
      sourceStartSegmentId: 'segment-1',
      sourceEndSegmentId: 'segment-1',
      changes: [
        { segmentId: 'segment-1', originalText: 'abcd', replacementText: 'ABCD', changeType: 'formatting', reason: 'x', confidence: 1, highRisk: false },
        { segmentId: 'segment-1', originalText: 'cdef', replacementText: 'CDEF', changeType: 'formatting', reason: 'x', confidence: 1, highRisk: false }
      ],
      reviewItems: []
    })).toThrow()
  })
})
