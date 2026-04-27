import { describe, expect, it } from 'vitest'
import { classifyVideoContent } from './videoClassifier'

describe('classifyVideoContent', () => {
  it('classifies knowledge videos from title and page copy', () => {
    expect(
      classifyVideoContent({
        title: '三分钟讲清机器学习科普教程',
        pageText: '从原理到入门路线，适合学习收藏。'
      })
    ).toBe('knowledge')
  })

  it('classifies story videos from episode and plot signals', () => {
    expect(
      classifyVideoContent({
        title: '第十二集剧情反转名场面',
        description: '主线伏笔终于回收，结局高能。'
      })
    ).toBe('story')
  })

  it('classifies funny videos from comedy signals', () => {
    expect(
      classifyVideoContent({
        title: '爆笑整活合集',
        tags: ['搞笑', '鬼畜']
      })
    ).toBe('funny')
  })

  it('prioritizes suspicious videos when ad or avoid-list signals appear', () => {
    expect(
      classifyVideoContent({
        title: '带货广告避雷测评',
        description: '这期疑似软广，评论区提醒谨慎。'
      })
    ).toBe('suspicious')
  })

  it('defaults to funny when no stable category signal is found', () => {
    expect(classifyVideoContent({ title: '今天也来看看这个视频' })).toBe('funny')
  })
})
