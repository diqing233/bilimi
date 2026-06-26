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
        ['knowledge', 'Bilimi·知识学习'],
        ['game', 'Bilimi·游戏专区'],
        ['movie-tv', 'Bilimi·影视动漫'],
        ['creative-aesthetic', 'Bilimi·创意美学'],
        ['life-interest', 'Bilimi·生活日常'],
        ['music', 'Bilimi·音乐舞台'],
        ['entertainment', 'Bilimi·搞笑杂谈'],
        ['inbox', 'Bilimi·待分类']
      ])
    )
    expect(createDefaultFavoriteLedgers()).toHaveLength(8)
  })

  it('orders reset defaults as broad initial ledgers and enables all of them', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(ledgers.map((ledger) => ledger.displayName)).toEqual([
      'Bilimi·知识学习',
      'Bilimi·游戏专区',
      'Bilimi·影视动漫',
      'Bilimi·创意美学',
      'Bilimi·生活日常',
      'Bilimi·音乐舞台',
      'Bilimi·搞笑杂谈',
      'Bilimi·待分类'
    ])
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·动画')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·鬼畜')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·科技数码')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·手工')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·纪录片')
    expect(ledgers.filter((ledger) => ledger.enabled).map((ledger) => ledger.id)).toEqual(
      ledgers.map((ledger) => ledger.id)
    )
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
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('Bilimi·待分类')
  })

  it('retires removed default ledgers from saved preferences', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'tech-digital',
        displayName: 'Bilimi·科技数码',
        keywords: ['科技'],
        enabled: true,
        priority: 90,
        isDefault: true
      },
      {
        id: 'kichiku',
        displayName: 'Bilimi·鬼畜',
        keywords: ['鬼畜'],
        enabled: true,
        priority: 30,
        isDefault: true
      },
      {
        id: 'handmade',
        displayName: 'Bilimi·手工',
        keywords: ['手工'],
        enabled: true,
        priority: 320,
        isDefault: true
      },
      {
        id: 'documentary',
        displayName: 'Bilimi·纪录片',
        keywords: ['纪录片'],
        enabled: true,
        priority: 350,
        isDefault: true
      }
    ])

    expect(ledgers.map((ledger) => ledger.id)).not.toContain('tech-digital')
    expect(ledgers.map((ledger) => ledger.id)).not.toContain('kichiku')
    expect(ledgers.map((ledger) => ledger.id)).not.toContain('handmade')
    expect(ledgers.map((ledger) => ledger.id)).not.toContain('documentary')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·动画')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·鬼畜')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·科技数码')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·手工')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('Bilimi·纪录片')
    expect(ledgers.find((ledger) => ledger.id === 'movie-tv')?.displayName).toBe('Bilimi·影视动漫')
  })

  it('recognizes only Bilimi-prefixed ledger names as managed', () => {
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
    expect(isBilimiManagedLedgerName('Bilimi·知识学习')).toBe(true)
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
        displayName: 'Bilimi·知识学习',
        keywords: ['知识', '学习'],
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
      knowledge: 'Bilimi·知识学习',
      'custom-photo': 'Bilimi·光影留真'
    })
  })
})
