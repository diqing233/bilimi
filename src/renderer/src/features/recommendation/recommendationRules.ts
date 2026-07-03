import type {
  FavoriteLedgerClassification,
  RecommendationKind,
  RecommendationLabel
} from '@shared/types'
import { stripBilimiLedgerPrefix } from '@shared/favoriteLedgers'

const MAP: Partial<Record<RecommendationKind, RecommendationLabel>> = {
  entertainment: {
    badge: '可赏',
    summary: '适合归到搞笑杂谈，整活、吐槽和轻松内容放这里。'
  },
  knowledge: {
    badge: '可阅',
    summary: '适合归到知识学习，教程、科普和科技数码内容放这里。'
  },
  game: {
    badge: '可赏',
    summary: '适合归到游戏专区，攻略、实况和赛事内容放这里。'
  },
  'movie-tv': {
    badge: '可藏',
    summary: '适合归到影视动漫，番剧、电影、剧集和动画内容放这里。'
  },
  'creative-aesthetic': {
    badge: '可藏',
    summary: '适合归到创意美学，绘画、摄影、穿搭和手作内容放这里。'
  },
  'life-interest': {
    badge: '可藏',
    summary: '适合归到生活日常，美食、健身、家居和生活技巧放这里。'
  },
  music: {
    badge: '可赏',
    summary: '适合归到音乐舞台，歌曲、演奏、翻唱和舞蹈内容放这里。'
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

export function describeVideoClassificationRecommendation(
  classification: FavoriteLedgerClassification
): RecommendationLabel {
  if (classification.ledgerId === 'inbox' && classification.suggestedDisplayName) {
    const suggestedName = stripBilimiLedgerPrefix(classification.suggestedDisplayName)

    return {
      badge: '待分拣',
      summary: `更适合归到${suggestedName}，但该册目尚未同步。`,
      hint: `标签更像${suggestedName}，先放到待分类，备册后再归档。`
    }
  }

  return describeRecommendation(classification.ledgerId)
}
