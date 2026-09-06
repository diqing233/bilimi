import { describe, expect, it } from 'vitest'
import {
  BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
  BILIMI_LEDGER_PREFIX,
  createDefaultFavoriteLedgers,
  createRecommendedFavoriteLedgerId,
  createRecommendedFavoriteLedgerName,
  createRecommendedFavoriteLedgerNameForKind,
  createRecommendedFavoriteLedgerNames,
  createUserFavoriteLedgerId,
  disambiguateRecommendedFavoriteLedgerNames,
  favoriteLedgerNameLength,
  favoriteLedgerNameValidation,
  favoriteLedgerNamesById,
  favoriteLedgersById,
  isBilimiManagedLedgerName,
  normalizeFavoriteLedgers,
  createRemoteObservationFavoriteLedgerId,
  favoriteLedgerBindingNameAndShard,
  favoriteLedgerCapacityShardName,
  normalizeFavoriteLedgerBindingName,
  suggestFavoriteLedgerNames
} from './favoriteLedgers'

describe('recommended favorite ledger naming', () => {
  it('uses readable source labels instead of exposing a hash when author and tag names collide', () => {
    const author = createRecommendedFavoriteLedgerNameForKind('author', '明日方舟', [])
    const tag = createRecommendedFavoriteLedgerNameForKind('tag', '明日方舟', [author])
    expect(author).toBe('bilimi·明日方舟')
    expect(tag).toBe('bilimi·明日方舟（标签）')
  })

  it('keeps both readable source labels within the Bilibili name limit', () => {
    const displayName = 'bilimi·这是一个非常非常长的名称'
    const candidates = disambiguateRecommendedFavoriteLedgerNames([
      { kind: 'author' as const, sourceName: '这是一个非常非常长的名称', displayName },
      { kind: 'tag' as const, sourceName: '这是一个非常非常长的名称', displayName }
    ])

    expect(candidates.map((candidate) => candidate.displayName)).toEqual([
      'bilimi·这是一个非常非常长（UP）',
      'bilimi·这是一个非常非常长（标签）'
    ])
    expect(candidates.every((candidate) => favoriteLedgerNameValidation(candidate.displayName).valid)).toBe(true)
  })
})

