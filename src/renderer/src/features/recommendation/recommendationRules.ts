import type { RecommendationKind, RecommendationLabel } from '@shared/types'

const MAP: Partial<Record<RecommendationKind, RecommendationLabel>> = {
  kichiku: {
    badge: '可赏',
    summary: '适合归到鬼畜，偏娱乐向。'
  },
  knowledge: {
    badge: '可阅',
    summary: '适合归到知识，方便之后复看。'
  },
  'short-drama': {
    badge: '请陛下过目',
    summary: '适合归到小剧场，按剧情内容整理。'
  },
  game: {
    badge: '可赏',
    summary: '适合归到游戏，方便按玩法或攻略复看。'
  },
  food: {
    badge: '可藏',
    summary: '适合归到美食，探店和做饭内容放这里。'
  },
  'tech-digital': {
    badge: '可藏',
    summary: '适合归到科技数码，软件和工具内容放这里。'
  },
  music: {
    badge: '可赏',
    summary: '适合归到音乐，演奏、翻唱和现场内容放这里。'
  },
  inbox: {
    badge: '待分拣',
    summary: '暂时放到待分类，之后可以再细分。'
  }
}

const CUSTOM_LEDGER_LABEL: RecommendationLabel = {
  badge: '可藏',
  summary: '适合归到你自定义的收藏夹。'
}

export function describeRecommendation(kind: RecommendationKind): RecommendationLabel {
  return MAP[kind] ?? CUSTOM_LEDGER_LABEL
}
