import { describe, expect, it } from 'vitest'
import { composeMemorialComments } from './commentComposer'

describe('composeMemorialComments', () => {
  it('returns three Xiao Mi style options for knowledge content', () => {
    const drafts = composeMemorialComments('knowledge', '如何高效背单词')

    expect(drafts).toHaveLength(3)
    expect(new Set(drafts).size).toBe(3)
    for (const draft of drafts) {
      expect(draft).toContain('如何高效背单词')
      expect(draft).toMatch(/小mi|我家主人/)
      expect(draft).toMatch(/UP主|up主/)
      expect(draft).toContain('再接再厉')
    }
  })
})