describe('favorite ledger model', () => {
  it('allocates ordinary user-rule ids independently from scan recommendation ids', () => {
    expect(createUserFavoriteLedgerId('bilimi·梅林FIT', 123)).toBe('custom-bilimi-梅林fit-123')
    expect(createUserFavoriteLedgerId('音乐', 456)).toBe('custom-音乐-456')
  })

  it('derives one canonical remote-observation id from an exact Bilibili folder id', () => {
    expect(createRemoteObservationFavoriteLedgerId('4047644211')).toBe('custom-remote-4047644211')
    expect(createRemoteObservationFavoriteLedgerId('4047644211')).toBe(
      createRemoteObservationFavoriteLedgerId('4047644211')
    )
    expect(createRemoteObservationFavoriteLedgerId('4047644211')).not.toBe(
      createRemoteObservationFavoriteLedgerId('4047644212')
    )
    expect(createRemoteObservationFavoriteLedgerId('4000512789')).not.toBe(
      createRemoteObservationFavoriteLedgerId('4000749192')
    )
  })

  it('counts Unicode code points and validates the complete Bilibili ledger name', () => {
    expect(favoriteLedgerNameLength('bilimi·honker233')).toBe(16)
    expect(favoriteLedgerNameLength('bilimi·测试😀')).toBe(10)
    expect(favoriteLedgerNameValidation('bilimi·1234567890123')).toEqual({
      length: 20,
      maxLength: BILIBILI_FAVORITE_LEDGER_NAME_MAX_LENGTH,
      valid: true
    })
    expect(favoriteLedgerNameValidation('bilimi·12345678901234').valid).toBe(false)
  })

  it('uses the account prefix for a recommended author ledger and keeps it within 20 characters', () => {
    expect(createRecommendedFavoriteLedgerName('honker233-小王爱马枪', [])).toBe('bilimi·honker233')
    expect(createRecommendedFavoriteLedgerName('abcdefghijklmnop-超长账号', [])).toBe(
      'bilimi·abcdefghijklm'
    )
  })

  it('keeps the complete Unicode source in recommendation ids', () => {
    expect(createRecommendedFavoriteLedgerId('author', 'honker233-小王爱马枪')).toContain(
      'custom-author-honker233-小王爱马枪'
    )
    expect(createRecommendedFavoriteLedgerId('author', 'honker233-另一位主播')).toContain(
      'custom-author-honker233-另一位主播'
    )
    expect(createRecommendedFavoriteLedgerId('author', '中文UP一')).not.toBe(
      createRecommendedFavoriteLedgerId('author', '中文UP二')
    )
  })

  it('keeps recommendation ids distinct when different sources share a normalized slug', () => {
    expect(createRecommendedFavoriteLedgerId('author', 'UP Alpha')).not.toBe(
      createRecommendedFavoriteLedgerId('author', 'up-alpha')
    )
    expect(createRecommendedFavoriteLedgerId('tag', 'A B')).not.toBe(
      createRecommendedFavoriteLedgerId('tag', 'a-b')
    )
  })

  it('normalizes long tag recommendations without applying the author account-prefix rule', () => {
    const displayName = createRecommendedFavoriteLedgerNameForKind(
      'tag',
      '这是一个非常非常长的高频标签名称',
      []
    )

    expect(displayName).toBe('bilimi·这是一个非常非常长的高频标')
    expect(favoriteLedgerNameValidation(displayName).valid).toBe(true)
  })

  it('adds a stable short suffix when a recommended name conflicts', () => {
    const existing = ['bilimi·honker233']
    const first = createRecommendedFavoriteLedgerName('honker233-小王爱马枪', existing)
    const second = createRecommendedFavoriteLedgerName('honker233-小王爱马枪', existing)

    expect(first).toBe(second)
    expect(first).not.toBe('bilimi·honker233')
    expect(favoriteLedgerNameValidation(first).valid).toBe(true)
  })

  it('allocates conflicting recommended author names independently of candidate order', () => {
    const forward = createRecommendedFavoriteLedgerNames(
      ['honker233-小王爱马枪', 'honker233-另一个来源'],
      []
    )
    const reverse = createRecommendedFavoriteLedgerNames(
      ['honker233-另一个来源', 'honker233-小王爱马枪'],
      []
    )

    expect(Object.fromEntries(forward)).toEqual(Object.fromEntries(reverse))
    expect(new Set(forward.values())).toHaveLength(2)
    expect(Array.from(forward.values()).every((name) => favoriteLedgerNameValidation(name).valid)).toBe(true)
  })

  it('keeps probing when the stable recommended suffix is already occupied', () => {
    const sourceName = 'honker233-小王爱马枪'
    const firstConflictName = createRecommendedFavoriteLedgerName(sourceName, ['bilimi·honker233'])
    const nextConflictName = createRecommendedFavoriteLedgerName(sourceName, [
      'bilimi·honker233',
      firstConflictName
    ])

    expect(nextConflictName).not.toBe(firstConflictName)
    expect(favoriteLedgerNameValidation(nextConflictName).valid).toBe(true)
  })

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

  it('preserves a deliberate default-folder deletion marker during preference normalization', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'music', displayName: 'bilimi·音乐舞台', keywords: ['音乐'], enabled: false, priority: 60,
      isDefault: true, managedFolderDeletedByUser: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }])

    expect(ledgers.find((ledger) => ledger.id === 'music')).toEqual(expect.objectContaining({
      id: 'music', managedFolderDeletedByUser: true, bindingState: 'bound', bilibiliFolderId: '9001'
    }))
  })

  it('repairs repeated remote-draft records by retaining the copy with its remote folder id', () => {
    const ledgers = normalizeFavoriteLedgers([
      {
        id: 'custom-remote-demo',
        displayName: 'bilimi·示例',
        keywords: [],
        enabled: false,
        priority: 90,
        bindingState: 'unbound',
        syncState: 'local-draft',
        isDefault: false
      },
      {
        id: 'custom-remote-demo',
        displayName: 'bilimi·示例',
        keywords: [],
        enabled: false,
        priority: 100,
        bilibiliFolderId: '42',
        bindingState: 'unbound',
        syncState: 'local-draft',
        isDefault: false
      }
    ])

    expect(ledgers.filter((ledger) => ledger.id === 'custom-remote-demo')).toEqual([{
      id: 'custom-remote-demo',
      displayName: 'bilimi·示例',
      keywords: [],
      enabled: false,
      priority: 100,
      bilibiliFolderId: '42',
      bindingState: 'unbound',
      syncState: 'local-draft',
      isDefault: false
    }])
  })

  it('removes a persisted remote draft after its remote folder id is lost', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'custom-remote-orphan',
      displayName: 'bilimi·历史残留',
      keywords: [],
      enabled: false,
      priority: 90,
      bindingState: 'unbacked',
      syncState: 'local-draft',
      isDefault: false
    }])

    expect(ledgers.map((ledger) => ledger.id)).not.toContain('custom-remote-orphan')
  })

  it('migrates an ambiguous local draft to a saved rule instead of giving a later checkbox permission to delete it', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'custom-legacy-rule',
      displayName: 'bilimi·旧规则',
      keywords: ['旧规则'],
      enabled: true,
      priority: 90,
      syncState: 'local-draft',
      isDefault: false
    }])

    expect(ledgers.find((ledger) => ledger.id === 'custom-legacy-rule')).toEqual(expect.objectContaining({
      ruleOrigin: 'saved-rule'
    }))
    expect(ledgers.find((ledger) => ledger.id === 'custom-legacy-rule')).not.toHaveProperty('syncState')
  })

  it('preserves leading and trailing author symbols in recommendation names', () => {
    expect(createRecommendedFavoriteLedgerName('-恒某人-', [])).toBe('bilimi·-恒某人-')
  })

  it('normalizes only equivalent binding names and recognizes manual circled-number shards', () => {
    expect(normalizeFavoriteLedgerBindingName(' Ｂｉｌｉｍｉ· 游戏专区 ')).toBe('bilimi· 游戏专区')
    expect(favoriteLedgerBindingNameAndShard('bilimi·游戏专区')).toEqual({ baseName: 'bilimi·游戏专区', shardNumber: 1 })
    expect(favoriteLedgerBindingNameAndShard('bilimi·游戏专区①')).toEqual({ baseName: 'bilimi·游戏专区', shardNumber: 1 })
    expect(favoriteLedgerBindingNameAndShard('bilimi·游戏专区②')).toEqual({ baseName: 'bilimi·游戏专区', shardNumber: 2 })
    expect(favoriteLedgerCapacityShardName('bilimi·游戏专区', 1)).toBe('bilimi·游戏专区')
    expect(favoriteLedgerCapacityShardName('bilimi·游戏专区', 2)).toBe('bilimi·游戏专区②')
    expect(favoriteLedgerCapacityShardName('bilimi·游戏专区', 51)).toBe('bilimi·游戏专区⑤①')
    expect(favoriteLedgerCapacityShardName('12345678901234567890', 2)).toBe('1234567890123456789②')
    expect(favoriteLedgerBindingNameAndShard('bilimi·游戏专区⑤①')).toEqual({ baseName: 'bilimi·游戏专区', shardNumber: 51 })
  })

  it('migrates historical recommendation drafts into ordinary saved rules', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'custom-legacy-recommendation',
      displayName: 'bilimi·历史推荐',
      keywords: ['历史推荐'],
      ruleType: 'keyword',
      enabled: true,
      priority: 90,
      syncState: 'local-draft',
      ruleOrigin: 'recommendation-draft',
      bindingState: 'unbacked',
      isDefault: false
    }])

    expect(ledgers.find((ledger) => ledger.id === 'custom-legacy-recommendation')).toMatchObject({
      ruleOrigin: 'saved-rule',
      enabled: true,
      bindingState: 'unbacked'
    })
  })

  it('requires an explicit save and binding for a legacy recommendation draft with a remote folder', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'custom-legacy-recommendation-remote',
      displayName: 'bilimi·历史推荐',
      keywords: ['历史推荐'],
      ruleType: 'keyword',
      enabled: true,
      priority: 90,
      syncState: 'local-draft',
      ruleOrigin: 'recommendation-draft',
      bindingState: 'bound',
      bilibiliFolderId: 'remote-legacy-recommendation',
      isDefault: false
    }])

    expect(ledgers.find((ledger) => ledger.id === 'custom-legacy-recommendation-remote')).toMatchObject({
      ruleOrigin: 'saved-rule',
      syncState: 'local-draft',
      bindingState: 'unbound',
      bilibiliFolderId: 'remote-legacy-recommendation'
    })
  })

  it('requires an explicit save and binding when a legacy recommendation draft retains only shard ids', () => {
    const ledgers = normalizeFavoriteLedgers([{
      id: 'custom-legacy-recommendation-shards',
      displayName: 'bilimi·历史推荐',
      keywords: ['历史推荐'],
      ruleType: 'keyword',
      enabled: true,
      priority: 90,
      syncState: 'local-draft',
      ruleOrigin: 'recommendation-draft',
      bindingState: 'bound',
      bilibiliFolderIds: ['remote-legacy-recommendation-1', 'remote-legacy-recommendation-2'],
      isDefault: false
    }])

    expect(ledgers.find((ledger) => ledger.id === 'custom-legacy-recommendation-shards')).toMatchObject({
      ruleOrigin: 'saved-rule',
      syncState: 'local-draft',
      bindingState: 'unbound',
      bilibiliFolderIds: ['remote-legacy-recommendation-1', 'remote-legacy-recommendation-2']
    })
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
