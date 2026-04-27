import type { RecommendationKind } from '@shared/types'

export type VideoContentContext = {
  title?: string
  description?: string
  pageText?: string
  tags?: string[]
}

const KEYWORDS: Record<RecommendationKind, string[]> = {
  funny: ['搞笑', '爆笑', '整活', '鬼畜', '解压', '笑死', '快乐', '沙雕', '小品', '吐槽', '名梗'],
  knowledge: [
    '科普',
    '教程',
    '讲清',
    '原理',
    '学习',
    '入门',
    '知识',
    '解析',
    '解读',
    '历史',
    '课程',
    '干货',
    '纪录片',
    '方法'
  ],
  story: [
    '剧情',
    '剧集',
    '反转',
    '结局',
    '主线',
    '伏笔',
    '番剧',
    '电影',
    '影视',
    '小说',
    '名场面',
    '剪辑',
    '第'
  ],
  suspicious: [
    '带货',
    '广告',
    '软广',
    '恰饭',
    '推广',
    '避雷',
    '谨慎',
    '割韭菜',
    '骗局',
    '夸大',
    '引流',
    '直播间'
  ]
}

const FALLBACK_KIND: RecommendationKind = 'funny'
const TIE_BREAK_ORDER: RecommendationKind[] = ['suspicious', 'knowledge', 'story', 'funny']

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function buildSearchText(context: VideoContentContext) {
  return normalize(
    [context.title, context.description, context.pageText, ...(context.tags ?? [])]
      .filter(Boolean)
      .join(' ')
  )
}

function scoreKind(text: string, kind: RecommendationKind) {
  return KEYWORDS[kind].reduce((score, keyword) => {
    return text.includes(normalize(keyword)) ? score + 1 : score
  }, 0)
}

export function classifyVideoContent(context: VideoContentContext): RecommendationKind {
  const text = buildSearchText(context)

  if (!text) {
    return FALLBACK_KIND
  }

  const scores = TIE_BREAK_ORDER.map((kind) => ({
    kind,
    score: scoreKind(text, kind)
  }))

  const suspicious = scores.find((entry) => entry.kind === 'suspicious')
  if (suspicious && suspicious.score > 0) {
    return 'suspicious'
  }

  const best = scores.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return TIE_BREAK_ORDER.indexOf(left.kind) - TIE_BREAK_ORDER.indexOf(right.kind)
  })[0]

  return best && best.score > 0 ? best.kind : FALLBACK_KIND
}

export function buildVideoContentContextScript(): string {
  return `
    (() => {
      const readMeta = (name) =>
        document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.getAttribute('content') || '';

      const readText = (selectors) =>
        selectors
          .map((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join(' '))
          .filter(Boolean)
          .join(' ');

      const tags = Array.from(
        document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span')
      )
        .map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 20);

      return {
        title: document.querySelector('h1')?.textContent || document.title || '',
        description: readMeta('description') || readText(['.desc-info-text', '.video-desc', '[class*="desc"]']),
        pageText: readText(['h1', '.video-info-title', '.video-desc', '.desc-info-text', '.up-info', '.tag-panel']),
        tags
      };
    })();
  `
}
