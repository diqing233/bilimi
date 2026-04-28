import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { createFavoriteLedgerPreview } from './favoriteLedgerPreview'

describe('createFavoriteLedgerPreview', () => {
  it('excludes Bilimi-managed source folders and suggests append-only targets', () => {
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
      })
    ])
    expect(preview.skippedSourceFolderTitles).toEqual([managedKnowledgeFolder])
  })

  it('marks items already in the target ledger as skipped', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'humor' ? { ...ledger, bilibiliFolderId: '9002' } : ledger
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
        '9002': [201]
      }
    })

    expect(preview.items[0]).toMatchObject({
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
})
