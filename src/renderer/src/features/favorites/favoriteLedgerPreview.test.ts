import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { createFavoriteLedgerPreview } from './favoriteLedgerPreview'

describe('createFavoriteLedgerPreview', () => {
  it('keeps Bilimi-managed folders as selectable source folders for second-pass organizing', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )
    const managedKnowledgeFolder = ledgers.find((ledger) => ledger.id === 'knowledge')!.displayName
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 101, title: '机器学习科普教程', description: '原理入门', tags: ['学习'] }]
        },
        {
          id: '2',
          title: managedKnowledgeFolder,
          videos: [{ aid: 102, title: '已归档知识', description: '', tags: [] }]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items).toEqual([
      expect.objectContaining({
        aid: 101,
        sourceFolderTitle: '默认收藏夹',
        targetLedgerId: 'knowledge',
        targetFolderId: '9001',
        alreadyInTarget: false,
        selected: true
      }),
      expect.objectContaining({
        aid: 102,
        sourceFolderTitle: managedKnowledgeFolder
      })
    ])
    expect(preview.skippedSourceFolderTitles).toEqual([])
  })

  it('keeps Bilimi inbox as a selectable old favorite source folder', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox'
        ? { ...ledger, bilibiliFolderId: '9008' }
        : ledger.id === 'knowledge'
          ? { ...ledger, bilibiliFolderId: '9001' }
          : ledger
    )
    const inboxFolder = ledgers.find((ledger) => ledger.id === 'inbox')!.displayName
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '9008',
          title: inboxFolder,
          videos: [{ aid: 101, title: '机器学习科普教程', tags: ['学习'] }]
        }
      ],
      targetMembership: {
        '9008': [101]
      }
    })

    expect(preview.skippedSourceFolderTitles).toEqual([])
    expect(preview.items[0]).toMatchObject({
      aid: 101,
      sourceFolderTitle: inboxFolder,
      targetLedgerId: 'knowledge',
      targetFolderId: '9001',
      selected: true
    })
  })

  it('attaches old-favorite insights for candidate ledger creation', () => {
    const preview = createFavoriteLedgerPreview({
      ledgers: createDefaultFavoriteLedgers(),
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            {
              aid: 101,
              title: 'AI工具效率教程：第1期',
              author: '效率研究所',
              description: '工具演示',
              tags: ['AI', '效率', '工具'],
              category: '科技'
            },
            {
              aid: 102,
              title: 'AI工具效率教程：第2期',
              author: '效率研究所',
              description: '自动化演示',
              tags: ['AI', '效率', '工具'],
              category: '科技'
            },
            {
              aid: 103,
              title: 'AI工具效率教程：第3期',
              author: '效率研究所',
              description: '提示词',
              tags: ['AI', '提示词', '工具'],
              category: '科技'
            }
          ]
        }
      ],
      targetMembership: {}
    })

    expect(preview.insights).toMatchObject({
      totalVideos: 3,
      topAuthors: [expect.objectContaining({ name: '效率研究所', count: 3 })],
      topTags: [
        { name: 'AI', count: 3 },
        { name: '工具', count: 3 },
        { name: '效率', count: 2 },
        { name: '提示词', count: 1 }
      ],
      candidateLedgers: expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Bilimi·AI工具',
          aiEnhanced: false
        })
      ])
    })
  })

  it('records generated candidate targets for inbox old favorites', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'creative-aesthetic'
        ? { ...ledger, bilibiliFolderId: '9004' }
        : ledger.id === 'inbox'
          ? { ...ledger, bilibiliFolderId: '9008' }
          : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            { aid: 101, title: '光影构图入门', tags: ['摄影'], category: '摄影' },
            { aid: 102, title: '街拍镜头选择', tags: ['摄影'], category: '摄影' },
            { aid: 103, title: '旅行照片调色', tags: ['摄影'], category: '摄影' }
          ]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'creative-aesthetic',
      targetFolderId: '9004',
      candidateTargets: [
        expect.objectContaining({
          candidateKey: 'tag-cluster:摄影',
          ledgerId: 'custom-tag-cluster-摄影',
          displayName: 'Bilimi·摄影'
        })
      ]
    })
    expect(preview.items[0].candidateTargets).toHaveLength(1)
  })

  it('records multiple recommended targets for one video while keeping inbox as fallback only', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'movie-tv') {
        return { ...ledger, bilibiliFolderId: '9001' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            {
              aid: 101,
              title: '影视飓风相机评测',
              author: '影视飓风',
              tags: ['影视', '摄影'],
              category: '影视'
            },
            {
              aid: 102,
              title: '影视飓风剪辑教程',
              author: '影视飓风',
              tags: ['影视', '摄影'],
              category: '影视'
            }
          ]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0].targetLedgerId).toBe('movie-tv')
    expect(preview.items[0].targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ledgerId: 'movie-tv', folderId: '9001', selected: true }),
        expect.objectContaining({
          ledgerId: 'custom-author-影视飓风',
          displayName: 'Bilimi·影视飓风追更',
          selectedCandidateTarget: true,
          selected: true
        })
      ])
    )
    expect(preview.items[0].targets?.some((target) => target.ledgerId === 'inbox')).toBe(false)
  })

  it('marks items already in the target ledger as skipped', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'entertainment' ? { ...ledger, bilibiliFolderId: '9007' } : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 201, title: '爆笑整活合集', description: '', tags: ['搞笑'] }]
        }
      ],
      targetMembership: {
        '9007': [201]
      }
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'entertainment',
      alreadyInTarget: true,
      selected: false
    })
  })

  it('uses inbox and requires review for risk signals', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'inbox' ? { ...ledger, bilibiliFolderId: '9008' } : ledger
    )
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 301, title: '带货软广避雷', description: '标题党', tags: [] }]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'inbox',
      targetFolderId: '9008',
      reviewRequired: true,
      selected: false
    })
  })

  it('does not auto-select videos when the target ledger has no Bilibili folder id', () => {
    const preview = createFavoriteLedgerPreview({
      ledgers: createDefaultFavoriteLedgers(),
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [{ aid: 401, title: '机器学习科普教程', description: '原理入门', tags: ['学习'] }]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'knowledge',
      targetFolderId: '',
      alreadyInTarget: false,
      selected: false
    })
  })

  it('uses broad default ledgers as old-favorite targets instead of inbox fallback', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) => {
      if (ledger.id === 'music') {
        return { ...ledger, bilibiliFolderId: '9010' }
      }
      if (ledger.id === 'inbox') {
        return { ...ledger, bilibiliFolderId: '9008' }
      }
      return ledger
    })
    const preview = createFavoriteLedgerPreview({
      ledgers,
      sourceFolders: [
        {
          id: '1',
          title: '默认收藏夹',
          videos: [
            {
              aid: 501,
              title: '大阪地铁自动扶梯现场音乐',
              tags: ['旅游', '出国'],
              category: '出行'
            }
          ]
        }
      ],
      targetMembership: {}
    })

    expect(preview.items[0]).toMatchObject({
      targetLedgerId: 'music',
      targetFolderId: '9010',
      reviewRequired: false,
      selected: true
    })
    expect(preview.items[0].targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ledgerId: 'music',
          folderId: '9010',
          displayName: 'Bilimi·音乐舞台',
          selected: true
        })
      ])
    )
    expect(preview.items[0].targets?.some((target) => target.ledgerId === 'inbox')).toBe(false)
  })
})
