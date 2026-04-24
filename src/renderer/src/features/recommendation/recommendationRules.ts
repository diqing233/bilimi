import type { RecommendationKind, RecommendationLabel } from '@shared/types'

const MAP: Record<RecommendationKind, RecommendationLabel> = {
  funny: {
    badge: '可赏',
    summary: '此物颇能解闷，失仪而不鄙。'
  },
  knowledge: {
    badge: '可阅',
    summary: '此条可增广见闻，宜列案头。'
  },
  story: {
    badge: '请陛下过目',
    summary: '此段剧情渐起，不敢先泄其机。'
  },
  suspicious: {
    badge: '慎入',
    summary: '此条市气过浓，疑有商贩夹带。'
  }
}

export function describeRecommendation(kind: RecommendationKind): RecommendationLabel {
  return MAP[kind]
}
