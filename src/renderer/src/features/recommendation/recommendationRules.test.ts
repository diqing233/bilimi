import { describe, expect, it } from 'vitest'
import { describeRecommendation } from './recommendationRules'

describe('describeRecommendation', () => {
  it('marks funny content as 可赏', () => {
    expect(describeRecommendation('funny')).toEqual({
      badge: '可赏',
      summary: '此物颇能解闷，失仪而不鄙。'
    })
  })

  it('marks suspicious content as 慎入', () => {
    expect(describeRecommendation('suspicious')).toEqual({
      badge: '慎入',
      summary: '此条市气过浓，疑有商贩夹带。'
    })
  })
})
