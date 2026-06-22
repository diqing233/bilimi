import { describe, expect, it } from 'vitest'
import { describeRecommendation } from './recommendationRules'

describe('describeRecommendation', () => {
  it('describes default and custom favorite ledgers', () => {
    expect(describeRecommendation('knowledge')).toEqual({
      badge: '可阅',
      summary: '适合归到知识，方便之后复看。'
    })
    expect(describeRecommendation('inbox')).toEqual({
      badge: '待分拣',
      summary: '暂时放到待分类，之后可以再细分。'
    })
    expect(describeRecommendation('custom-photo')).toEqual({
      badge: '可藏',
      summary: '适合归到你自定义的收藏夹。'
    })
  })
})
