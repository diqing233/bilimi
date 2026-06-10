import { describe, expect, it } from 'vitest'
import { collectNoteSources } from './noteSourceCollector'
import { scoreNoteSourceBundle } from './sourceQualityScorer'

describe('collectNoteSources and scoreNoteSourceBundle', () => {
  it('scores transcript material as sufficient', () => {
    const bundle = collectNoteSources({
      title: '如何高效背单词',
      uploaderName: '学习区掌柜',
      transcriptText: '先建立语境，再做间隔复习。随后用例句确认用法，最后用输出巩固记忆。',
      url: 'https://www.bilibili.com/video/BV1study'
    })

    expect(bundle.items.map((item) => item.type)).toContain('transcript')
    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'sufficient',
      reason: 'has_primary_text'
    })
  })

  it('scores title and url only as insufficient', () => {
    const bundle = collectNoteSources({
      title: '一个普通视频',
      url: 'https://www.bilibili.com/video/BV1sparse'
    })

    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'insufficient',
      reason: 'metadata_only'
    })
  })

  it('scores a short description as partial', () => {
    const bundle = collectNoteSources({
      title: '阅读习惯',
      description: '分享三个帮助保持阅读节奏的小方法。',
      tags: ['阅读', '习惯']
    })

    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'partial',
      reason: 'has_limited_description'
    })
  })

  it('keeps manual supplement separate from automatic material', () => {
    const bundle = collectNoteSources(
      {
        title: '数据库索引入门',
        url: 'https://www.bilibili.com/video/BV1db'
      },
      '补充材料：视频主要讲 B+ 树索引、联合索引和回表成本。'
    )

    expect(bundle.items).toEqual([
      { type: 'metadata', label: '标题', text: '数据库索引入门' },
      { type: 'url', label: '页面', text: 'https://www.bilibili.com/video/BV1db' },
      {
        type: 'manualSupplement',
        label: '补充材料',
        text: '补充材料：视频主要讲 B+ 树索引、联合索引和回表成本。'
      }
    ])
    expect(scoreNoteSourceBundle(bundle)).toEqual({
      quality: 'sufficient',
      reason: 'has_primary_text'
    })
  })
})
