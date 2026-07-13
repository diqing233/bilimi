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
        ['knowledge', 'bilimi·知识学习'],
        ['game', 'bilimi·游戏专区'],
        ['movie-tv', 'bilimi·影视动漫'],
        ['creative-aesthetic', 'bilimi·创意美学'],
        ['life-interest', 'bilimi·生活日常'],
        ['music', 'bilimi·音乐舞台'],
        ['entertainment', 'bilimi·搞笑杂谈'],
        ['inbox', 'bilimi·暂存']
      ])
    )
    expect(createDefaultFavoriteLedgers()).toHaveLength(8)
  })

  it('keeps broad game defaults free of specific game titles', () => {
    const gameLedger = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'game')

    expect(gameLedger?.keywords).not.toContain('\u539f\u795e')
    expect(gameLedger?.keywords).not.toContain('genshin')
  })

  it('keeps broad music defaults free of specific performer names', () => {
    const musicLedger = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'music')

    expect(musicLedger?.keywords).not.toContain('Michael Jackson')
    expect(musicLedger?.keywords).not.toContain('迈克尔杰克逊')
    expect(musicLedger?.keywords).not.toContain('MJ')
  })

  it('classifies human geography and border city videos as knowledge content', () => {
    const knowledgeLedger = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'knowledge')

    expect(knowledgeLedger?.keywords).toEqual(
      expect.arrayContaining(['人文', '地理', '城市', '社会观察', '边境'])
    )
  })

  it('classifies blessing and everyday record videos as life content', () => {
    const lifeLedger = createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'life-interest')

    expect(lifeLedger?.keywords).toEqual(expect.arrayContaining(['祝福', '生活记录']))
  })

  it('uses combination phrases for ambiguous default keywords', () => {
    const ledgers = createDefaultFavoriteLedgers()
    const game = ledgers.find((ledger) => ledger.id === 'game')
    const movie = ledgers.find((ledger) => ledger.id === 'movie-tv')
    const life = ledgers.find((ledger) => ledger.id === 'life-interest')
    const knowledge = ledgers.find((ledger) => ledger.id === 'knowledge')

    expect(game?.keywords).toEqual(expect.arrayContaining(['游戏攻略', '游戏剧情']))
    expect(game?.keywords).not.toEqual(expect.arrayContaining(['攻略', '剧情']))
    expect(movie?.keywords).toEqual(expect.arrayContaining(['影视剧情', '番剧剧情', '电影剧情']))
    expect(movie?.keywords).not.toEqual(expect.arrayContaining(['剧情']))
    expect(life?.keywords).toEqual(
      expect.arrayContaining(['生活攻略', '旅行攻略', '装修攻略', '收纳技巧'])
    )
    expect(knowledge?.keywords).toEqual(
      expect.arrayContaining(['知识科普', '科普常识', '冷知识', '小知识', '原理讲解'])
    )
  })

  it('orders reset defaults as broad initial ledgers and enables all of them', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(ledgers.map((ledger) => ledger.displayName)).toEqual([
      'bilimi·知识学习',
      'bilimi·游戏专区',
      'bilimi·影视动漫',
      'bilimi·创意美学',
      'bilimi·生活日常',
      'bilimi·音乐舞台',
      'bilimi·搞笑杂谈',
      'bilimi·暂存'
    ])
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·动画')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·鬼畜')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·科技数码')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·手工')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·纪录片')
    expect(ledgers.filter((ledger) => ledger.enabled).map((ledger) => ledger.id)).toEqual(
      ledgers.map((ledger) => ledger.id)
    )
  })

  it('preserves custom ledgers and fills missing default ledgers', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'knowledge',
        displayName: 'bilimi·开卷有益',
        keywords: ['开卷'],
        enabled: false,
        priority: 21,
        isDefault: true
      },
      {
        id: 'custom-photo',
        displayName: 'bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: 5,
        isDefault: false
      }
    ])

    expect(ledgers).toHaveLength(9)
    expect(ledgers.find((ledger) => ledger.id === 'knowledge')).toEqual({
      id: 'knowledge',
      displayName: 'bilimi·开卷有益',
      keywords: ['开卷'],
      enabled: false,
      priority: 21,
      isDefault: true
    })
    expect(ledgers.find((ledger) => ledger.id === 'custom-photo')?.displayName).toBe(
      'bilimi·光影留真'
    )
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('bilimi·暂存')
  })

  it('keeps a saved legacy pending-classification inbox ledger as inbox', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'inbox',
        displayName: 'bilimi·待分类',
        keywords: ['稍后', '待看'],
        enabled: true,
        priority: 80,
        isDefault: true
      }
    ])

    expect(ledgers.filter((ledger) => ledger.id === 'inbox')).toHaveLength(1)
    expect(ledgers.find((ledger) => ledger.id === 'inbox')?.displayName).toBe('bilimi·待分类')
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
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·动画')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·鬼畜')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·科技数码')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·手工')
    expect(ledgers.map((ledger) => ledger.displayName)).not.toContain('bilimi·纪录片')
    expect(ledgers.find((ledger) => ledger.id === 'movie-tv')?.displayName).toBe('bilimi·影视动漫')
  })

  it('creates lowercase bilimi-prefixed ledgers while recognizing legacy uppercase names', () => {
    expect(BILIMI_LEDGER_PREFIX).toBe('bilimi·')
    expect(isBilimiManagedLedgerName('bilimi·知识学习')).toBe(true)
    expect(isBilimiManagedLedgerName('Bilimi·知识学习')).toBe(true)
    expect(isBilimiManagedLedgerName('默认收藏夹')).toBe(false)
    expect(isBilimiManagedLedgerName('我的 Bilimi 灵感')).toBe(false)
    expect(isBilimiManagedLedgerName('我的 bilimi 灵感')).toBe(false)
  })

  it('normalizes legacy visible Bilimi prefixes to lowercase bilimi', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'custom-legacy',
        displayName: 'Bilimi·摄影追更',
        keywords: ['摄影'],
        enabled: true,
        priority: 10,
        isDefault: false
      },
      {
        id: 'custom-space',
        displayName: 'Bilimi 暂存',
        keywords: ['暂存'],
        enabled: true,
        priority: 20,
        isDefault: false
      }
    ])

    expect(ledgers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'custom-legacy', displayName: 'bilimi·摄影追更' }),
        expect.objectContaining({ id: 'custom-space', displayName: 'bilimi·暂存' })
      ])
    )
  })

  it('recommends three plain names from a topic', () => {
    expect(suggestFavoriteLedgerNames('摄影')).toEqual([
      'bilimi·摄影',
      'bilimi·摄影教程',
      'bilimi·摄影灵感'
    ])
    expect(suggestFavoriteLedgerNames('编程')).toEqual([
      'bilimi·编程',
      'bilimi·编程教程',
      'bilimi·开发工具'
    ])
  })

  it('indexes ledgers and ledger display names by id', () => {
    const ledgers = [
      {
        id: 'knowledge',
        displayName: 'bilimi·知识学习',
        keywords: ['知识', '学习'],
        enabled: true,
        priority: 10,
        isDefault: true
      },
      {
        id: 'custom-photo',
        displayName: 'bilimi·光影留真',
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
      knowledge: 'bilimi·知识学习',
      'custom-photo': 'bilimi·光影留真'
    })
  })
})
