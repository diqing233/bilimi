import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import { buildVideoContentContextScript, classifyVideoContent } from './videoClassifier'

describe('classifyVideoContent', () => {
  it('classifies common Bilibili topics into the default ledger ids', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' }, ledgers).ledgerId).toBe(
      'knowledge'
    )
    expect(classifyVideoContent({ title: '爆笑整活鬼畜合集' }, ledgers).ledgerId).toBe(
      'entertainment'
    )
    expect(classifyVideoContent({ title: '第十二集剧情反转名场面' }, ledgers).ledgerId).toBe(
      'movie-tv'
    )
    expect(classifyVideoContent({ title: '电竞赛事操作技巧复盘' }, ledgers).ledgerId).toBe('game')
    expect(classifyVideoContent({ title: '周末探店美食 Vlog' }, ledgers).ledgerId).toBe(
      'life-interest'
    )
    expect(classifyVideoContent({ title: '效率软件与数码工具测评' }, ledgers).ledgerId).toBe(
      'knowledge'
    )
    expect(classifyVideoContent({ title: '现场翻唱舞台演奏' }, ledgers).ledgerId).toBe('music')
  })

  it('classifies extra topic signals missing from default ledger keywords', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '鬼畜合集' }, ledgers).ledgerId).toBe('entertainment')
    expect(classifyVideoContent({ title: '运动技巧' }, ledgers).ledgerId).toBe('life-interest')
    expect(classifyVideoContent({ title: '探店 Vlog' }, ledgers).ledgerId).toBe('life-interest')
    expect(classifyVideoContent({ title: '软件教程' }, ledgers).ledgerId).toBe('knowledge')
  })

  it('uses broad initial defaults instead of sending common topics to inbox', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '第十二集剧情反转名场面' }, ledgers).ledgerId).toBe(
      'movie-tv'
    )
    expect(classifyVideoContent({ title: '运动技巧' }, ledgers).ledgerId).toBe('life-interest')
    expect(classifyVideoContent({ title: '新番二次元同人解析' }, ledgers).ledgerId).toBe(
      'movie-tv'
    )
  })

  it('uses old favorite category names as local non-AI classification signals', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(
      classifyVideoContent({ title: '年度旗舰横评', tags: [], category: '科技数码' }, ledgers)
        .ledgerId
    ).toBe('knowledge')
    expect(classifyVideoContent({ title: '东京周末路线', tags: [], category: '出行' }, ledgers)).toMatchObject({
      ledgerId: 'life-interest',
      reviewRequired: false,
      displayName: 'bilimi·生活日常'
    })
    expect(classifyVideoContent({ title: '露营装备清单', tags: [], category: '户外' }, ledgers)).toMatchObject({
      ledgerId: 'life-interest',
      reviewRequired: false,
      displayName: 'bilimi·生活日常'
    })
  })

  it('classifies expanded broad-topic signals into the seven default themes', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '现场音乐高燃混剪' }, ledgers)).toMatchObject({
      ledgerId: 'music',
      matchedKeywords: expect.arrayContaining(['现场音乐'])
    })
    expect(classifyVideoContent({ title: 'React 前端项目实战' }, ledgers).ledgerId).toBe(
      'knowledge'
    )
    expect(classifyVideoContent({ title: '单机游戏 Boss 速通路线' }, ledgers).ledgerId).toBe(
      'game'
    )
    expect(classifyVideoContent({ title: '纪录片幕后剪辑解析' }, ledgers).ledgerId).toBe(
      'movie-tv'
    )
    expect(classifyVideoContent({ title: '板绘构图与配色教程' }, ledgers).ledgerId).toBe(
      'creative-aesthetic'
    )
    expect(classifyVideoContent({ title: '新能源车试驾体验' }, ledgers).ledgerId).toBe(
      'life-interest'
    )
    expect(classifyVideoContent({ title: '综艺爆笑 reaction' }, ledgers).ledgerId).toBe(
      'entertainment'
    )
  })

  it('classifies concept variants without requiring exact keyword copies', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '科普小常识合集' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '科普常识' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '知识科普' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '冷知识十连发' }, ledgers).ledgerId).toBe('knowledge')
  })

  it('uses context to disambiguate 攻略 and 剧情', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '东京旅行攻略' }, ledgers).ledgerId).toBe('life-interest')
    expect(classifyVideoContent({ title: '装修避坑攻略' }, ledgers).ledgerId).toBe('life-interest')
    expect(classifyVideoContent({ title: '原神攻略' }, ledgers).ledgerId).toBe('game')
    expect(classifyVideoContent({ title: '星铁剧情解析' }, ledgers).ledgerId).toBe('game')
    expect(classifyVideoContent({ title: '第十二集剧情反转' }, ledgers).ledgerId).toBe('movie-tv')
    expect(classifyVideoContent({ title: '电影剧情解析' }, ledgers).ledgerId).toBe('movie-tv')
  })

  it('emits confidence diagnostics and low-confidence markers', () => {
    const result = classifyVideoContent({ title: '攻略教程入门' }, createDefaultFavoriteLedgers())

    expect(result.diagnostic).toMatchObject({
      confidence: 'low',
      lowConfidence: true,
      weakSignals: expect.arrayContaining(['攻略', '教程', '入门'])
    })
  })

  it('keeps weak terms low confidence even when repeated across fields', () => {
    const result = classifyVideoContent(
      {
        title: '教程入门',
        category: '教程',
        tags: ['教程', '入门']
      },
      createDefaultFavoriteLedgers()
    )

    expect(result.diagnostic).toMatchObject({
      confidence: 'low',
      lowConfidence: true
    })
  })

  it('does not classify consumer contexts as knowledge only because of 测评', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '护肤品测评避坑' }, ledgers).ledgerId).not.toBe('knowledge')
    expect(classifyVideoContent({ title: '新能源车测评试驾' }, ledgers).ledgerId).not.toBe('knowledge')
    expect(classifyVideoContent({ title: '效率软件与数码工具测评' }, ledgers).ledgerId).toBe(
      'knowledge'
    )
  })

  it('marks reverse-rule conflicts as low confidence diagnostics', () => {
    const knowledgeOnly = createDefaultFavoriteLedgers().filter((ledger) =>
      ['knowledge', 'inbox'].includes(ledger.id)
    )
    const result = classifyVideoContent(
      { title: '效率软件数码工具护肤品测评教程入门' },
      knowledgeOnly
    )

    expect(result.diagnostic).toMatchObject({
      confidence: 'low',
      lowConfidence: true,
      negativeRules: expect.arrayContaining(['消费语境压低裸测评的知识解释'])
    })
  })

  it('does not reinterpret game entity plot videos as movie content when the game ledger is disabled', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'game' ? { ...ledger, enabled: false } : ledger
    )

    const result = classifyVideoContent({ title: '星铁剧情解析' }, ledgers)

    expect(result.ledgerId).toBe('inbox')
  })

  it('scores tags higher than title and page text when classification signals conflict', () => {
    const ledgers: FavoriteLedger[] = [
      {
        id: 'custom-title-topic',
        displayName: 'bilimi·Title Topic',
        keywords: ['title-tech'],
        enabled: true,
        priority: -20,
        isDefault: false
      },
      {
        id: 'custom-tag-topic',
        displayName: 'bilimi·Tag Topic',
        keywords: ['tag-food'],
        enabled: true,
        priority: -10,
        isDefault: false
      },
      ...createDefaultFavoriteLedgers()
    ]

    expect(
      classifyVideoContent(
        {
          title: 'title-tech',
          pageText: 'title-tech',
          tags: ['tag-food']
        },
        ledgers
      )
    ).toMatchObject({
      ledgerId: 'custom-tag-topic',
      matchedKeywords: ['tag-food']
    })
  })

  it('uses explicit Bilibili tags to classify visible defaults before enabled-title noise', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(
      classifyVideoContent(
        {
          title: '大阪地铁自动扶梯现场音乐',
          pageText: '演奏 音乐 现场',
          tags: ['旅游', '生活记录', 'Klook旅行体验师', '出国', '真实', 'Klook客服旅行']
        },
        ledgers
      )
    ).toMatchObject({
      ledgerId: 'music',
      displayName: 'bilimi·音乐舞台',
      reviewRequired: false,
      matchedKeywords: expect.arrayContaining(['演奏', '音乐', '音乐现场'])
    })
  })

  it('prioritizes enabled custom ledgers over default ledgers', () => {
    const ledgers: FavoriteLedger[] = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: -10,
        isDefault: false
      }
    ]

    expect(classifyVideoContent({ title: '摄影镜头构图教程' }, ledgers)).toMatchObject({
      ledgerId: 'custom-photo',
      displayName: 'bilimi·光影留真',
      matchedKeywords: ['摄影', '镜头'],
      reviewRequired: false
    })
    expect(classifyVideoContent({ title: '摄影 软件教程 工具 数码' }, ledgers)).toMatchObject({
      ledgerId: 'custom-photo',
      displayName: 'bilimi·光影留真',
      matchedKeywords: ['摄影'],
      reviewRequired: false
    })
  })

  it('prioritizes author follow-up ledgers by matching the video author', () => {
    const ledgers: FavoriteLedger[] = [
      {
        id: 'custom-keyword-photo',
        displayName: 'bilimi·摄影关键词',
        keywords: ['摄影'],
        enabled: true,
        priority: 10,
        isDefault: false
      },
      {
        id: 'custom-author-storm',
        displayName: 'bilimi·影视追更',
        keywords: ['影视飓风'],
        enabled: true,
        priority: 20,
        isDefault: false,
        ruleType: 'author'
      },
      ...createDefaultFavoriteLedgers()
    ]

    expect(
      classifyVideoContent(
        {
          title: '摄影器材横评',
          author: '影视飓风',
          tags: ['摄影']
        },
        ledgers
      )
    ).toMatchObject({
      ledgerId: 'custom-author-storm',
      displayName: 'bilimi·影视追更',
      matchedKeywords: ['影视飓风'],
      reviewRequired: false
    })
  })

  it('prioritizes tag ledgers by matching explicit Bilibili tags only', () => {
    const ledgers: FavoriteLedger[] = [
      {
        id: 'custom-keyword-genshin',
        displayName: 'bilimi·原神关键词',
        keywords: ['原神'],
        enabled: true,
        priority: 10,
        isDefault: false
      },
      {
        id: 'custom-tag-guide',
        displayName: 'bilimi·攻略合集',
        keywords: ['攻略'],
        enabled: true,
        priority: 20,
        isDefault: false,
        ruleType: 'tag'
      },
      ...createDefaultFavoriteLedgers()
    ]

    expect(
      classifyVideoContent(
        {
          title: '原神深渊配队',
          author: '游戏 UP',
          tags: ['攻略']
        },
        ledgers
      )
    ).toMatchObject({
      ledgerId: 'custom-tag-guide',
      matchedKeywords: ['攻略']
    })

    expect(
      classifyVideoContent(
        {
          title: '攻略作者聊原神',
          author: '攻略作者',
          tags: ['闲聊']
        },
        ledgers
      ).ledgerId
    ).not.toBe('custom-tag-guide')
  })

  it('uses a saved enabled unbound ledger for local preclassification', () => {
    const classification = classifyVideoContent({ title: '摄影教程' }, [
      { id: 'inbox', displayName: '暂存', keywords: [], enabled: true, priority: 0, isDefault: false },
      { id: 'unbound-photo', displayName: 'bilimi·光影', keywords: ['摄影'], enabled: true, priority: 1, isDefault: false, bindingState: 'unbound' }
    ])

    expect(classification.ledgerId).toBe('unbound-photo')
  })

  it('ignores DeepSeek-only constraints when scoring local ledger rules', () => {
    const ledgers: FavoriteLedger[] = [
      {
        id: 'custom-genshin-lore',
        displayName: 'bilimi·原神考据',
        keywords: [
          '原神',
          '【DeepSeek约束】',
          '抽卡',
          '直播切片',
          '不要收抽卡、整活、直播切片、纯二创剪辑。'
        ],
        enabled: true,
        priority: -20,
        isDefault: false
      },
      ...createDefaultFavoriteLedgers()
    ]

    expect(classifyVideoContent({ title: '抽卡直播切片合集' }, ledgers).ledgerId).not.toBe(
      'custom-genshin-lore'
    )
    expect(classifyVideoContent({ title: '原神世界观考据' }, ledgers)).toMatchObject({
      ledgerId: 'custom-genshin-lore',
      matchedKeywords: ['原神']
    })
  })

  it('keeps DeepSeek constraint ledgers out of local automatic classification', () => {
    const ledgers: FavoriteLedger[] = [
      {
        id: 'custom-deepseek-lore',
        displayName: 'bilimi·剧情考据',
        keywords: ['剧情解析'],
        ruleType: 'deepseek',
        enabled: true,
        priority: -20,
        isDefault: false
      },
      ...createDefaultFavoriteLedgers()
    ]

    expect(classifyVideoContent({ title: '剧情解析 世界观分析' }, ledgers).ledgerId).not.toBe(
      'custom-deepseek-lore'
    )
  })

  it('skips disabled ledgers and falls back to inbox when no category is clear', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, enabled: false } : ledger
    )

    expect(classifyVideoContent({ title: '效率软件工具' }, ledgers).ledgerId).toBe('inbox')
    expect(classifyVideoContent({ title: '今天随便看看' }, ledgers).ledgerId).toBe('inbox')
  })

  it('marks risk signals for review while using inbox as the destination', () => {
    const result = classifyVideoContent(
      { title: '带货软广避雷测评', pageText: '标题党和夸大宣传较多' },
      createDefaultFavoriteLedgers()
    )

    expect(result).toMatchObject({
      ledgerId: 'inbox',
      displayName: 'bilimi·暂存',
      reviewRequired: true
    })
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['带货', '软广', '避雷']))
  })

  it('extracts author candidates for comment generation context', () => {
    const script = buildVideoContentContextScript()

    expect(script).toContain('author:')
    expect(script).toContain('videoData.owner?.name')
    expect(script).toContain('.up-name')
  })

  it('extracts aid for pending queue entries', () => {
    const script = buildVideoContentContextScript()

    expect(script).toContain('aid:')
    expect(script).toContain('videoData.aid')
  })
})
