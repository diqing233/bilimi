import type { RecommendationKind, RecommendationLabel } from '@shared/types'

const MAP: Partial<Record<RecommendationKind, RecommendationLabel>> = {
  humor: {
    badge: '可赏',
    summary: '此条颇能解闷，失仪而不醇。'
  },
  knowledge: {
    badge: '可阅',
    summary: '此条可增广见闻，宜列案头。'
  },
  story: {
    badge: '请陛下过目',
    summary: '此段剧情渐起，不敢先泄其机。'
  },
  play: {
    badge: '可赏',
    summary: '此条游艺有法，可供闲时观摩。'
  },
  life: {
    badge: '可藏',
    summary: '此条烟火有味，可入日用清册。'
  },
  craft: {
    badge: '可藏',
    summary: '此条器用有方，宜留作工巧参照。'
  },
  music: {
    badge: '可赏',
    summary: '此条声律可听，宜置清音小册。'
  },
  inbox: {
    badge: '待分拣',
    summary: '此条暂存待阅，容后再归册。'
  }
}

const CUSTOM_LEDGER_LABEL: RecommendationLabel = {
  badge: '可藏',
  summary: '此条合入自定册目，可请掌库留档。'
}

export function describeRecommendation(kind: RecommendationKind): RecommendationLabel {
  return MAP[kind] ?? CUSTOM_LEDGER_LABEL
}
