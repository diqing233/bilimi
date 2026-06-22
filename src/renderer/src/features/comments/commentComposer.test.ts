import { describe, expect, it } from 'vitest'
import { composeMemorialComments } from './commentComposer'

describe('composeMemorialComments', () => {
  it('returns three Xiao Mi style options for knowledge content', () => {
    const drafts = composeMemorialComments('knowledge', '如何高效背单词', '词汇研究所')

    expect(drafts).toHaveLength(3)
    expect(new Set(drafts).size).toBe(3)
    for (const draft of drafts) {
      expect(draft).toContain('如何高效背单词')
      expect(draft).toContain('词汇研究所')
      expect(draft).toMatch(/小mi|我家主人/)
      expect(draft).toMatch(/UP主|up主/)
      expect(draft).toContain('再接再厉')
    }
  })

  it('uses readable fallbacks when metadata has not been recognized yet', () => {
    const drafts = composeMemorialComments('funny', '', '')

    expect(drafts).toHaveLength(3)
    for (const draft of drafts) {
      expect(draft).toContain('当前视频')
      expect(draft).toContain('这位UP')
    }
  })
})
