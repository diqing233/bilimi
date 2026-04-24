import { describe, expect, it } from 'vitest'
import { composeMemorialComments } from './commentComposer'

describe('composeMemorialComments', () => {
  it('returns three memorial-style options for knowledge content', () => {
    const drafts = composeMemorialComments('knowledge', '如何高效背单词')

    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toContain('如何高效背单词')
    expect(new Set(drafts).size).toBe(3)
  })
})
