import { describe, expect, it } from 'vitest'
import { favoriteLedgerNameValidation } from '@shared/favoriteLedgers'
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
  it('summarizes existing favorites by author, tag, and category without title-series candidates', () => {
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
    expect(insights.sourceFolders).toEqual([
      { name: '默认收藏夹', count: 4 },
      { name: '剪辑参考', count: 3 }
    ])
  })

  it('creates deterministic candidate ledgers from strong old-favorite signals', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: createSourceFolders(),
      existingLedgerNames: ['bilimi·效率研究所追更']
    })

    expect(insights.candidateLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tag-cluster',
        displayName: 'bilimi·AI',
        ruleType: 'tag',
        keywords: ['AI'],
        count: 4,
        confidence: 'high',
        reason: expect.stringContaining('高频标签')
      }),
      expect.not.objectContaining({ kind: 'series' }),
      expect.objectContaining({
        kind: 'category',
        displayName: 'bilimi·科技',
        keywords: ['科技'],
        count: 4
      }),
      expect.objectContaining({
        kind: 'author',
        displayName: 'bilimi·光影小课',
        ruleType: 'author',
        keywords: ['光影小课'],
        count: 2,
        confidence: 'medium'
      })
    ]))
    expect(insights.candidateLedgers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'bilimi·效率研究所追更'
        })
      ])
    )
  })

  it('keeps single-use tags out of generated candidates while preserving category candidates', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            {
              aid: 301,
              title: '单条摄影后期案例',
              author: '光影小课',
              description: '',
              tags: ['摄影', '后期'],
              category: '知识'
            }
          ]
        }
      ],
      existingLedgerNames: []
    })

    expect(insights.topTags).toEqual([
      { name: '摄影', count: 1 },
      { name: '后期', count: 1 }
    ])
    expect(insights.topCategories).toEqual([{ name: '知识', count: 1 }])
    expect(insights.candidateLedgers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'category',
          displayName: 'bilimi·知识',
          count: 1
        })
      ])
    )
    expect(insights.candidateLedgers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tag-cluster'
        })
      ])
    )
  })

  it('does not recommend follow-up ledgers for deleted-account placeholders', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            { aid: 311, title: '失效收藏一', author: '账号已注销' },
            { aid: 312, title: '失效收藏二', author: '账号已注销' },
            { aid: 313, title: '正常收藏一', author: '正常UP' },
            { aid: 314, title: '正常收藏二', author: '正常UP' }
          ]
        }
      ],
      existingLedgerNames: []
    })

    expect(insights.candidateLedgers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'author', sourceName: '正常UP' })
      ])
    )
    expect(insights.candidateLedgers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'author', sourceName: '账号已注销' })
      ])
    )
  })

  it('hides an author candidate when its stable ledger is already enabled under the allocated name', () => {
    const sourceFolders: FavoriteSourceFolder[] = [{
      id: '1',
      title: '默认收藏夹',
      videos: [
        { aid: 321, title: '直播切片一', author: 'honker233-小王爱马枪' },
        { aid: 322, title: '直播切片二', author: 'honker233-小王爱马枪' }
      ]
    }]

    const insights = createFavoriteLedgerInsights({
      sourceFolders,
      existingLedgers: [{
        id: 'custom-author-honker233-小王爱马枪',
        displayName: 'bilimi·honker233',
        keywords: ['honker233-小王爱马枪'],
        ruleType: 'author',
        enabled: true,
        priority: 10,
        isDefault: false,
        bilibiliFolderId: '9001'
      }]
    })

    expect(insights.candidateLedgers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'author', sourceName: 'honker233-小王爱马枪' })
    ]))
  })

  it('shows a deleted author ledger again only after it is disabled and loses its remote folder id', () => {
    const sourceFolders: FavoriteSourceFolder[] = [{
      id: '1',
      title: '默认收藏夹',
      videos: [
        { aid: 323, title: '直播切片一', author: 'honker233-小王爱马枪' },
        { aid: 324, title: '直播切片二', author: 'honker233-小王爱马枪' }
      ]
    }]
    const disabledLedger = {
      id: 'custom-author-honker233-小王爱马枪',
      displayName: 'bilimi·honker233',
      keywords: ['honker233-小王爱马枪'],
      ruleType: 'author' as const,
      enabled: false,
      priority: 10,
      isDefault: false
    }

    const insights = createFavoriteLedgerInsights({ sourceFolders, existingLedgers: [disabledLedger] })
    const stillRemote = createFavoriteLedgerInsights({
      sourceFolders,
      existingLedgers: [{ ...disabledLedger, bilibiliFolderId: '9001' }]
    })

    expect(insights.candidateLedgers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'author', sourceName: 'honker233-小王爱马枪' })
    ]))
    expect(stillRemote.candidateLedgers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'author', sourceName: 'honker233-小王爱马枪' })
    ]))
  })

  it('continues hiding an existing tag ledger by its normalized final name', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [{
        id: '1',
        title: '默认收藏夹',
        videos: [
          { aid: 325, title: '明日方舟攻略一', tags: ['明日方舟'] },
          { aid: 326, title: '明日方舟攻略二', tags: ['明日方舟'] }
        ]
      }],
      existingLedgers: [{
        id: 'custom-tag-明日方舟',
        displayName: 'bilimi·明日方舟',
        keywords: ['明日方舟'],
        ruleType: 'tag',
        enabled: true,
        priority: 10,
        isDefault: false
      }]
    })

    expect(insights.candidateLedgers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tag-cluster', sourceName: '明日方舟' })
    ]))
  })

  it('continues reusing a legacy tag-cluster ledger by its complete tag rule', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [{
        id: '1',
        title: '默认收藏夹',
        videos: [
          { aid: 327, title: '明日方舟攻略一', tags: ['明日方舟'] },
          { aid: 328, title: '明日方舟攻略二', tags: ['明日方舟'] }
        ]
      }],
      existingLedgers: [{
        id: 'custom-tag-cluster-明日方舟',
        displayName: 'bilimi·我的方舟收藏',
        keywords: ['明日方舟'],
        ruleType: 'tag',
        enabled: true,
        priority: 10,
        isDefault: false
      }]
    })

    expect(insights.candidateLedgers).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tag-cluster', sourceName: '明日方舟' })
    ]))
  })

  it('creates candidates for multiple high-frequency tags', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            { aid: 401, title: '配队一', tags: ['原神', '攻略', '深渊'] },
            { aid: 402, title: '配队二', tags: ['原神', '攻略', '角色'] },
            { aid: 403, title: '配队三', tags: ['原神', '攻略', '抽卡'] },
            { aid: 404, title: '配队四', tags: ['原神', '实况'] }
          ]
        }
      ],
      existingLedgerNames: []
    })

    expect(insights.candidateLedgers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tag-cluster',
          sourceName: '原神',
          displayName: 'bilimi·原神',
          ruleType: 'tag',
          keywords: ['原神'],
          count: 4
        }),
        expect.objectContaining({
          kind: 'tag-cluster',
          sourceName: '攻略',
          displayName: 'bilimi·攻略',
          ruleType: 'tag',
          keywords: ['攻略'],
          count: 3
        })
      ])
    )
  })

  it('keeps up to twenty-four repeated tag candidates', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: Array.from({ length: 60 }, (_, index) => ({
            aid: 500 + index,
            title: `标签样本 ${index + 1}`,
            tags: [`标签${Math.floor(index / 2) + 1}`]
          }))
        }
      ],
      existingLedgerNames: []
    })

    const tagCandidates = insights.candidateLedgers.filter(
      (candidate) => candidate.kind === 'tag-cluster'
    )

    expect(tagCandidates).toHaveLength(24)
    expect(tagCandidates.at(0)).toMatchObject({ sourceName: '标签1', count: 2 })
    expect(tagCandidates.at(23)).toMatchObject({ sourceName: '标签24', count: 2 })
    expect(tagCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: '标签25'
        })
      ])
    )
  })

  it('uses the shared author identity and allocates distinct names for authors with the same account prefix', () => {
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [{
        id: '1',
        title: '默认收藏夹',
        videos: [
          { aid: 601, title: '直播切片一', author: 'honker233-小王爱马枪' },
          { aid: 602, title: '直播切片二', author: 'honker233-小王爱马枪' },
          { aid: 603, title: '直播切片三', author: 'honker233-另一位主播' },
          { aid: 604, title: '直播切片四', author: 'honker233-另一位主播' }
        ]
      }],
      existingLedgerNames: []
    })

    const authors = insights.candidateLedgers.filter((candidate) => candidate.kind === 'author')
    expect(authors.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([
      expect.stringContaining('custom-author-honker233-小王爱马枪'),
      expect.stringContaining('custom-author-honker233-另一位主播')
    ]))
    expect(new Set(authors.map((candidate) => candidate.displayName))).toHaveLength(2)
    expect(authors.map((candidate) => candidate.displayName)).toContain('bilimi·honker233')
  })

  it('uses the shared tag identity and keeps long recommendation names valid', () => {
    const longTag = '这是一个非常非常长的高频标签名称'
    const insights = createFavoriteLedgerInsights({
      sourceFolders: [{
        id: '1',
        title: '默认收藏夹',
        videos: [
          { aid: 611, title: '标签样本一', tags: [longTag] },
          { aid: 612, title: '标签样本二', tags: [longTag] }
        ]
      }],
      existingLedgerNames: []
    })

    const tag = insights.candidateLedgers.find((candidate) => candidate.kind === 'tag-cluster')
    expect(tag).toMatchObject({
      id: `custom-tag-${longTag}`,
      displayName: 'bilimi·这是一个非常非常长的高频标'
    })
    expect(favoriteLedgerNameValidation(tag?.displayName ?? '').valid).toBe(true)
  })

})
