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
})
