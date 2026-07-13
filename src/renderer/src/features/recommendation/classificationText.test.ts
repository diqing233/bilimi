import { describe, expect, it } from 'vitest'
import { normalizeClassificationText, tokenizeClassificationText } from './classificationText'

describe('classificationText', () => {
  it('normalizes full-width punctuation, spaces, book marks, and case', () => {
    expect(normalizeClassificationText('《崩坏：星穹 铁道》 HSR')).toBe('崩坏星穹铁道hsr')
    expect(normalizeClassificationText('Genshin Impact')).toBe('genshinimpact')
  })

  it('keeps useful token order for phrase diagnostics', () => {
    expect(tokenizeClassificationText('科普小常识 / 冷知识')).toEqual([
      '科普',
      '小',
      '常识',
      '冷',
      '知识'
    ])
  })
})
