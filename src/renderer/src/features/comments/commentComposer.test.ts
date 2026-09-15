import { describe, expect, it } from 'vitest'
import { composeMemorialComments } from './commentComposer'

describe('composeMemorialComments', () => {
  it.each(['knowledge', 'funny', 'suspicious', 'life'] as const)(
    'returns three distinct natural comments for %s content',
    (kind) => {
      const drafts = composeMemorialComments(kind, '一个无法推断具体内容的标题', '某位UP', () => 0)

      expect(drafts).toHaveLength(3)
      expect(new Set(drafts).size).toBe(3)
      for (const draft of drafts) {
        expect(draft).not.toMatch(/小咪|主人|特派|再接再厉/)
        expect(draft).not.toMatch(/已经.*(?:收藏|分享)|先收藏了/)
        expect(draft).toContain('某位UP')
        expect(draft.length).toBeGreaterThanOrEqual(20)
        expect(draft.length).toBeLessThanOrEqual(100)
      }
    }
  )

  it('samples different candidates from a local pool larger than the three visible choices', () => {
    const firstBatch = composeMemorialComments('life', '普通标题', '阿明', () => 0)
    const laterBatch = composeMemorialComments('life', '普通标题', '阿明', () => 0.999999)

    expect(new Set([...firstBatch, ...laterBatch]).size).toBeGreaterThan(3)
  })

  it('uses UP 主 when the current author is unavailable', () => {
    const drafts = composeMemorialComments('life', '普通标题', '   ', () => 0)

    expect(drafts).toHaveLength(3)
    expect(drafts.every((draft) => draft.includes('UP 主'))).toBe(true)
  })

  it('does not invent unsupported video details from metadata', () => {
    const drafts = composeMemorialComments('life', '一个无法推断具体内容的标题', '某位UP', () => 0)

    for (const draft of drafts) {
      expect(draft).not.toMatch(/笑点|知识点|剪辑|画面|配乐|讲解|下饭|剧情/)
    }
  })
  it('keeps local fallback comments within the 100 character send limit', () => {
    const kinds = ['knowledge', 'funny', 'suspicious', 'life']
    const longTitle = '很长的视频标题'.repeat(20)
    const longAuthor = '很长的UP主名'.repeat(20)

    for (const kind of kinds) {
      const drafts = composeMemorialComments(kind, longTitle, longAuthor, () => 0)

      expect(drafts).toHaveLength(3)
      for (const draft of drafts) {
        expect(draft.length).toBeLessThanOrEqual(100)
      }
    }
  })
})
