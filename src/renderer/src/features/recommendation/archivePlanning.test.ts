import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { planFavoriteArchiveTargets } from './archivePlanning'

describe('planFavoriteArchiveTargets', () => {
  it('keeps default Bilimi ledgers mutually exclusive even when several default keywords match', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game'
        ? { ...ledger, bilibiliFolderId: 'game-folder' }
        : ledger.id === 'music'
          ? { ...ledger, bilibiliFolderId: 'music-folder' }
          : ledger.id === 'movie-tv'
            ? { ...ledger, bilibiliFolderId: 'movie-folder' }
            : ledger
    )

    expect(
      planFavoriteArchiveTargets({
        context: {
          title: 'genshin MV music',
          tags: ['genshin', 'MV']
        },
        ledgers,
        multiArchiveMode: 'three'
      }).map((target) => target.ledgerId)
    ).toEqual(['game'])
  })

  it('uses the strongest custom topic only when multi-archive is disabled', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-genshin',
        displayName: 'Bilimi·Genshin',
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
        displayName: 'Bilimi·Genshin',
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
        displayName: 'Bilimi·Genshin',
        keywords: ['genshin'],
        enabled: true,
        priority: -30,
        bilibiliFolderId: 'genshin-folder',
        isDefault: false
      },
      {
        id: 'custom-mihoyo',
        displayName: 'Bilimi·Mihoyo',
        keywords: ['mihoyo'],
        enabled: true,
        priority: -20,
        bilibiliFolderId: 'mihoyo-folder',
        isDefault: false
      },
      {
        id: 'custom-music',
        displayName: 'Bilimi·Game OST',
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
