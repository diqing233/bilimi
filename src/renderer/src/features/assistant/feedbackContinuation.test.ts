import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { feedbackContinuationSuffix, splitFeedbackContinuation, splitFeedbackContinuationByLines } from './feedbackContinuation'

describe('feedbackContinuationSuffix', () => {
  const measure = (value: string) => Array.from(value).length

  it('returns no continuation when the current feedback fits on its first line', () => {
    expect(feedbackContinuationSuffix('准备就绪', 8, measure)).toBe('')
  })

  it('returns the hidden suffix after a prefix that fills the first line without reserving ellipsis width', () => {
    expect(feedbackContinuationSuffix('批阅：可以一键三连、自动分类收藏、发送弹幕。', 15, measure)).toBe('藏、发送弹幕。')
  })

  it('keeps the whole message as continuation when the first line cannot fit one character', () => {
    expect(feedbackContinuationSuffix('批阅提示', 1, measure)).toBe('阅提示')
  })

  it('returns a visible prefix so the clipped first line does not render the suffix twice', () => {
    expect(splitFeedbackContinuation('批阅：可以一键三连、自动分类收藏、发送弹幕。', 15, measure)).toEqual({
      visible: '批阅：可以一键三连、自动分类收',
      suffix: '藏、发送弹幕。'
    })
  })
})

describe('feedback continuation presentation contract', () => {
  it('uses the same typography and no separator for the inline continuation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')
    expect(source).toMatch(/\.floating-assistant-global-status__menu\s*\{[^}]*border-top:\s*0/u)
    expect(source).toMatch(/\.floating-assistant-global-status__menu\s*>\s*\.floating-assistant-global-status__menu-feedback-continuation\s*\{[^}]*font:\s*inherit/u)
    expect(source).toMatch(/\.floating-assistant-global-status__menu\s*>\s*\.floating-assistant-global-status__menu-feedback-continuation\s*\{[^}]*font-size:\s*inherit/u)
    expect(source).toMatch(/\.floating-assistant-global-status__feedback\[data-expanded="true"\]\[data-continuation-visible="true"\][^}]*\.floating-assistant-global-status__feedback-message\s*\{[^}]*-webkit-line-clamp:\s*unset/u)
  })
})

describe('splitFeedbackContinuationByLines', () => {
  const measure = (value: string) => Array.from(value).length

  it('keeps two wrapped lines in the visible prefix before returning a third-line suffix', () => {
    expect(splitFeedbackContinuationByLines('一二三四五六七八九十', 4, 2, measure)).toEqual({
      visible: '一二三四五六七八',
      suffix: '九十'
    })
  })

  it('returns an empty suffix when the complete message fits in two lines', () => {
    expect(splitFeedbackContinuationByLines('一二三四五六七', 4, 2, measure)).toEqual({
      visible: '一二三四五六七',
      suffix: ''
    })
  })
})
