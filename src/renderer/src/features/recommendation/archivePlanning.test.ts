import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { planFavoriteArchiveTargets } from './archivePlanning'

describe('planFavoriteArchiveTargets', () => {
  it('allows multiple default Bilimi ledgers up to the configured archive limit', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, keywords: ['game'], bilibiliFolderId: 'game-folder' }
        : ledger.id === 'music'
          ? { ...ledger, keywords: ['music'], bilibiliFolderId: 'music-folder' }
          : ledger.id === 'movie-tv'
            ? { ...ledger, keywords: ['movie'], bilibiliFolderId: 'movie-folder' }
            : ledger
    )

    expect(
      planFavoriteArchiveTargets({
        context: {
          title: 'game music movie'
        },
        ledgers,
        multiArchiveMode: 'three'
      }).map((target) => target.ledgerId)
    ).toEqual(['game', 'movie-tv', 'music'])
  })

  it('prioritizes generated and custom topics before matching default ledgers', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers().map((ledger) =>
        ledger.id === 'game'
          ? { ...ledger, keywords: ['game'], bilibiliFolderId: 'game-folder' }
          : ledger.id === 'music'
            ? { ...ledger, keywords: ['music'], bilibiliFolderId: 'music-folder' }
            : ledger
      ),
      {
        id: 'custom-genshin',
        displayName: 'bilimi·Genshin',
        keywords: ['genshin'],
        enabled: true,
        priority: -30,
        bilibiliFolderId: 'genshin-folder',
        isDefault: false
      },
      {
        id: 'custom-mihoyo',
        displayName: 'bilimi·Mihoyo',
        keywords: ['mihoyo'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'mihoyo-folder',
        isDefault: false
      }
    ]

    expect(
      planFavoriteArchiveTargets({
        context: { title: 'genshin mihoyo game music' },
        ledgers,
        multiArchiveMode: 'three'
      }).map((target) => target.ledgerId)
    ).toEqual(['custom-genshin', 'custom-mihoyo', 'game'])
  })

  it('uses the strongest custom topic only when multi-archive is disabled', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-genshin',
        displayName: 'bilimi·Genshin',
        keywords: ['genshin'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'genshin-folder',
        isDefault: false
      }
    ]

    expect(
      planFavoriteArchiveTargets({
        context: { title: 'genshin team guide', tags: ['genshin'] },
        ledgers,
        multiArchiveMode: 'off'
      }).map((target) => target.ledgerId)
    ).toEqual(['custom-genshin'])
  })

  it('adds one default Bilimi category after a custom topic when two archives are allowed', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-genshin',
        displayName: 'bilimi·Genshin',
        keywords: ['genshin'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'genshin-folder',
        isDefault: false
      }
    ]

    expect(
      planFavoriteArchiveTargets({
        context: { title: 'genshin team guide', tags: ['genshin'] },
        ledgers,
        multiArchiveMode: 'two'
      }).map((target) => target.ledgerId)
    ).toEqual(['custom-genshin', 'game'])
  })

  it('allows at most two custom topics plus one default category when three archives are allowed', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-genshin',
        displayName: 'bilimi·Genshin',
        keywords: ['genshin'],
        enabled: true,
        priority: -30,
        bilibiliFolderId: 'genshin-folder',
        isDefault: false
      },
      {
        id: 'custom-mihoyo',
        displayName: 'bilimi·Mihoyo',
        keywords: ['mihoyo'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'mihoyo-folder',
        isDefault: false
      },
      {
        id: 'custom-music',
        displayName: 'bilimi·Game OST',
        keywords: ['ost'],
        enabled: true,
        priority: -10,
        bilibiliFolderId: 'topic-music-folder',
        isDefault: false
      }
    ]

    expect(
      planFavoriteArchiveTargets({
        context: { title: 'mihoyo genshin ost', tags: ['genshin', 'mihoyo', 'ost'] },
        ledgers,
        multiArchiveMode: 'three'
      }).map((target) => target.ledgerId)
    ).toEqual(['custom-genshin', 'custom-mihoyo', 'game'])
  })

  it('applies archive strategy to default selected state', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: '9001' } : ledger
    )

    const lowSignal = { title: '教程入门' }

    expect(
      planFavoriteArchiveTargets({
        context: lowSignal,
        ledgers,
        multiArchiveMode: 'off',
        archiveStrategy: 'aggressive'
      })[0]?.selectedByStrategy
    ).toBe(true)

    expect(
      planFavoriteArchiveTargets({
        context: lowSignal,
        ledgers,
        multiArchiveMode: 'off',
        archiveStrategy: 'conservative'
      })[0]?.selectedByStrategy
    ).toBe(false)
  })

  it('uses sufficient score gap for balanced strategy selection', () => {
    const target = planFavoriteArchiveTargets({
      context: { title: '现场翻唱舞台演奏' },
      ledgers: createDefaultFavoriteLedgers(),
      multiArchiveMode: 'off',
      archiveStrategy: 'balanced'
    })[0]

    expect(target?.ledgerId).toBe('music')
    expect(target?.diagnostic?.scoreGap).toBeGreaterThanOrEqual(2.5)
    expect(target?.selectedByStrategy).toBe(true)
  })

  it('keeps balanced strategy unselected when strong defaults are ambiguous', () => {
    const targets = planFavoriteArchiveTargets({
      context: { title: '摄影构图调色 翻唱演奏舞台' },
      ledgers: createDefaultFavoriteLedgers(),
      multiArchiveMode: 'two',
      archiveStrategy: 'balanced'
    })

    expect(targets.map((target) => target.ledgerId)).toEqual(['creative-aesthetic', 'music'])
    expect(targets[0]?.diagnostic?.scoreGap).toBe(0)
    expect(targets[0]?.selectedByStrategy).toBe(false)
    expect(targets[1]?.diagnostic?.scoreGap).toBe(0)
    expect(targets[1]?.selectedByStrategy).toBe(false)
  })

  it('uses the strongest competing score for default diagnostics even after custom targets', () => {
    const ledgers = [
      {
        id: 'custom-topic',
        displayName: 'bilimi·专题',
        keywords: ['专题'],
        enabled: true,
        priority: -30,
        bilibiliFolderId: 'custom-folder',
        isDefault: false
      },
      ...createDefaultFavoriteLedgers()
    ]

    const targets = planFavoriteArchiveTargets({
      context: { title: '专题 摄影构图调色 翻唱演奏舞台' },
      ledgers,
      multiArchiveMode: 'three',
      archiveStrategy: 'balanced'
    })
    const creative = targets.find((target) => target.ledgerId === 'creative-aesthetic')
    const music = targets.find((target) => target.ledgerId === 'music')

    expect(targets[0]?.ledgerId).toBe('custom-topic')
    expect(creative?.diagnostic?.runnerUpScore).toBe(creative?.diagnostic?.score)
    expect(creative?.diagnostic?.scoreGap).toBe(0)
    expect(creative?.selectedByStrategy).toBe(false)
    expect(music?.diagnostic?.runnerUpScore).toBe(music?.diagnostic?.score)
    expect(music?.diagnostic?.scoreGap).toBe(0)
    expect(music?.selectedByStrategy).toBe(false)
  })

  it('carries diagnostics and strategy selection for custom targets', () => {
    const ledgers = [
      {
        id: 'custom-tag-guide',
        displayName: 'bilimi·攻略合集',
        keywords: ['攻略'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'custom-folder',
        isDefault: false,
        ruleType: 'tag' as const
      },
      ...createDefaultFavoriteLedgers()
    ]

    const target = planFavoriteArchiveTargets({
      context: { title: '专题整理', tags: ['攻略'] },
      ledgers,
      multiArchiveMode: 'off',
      archiveStrategy: 'conservative'
    })[0]

    expect(target).toMatchObject({
      ledgerId: 'custom-tag-guide',
      selectedByStrategy: true,
      diagnostic: expect.objectContaining({
        confidence: 'high',
        matchedKeywords: ['攻略']
      })
    })
  })
})
