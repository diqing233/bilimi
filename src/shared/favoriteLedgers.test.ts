import { describe, expect, it } from 'vitest'
import {
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  favoriteLedgerNamesById,
  favoriteLedgersById,
  isBilimiManagedLedgerName,
  normalizeFavoriteLedgers,
  suggestFavoriteLedgerNames
} from './favoriteLedgers'

describe('favorite ledger model', () => {
  it('defines eight enabled Bilimi default ledgers with stable ids', () => {
    expect(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName])).toEqual([
      ['knowledge', 'Bilimi·见闻增广'],
      ['humor', 'Bilimi·茶余解颐'],
      ['story', 'Bilimi·影剧情长'],
      ['play', 'Bilimi·游艺演武'],
      ['life', 'Bilimi·市井烟火'],
      ['craft', 'Bilimi·工巧器用'],
      ['music', 'Bilimi·歌舞清音'],
      ['inbox', 'Bilimi·暂存待阅']
    ])
    expect(createDefaultFavoriteLedgers().every((ledger) => ledger.enabled)).toBe(true)
  })

  it('preserves custom ledgers and fills missing default ledgers', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'knowledge',
        displayName: 'Bilimi·开卷有益',
        keywords: ['开卷'],
        enabled: false,
        priority: 21,
        isDefault: true
      },
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: 5,
        isDefault: false
      }
    ])

    expect(ledgers).toHaveLength(9)
    expect(ledgers.find((ledger) => ledger.id === 'knowledge')).toEqual({
      id: 'knowledge',
      displayName: 'Bilimi·开卷有益',
      keywords: ['开卷'],
      enabled: false,
      priority: 21,
      isDefault: true
    })
    expect(ledgers.find((ledger) => ledger.id === 'custom-photo')?.displayName).toBe(
      'Bilimi·光影留真'
    )
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('Bilimi·暂存待阅')
  })

  it('recognizes only Bilimi-prefixed ledger names as managed', () => {
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
    expect(isBilimiManagedLedgerName('Bilimi·见闻增广')).toBe(true)
    expect(isBilimiManagedLedgerName('默认收藏夹')).toBe(false)
    expect(isBilimiManagedLedgerName('我的 Bilimi 灵感')).toBe(false)
  })

  it('recommends three court-style names from a topic', () => {
    expect(suggestFavoriteLedgerNames('摄影')).toEqual([
      'Bilimi·光影留真',
      'Bilimi·镜里春秋',
      'Bilimi·取景小札'
    ])
    expect(suggestFavoriteLedgerNames('编程')).toEqual([
      'Bilimi·码艺札记',
      'Bilimi·机杼成文',
      'Bilimi·格物编修'
    ])
  })

  it('indexes ledgers and ledger display names by id', () => {
    const ledgers = [
      {
        id: 'knowledge',
        displayName: 'Bilimi·见闻增广',
        keywords: ['知识'],
        enabled: true,
        priority: 10,
        isDefault: true
      },
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影'],
        enabled: false,
        priority: 20,
        isDefault: false
      }
    ]

    expect(favoriteLedgersById(ledgers)).toEqual({
      knowledge: ledgers[0],
      'custom-photo': ledgers[1]
    })
    expect(favoriteLedgerNamesById(ledgers)).toEqual({
      knowledge: 'Bilimi·见闻增广',
      'custom-photo': 'Bilimi·光影留真'
    })
  })
})
