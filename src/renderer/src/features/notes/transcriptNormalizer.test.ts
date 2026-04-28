import { describe, expect, it } from 'vitest'
import { normalizeTranscriptSegments, parseManualTranscript } from './transcriptNormalizer'

describe('transcriptNormalizer', () => {
  it('removes blank and duplicate adjacent transcript segments', () => {
    expect(
      normalizeTranscriptSegments([
        { start: 0, end: 1, text: '  开始  ' },
        { start: 1, end: 2, text: '开始' },
        { start: 2, end: 3, text: '' },
        { start: 3, end: 4, text: '进入重点' }
      ])
    ).toEqual([
      { start: 0, end: 1, text: '开始' },
      { start: 3, end: 4, text: '进入重点' }
    ])
  })

  it('parses manual transcript paragraphs without timestamps', () => {
    expect(parseManualTranscript('第一段内容\n\n第二段内容')).toEqual([
      { start: null, end: null, text: '第一段内容' },
      { start: null, end: null, text: '第二段内容' }
    ])
  })

  it('parses manual timestamp lines when users paste subtitle-like text', () => {
    expect(parseManualTranscript('[00:12] 关键观点\n01:05 第二个重点')).toEqual([
      { start: 12, end: null, text: '关键观点' },
      { start: 65, end: null, text: '第二个重点' }
    ])
  })
})
