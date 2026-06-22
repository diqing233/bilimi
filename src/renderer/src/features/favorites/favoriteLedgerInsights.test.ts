import { describe, expect, it } from 'vitest'
import { createFavoriteLedgerInsights } from './favoriteLedgerInsights'
import type { FavoriteSourceFolder } from './favoriteLedgerPreview'

function createSourceFolders(): FavoriteSourceFolder[] {
  return [
    {
      id: '1',
      title: '默认收藏夹',
      videos: [
        {
          aid: 101,
          title: 'AI工具效率教程：第1期',
          author: '效率研究所',
          description: '用 AI 工具整理工作流',
          tags: ['AI', '效率', '工具'],
          category: '科技'
        },
        {
          aid: 102,
          title: 'AI工具效率教程：第2期',
          author: '效率研究所',
          description: '提示词和自动化',
          tags: ['AI', '效率', '教程'],
          category: '科技'
        },
        {
          aid: 103,
          title: 'AI工具效率教程：第3期',
          author: '效率研究所',
          description: '自动化案例',
          tags: ['AI', '自动化', '工具'],
          category: '科技'
        },
        {
          aid: 104,
          title: 'AI工具效率教程：第4期',
          author: '效率研究所',
          description: '工作流复盘',
          tags: ['AI', '效率', '工具'],
          category: '科技'
        }
      ]
    },
    {
      id: '2',
      title: '剪辑参考',
      videos: [
        {
          aid: 201,
          title: '摄影构图和剪辑灵感',
          author: '光影小课',
          description: '构图案例',
          tags: ['摄影', '构图', '剪辑'],
          category: '知识'
        },
        {
          aid: 202,
          title: '摄影剪辑调色案例',
          author: '光影小课',
          description: '调色练习',
          tags: ['摄影', '剪辑', '调色'],
          category: '知识'
        },
        {
          aid: 203,
          title: '摄影构图复盘',
          author: '另一个UP',
          description: '',
          tags: ['摄影', '构图'],
          category: '知识'
        }
      ]
    }
  ]
}

describe('createFavoriteLedgerInsights', () => {
  it('summarizes existing favorites by author, tag, category, and title series without AI', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: createSourceFolders(),
      existingLedgerNames: []
    })

    expect(insights.totalVideos).toBe(7)
    expect(insights.topAuthors[0]).toMatchObject({
      name: '效率研究所',
      count: 4,
      share: expect.closeTo(4 / 7, 4)
    })
    expect(insights.topTags.slice(0, 3)).toEqual([
      { name: 'AI', count: 4 },
      { name: '工具', count: 3 },
      { name: '效率', count: 3 }
    ])
    expect(insights.topCategories).toEqual([
      { name: '科技', count: 4 },
      { name: '知识', count: 3 }
    ])
    expect(insights.titleSeries[0]).toMatchObject({
      name: 'AI工具效率教程',
      count: 4
    })
  })

  it('creates deterministic candidate ledgers from strong old-favorite signals', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: createSourceFolders(),
      existingLedgerNames: ['Bilimi·效率研究所追更']
    })

    expect(insights.candidateLedgers).toEqual([
      expect.objectContaining({
        kind: 'tag-cluster',
        displayName: 'Bilimi·AI工具',
        keywords: ['AI', '工具', '效率'],
        count: 4,
        confidence: 'high',
        aiEnhanced: false,
        reason: expect.stringContaining('高频标签')
      }),
      expect.objectContaining({
        kind: 'series',
        displayName: 'Bilimi·AI工具效率教程',
        keywords: ['AI工具效率教程'],
        count: 4,
        confidence: 'high'
      }),
      expect.objectContaining({
        kind: 'author',
        displayName: 'Bilimi·光影小课追更',
        keywords: ['光影小课'],
        count: 2,
        confidence: 'medium'
      })
    ])
    expect(insights.candidateLedgers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Bilimi·效率研究所追更'
        })
      ])
    )
  })

  it('applies AI enhancements only to matching deterministic candidates', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: createSourceFolders(),
      existingLedgerNames: [],
      aiSuggestions: [
        {
          sourceKind: 'tag-cluster',
          sourceName: 'AI',
          displayName: 'Bilimi·AI效率工坊',
          keywords: ['AI', '效率', '自动化'],
          reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。'
        },
        {
          sourceKind: 'author',
          sourceName: '不存在的UP',
          displayName: 'Bilimi·无效建议',
          keywords: ['无效'],
          reason: '不应凭空增加。'
        }
      ]
    })

    expect(insights.candidateLedgers[0]).toMatchObject({
      kind: 'tag-cluster',
      sourceName: 'AI',
      displayName: 'Bilimi·AI效率工坊',
      keywords: ['AI', '效率', '自动化'],
      reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。',
      aiEnhanced: true
    })
    expect(insights.candidateLedgers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Bilimi·无效建议'
        })
      ])
    )
  })
})
