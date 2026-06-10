import { describe, expect, it } from 'vitest'
import { collectNoteSources } from './noteSourceCollector'
import { createNoteSummary } from './noteSummarizer'
import { scoreNoteSourceBundle } from './sourceQualityScorer'

describe('createNoteSummary', () => {
  it('creates a complete summary from transcript material', () => {
    const bundle = collectNoteSources({
      title: '如何高效背单词',
      tags: ['学习', '英语'],
      transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法。最后用输出巩固记忆。'
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('complete')
    expect(summary.sourceNotice).toBe('据页面材料拟札')
    expect(summary.oneSentence).toContain('先建立语境')
    expect(summary.keyPoints).toHaveLength(3)
    expect(summary.tags).toEqual(['学习', '英语'])
  })

  it('marks partial source summaries as limited', () => {
    const bundle = collectNoteSources({
      title: '阅读习惯',
      description: '分享三个帮助保持阅读节奏的小方法。',
      tags: ['阅读']
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('limited')
    expect(summary.sourceNotice).toBe('材料有限，待补后再拟')
    expect(summary.openQuestions).toContain('现有材料不足，需补充字幕、文稿或观后记录后再确认细节。')
  })

  it('does not create a full summary from metadata only', () => {
    const bundle = collectNoteSources({
      title: '今日随看',
      url: 'https://www.bilibili.com/video/BV1sparse'
    })

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary).toEqual({
      status: 'needs_supplement',
      oneSentence: '材料不足，待补字幕、文稿或观后零札。',
      keyPoints: [],
      worthRevisiting: [],
      openQuestions: ['需要补充视频主体内容后才能生成可靠札记。'],
      tags: [],
      sourceNotice: '材料有限，待补后再拟'
    })
  })

  it('marks summaries from manual supplement text', () => {
    const bundle = collectNoteSources(
      { title: '数据库索引入门' },
      '视频主要讲 B+ 树索引、联合索引和回表成本。最后提醒不要滥建索引。'
    )

    const summary = createNoteSummary(bundle, scoreNoteSourceBundle(bundle))

    expect(summary.status).toBe('complete')
    expect(summary.sourceNotice).toBe('据补充材料拟札')
    expect(summary.keyPoints[0]).toContain('B+ 树索引')
  })
})
