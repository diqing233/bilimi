import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import { buildVideoContentContextScript, classifyVideoContent } from './videoClassifier'

describe('classifyVideoContent', () => {
  it('classifies common Bilibili topics into the default ledger ids', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '三分钟讲清机器学习科普教程' }, ledgers).ledgerId).toBe('knowledge')
    expect(classifyVideoContent({ title: '爆笑整活鬼畜合集' }, ledgers).ledgerId).toBe('humor')
    expect(classifyVideoContent({ title: '第十二集剧情反转名场面' }, ledgers).ledgerId).toBe('story')
    expect(classifyVideoContent({ title: '电竞赛事操作技巧复盘' }, ledgers).ledgerId).toBe('play')
    expect(classifyVideoContent({ title: '周末探店美食 Vlog' }, ledgers).ledgerId).toBe('life')
    expect(classifyVideoContent({ title: '效率软件与数码工具测评' }, ledgers).ledgerId).toBe('craft')
    expect(classifyVideoContent({ title: '现场翻唱舞台演奏' }, ledgers).ledgerId).toBe('music')
  })

  it('classifies pure required topic signals missing from default ledger keywords', () => {
    const ledgers = createDefaultFavoriteLedgers()

    expect(classifyVideoContent({ title: '鬼畜合集' }, ledgers).ledgerId).toBe('humor')
    expect(classifyVideoContent({ title: '运动技巧' }, ledgers).ledgerId).toBe('play')
    expect(classifyVideoContent({ title: '探店 Vlog' }, ledgers).ledgerId).toBe('life')
    expect(classifyVideoContent({ title: '软件教程' }, ledgers).ledgerId).toBe('craft')
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
      ledger.id === 'craft' ? { ...ledger, enabled: false } : ledger
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
      displayName: 'Bilimi·暂存待阅',
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
