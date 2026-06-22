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
  it('defines Bilibili-style default ledgers with stable ids', () => {
    expect(createDefaultFavoriteLedgers().map((ledger) => [ledger.id, ledger.displayName])).toEqual(
      expect.arrayContaining([
        ['animation', 'Bilimi·动画'],
        ['kichiku', 'Bilimi·鬼畜'],
        ['dance', 'Bilimi·舞蹈'],
        ['entertainment', 'Bilimi·娱乐'],
        ['tech-digital', 'Bilimi·科技数码'],
        ['food', 'Bilimi·美食'],
        ['game', 'Bilimi·游戏'],
        ['music', 'Bilimi·音乐'],
        ['movie-tv', 'Bilimi·影视'],
        ['knowledge', 'Bilimi·知识'],
        ['ai', 'Bilimi·人工智能'],
        ['inbox', 'Bilimi·待分类']
      ])
    )
    expect(createDefaultFavoriteLedgers()).toHaveLength(35)
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

    expect(ledgers).toHaveLength(36)
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
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('Bilimi·待分类')
  })

  it('recognizes only Bilimi-prefixed ledger names as managed', () => {
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
    expect(isBilimiManagedLedgerName('Bilimi·动画')).toBe(true)
    expect(isBilimiManagedLedgerName('默认收藏夹')).toBe(false)
    expect(isBilimiManagedLedgerName('我的 Bilimi 灵感')).toBe(false)
  })

  it('recommends three plain names from a topic', () => {
    expect(suggestFavoriteLedgerNames('摄影')).toEqual([
      'Bilimi·摄影',
      'Bilimi·摄影教程',
      'Bilimi·摄影灵感'
    ])
    expect(suggestFavoriteLedgerNames('编程')).toEqual([
      'Bilimi·编程',
      'Bilimi·编程教程',
      'Bilimi·开发工具'
    ])
  })

  it('indexes ledgers and ledger display names by id', () => {
    const ledgers = [
      {
        id: 'knowledge',
        displayName: 'Bilimi·知识',
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
      knowledge: 'Bilimi·知识',
      'custom-photo': 'Bilimi·光影留真'
    })
  })
})
