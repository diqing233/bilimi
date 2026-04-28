import { describe, expect, it } from 'vitest'
import { describeRecommendation } from './recommendationRules'

describe('describeRecommendation', () => {
  it('describes default and custom favorite ledgers', () => {
    expect(describeRecommendation('knowledge')).toEqual({
      badge: '可阅',
      summary: '此条可增广见闻，宜列案头。'
    })
    expect(describeRecommendation('inbox')).toEqual({
      badge: '待分拣',
      summary: '此条暂存待阅，容后再归册。'
    })
    expect(describeRecommendation('custom-photo')).toEqual({
      badge: '可藏',
      summary: '此条合入自定册目，可请掌库留档。'
    })
  })
})
