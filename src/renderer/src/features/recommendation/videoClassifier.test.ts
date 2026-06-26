import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
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
      ledgerId: 'inbox',
      reviewRequired: false,
      displayName: 'Bilimi·待分类'
    })
    expect(classifyVideoContent({ title: '露营装备清单', tags: [], category: '户外' }, ledgers)).toMatchObject({
      ledgerId: 'inbox',
      reviewRequired: false,
      displayName: 'Bilimi·待分类'
    })
  })

  it('scores tags higher than title and page text when classification signals conflict', () => {
    const ledgers = [
      {
        id: 'custom-title-topic',
        displayName: 'Bilimi·Title Topic',
        keywords: ['title-tech'],
        enabled: true,
        priority: -20,
        isDefault: false
      },
      {
        id: 'custom-tag-topic',
        displayName: 'Bilimi·Tag Topic',
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
      displayName: 'Bilimi·音乐舞台',
      reviewRequired: false,
      matchedKeywords: expect.arrayContaining(['演奏', '音乐', '音乐现场'])
    })
  })

  it('prioritizes enabled custom ledgers over default ledgers', () => {
    const ledgers = [
      ...createDefaultFavoriteLedgers(),
      {
        id: 'custom-photo',
        displayName: 'Bilimi·光影留真',
        keywords: ['摄影', '镜头'],
        enabled: true,
        priority: -10,
        isDefault: false
      }
    ]

    expect(classifyVideoContent({ title: '摄影镜头构图教程' }, ledgers)).toMatchObject({
      ledgerId: 'custom-photo',
      displayName: 'Bilimi·光影留真',
      matchedKeywords: ['摄影', '镜头'],
      reviewRequired: false
    })
    expect(classifyVideoContent({ title: '摄影 软件教程 工具 数码' }, ledgers)).toMatchObject({
      ledgerId: 'custom-photo',
      displayName: 'Bilimi·光影留真',
      matchedKeywords: ['摄影'],
      reviewRequired: false
    })
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
      displayName: 'Bilimi·待分类',
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
})
