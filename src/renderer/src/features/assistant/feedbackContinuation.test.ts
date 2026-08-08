import { describe, expect, it } from 'vitest'
import { feedbackContinuationSuffix } from './feedbackContinuation'

describe('feedbackContinuationSuffix', () => {
  const measure = (value: string) => Array.from(value).length

  it('returns no continuation when the current feedback fits on its first line', () => {
    expect(feedbackContinuationSuffix('准备就绪', 8, measure)).toBe('')
  })

  it('returns only the text hidden after the visible ellipsis prefix', () => {
    expect(feedbackContinuationSuffix('批阅：可以一键三连、自动分类收藏、发送弹幕。', 15, measure)).toBe('收藏、发送弹幕。')
  })

  it('keeps the whole message as continuation when even the ellipsis cannot fit with one character', () => {
    expect(feedbackContinuationSuffix('批阅提示', 1, measure)).toBe('批阅提示')
  })
})
