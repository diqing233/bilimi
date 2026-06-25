import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { FavoriteLedger, FavoriteLedgerClassification } from '@shared/types'

export type VideoContentContext = {
  title?: string
  author?: string
  description?: string
  pageText?: string
  tags?: string[]
  category?: string
}

const RISK_KEYWORDS = ['带货', '广告', '软广', '恰饭', '推广', '避雷', '割韭菜', '骗局', '夸大', '引流', '标题党']

const DEFAULT_LEDGER_KEYWORD_SUPPLEMENTS: Record<string, string[]> = {
  kichiku: ['鬼畜'],
  sports: ['运动'],
  food: ['探店'],
  vlog: ['vlog'],
  'tech-digital': ['软件教程', '工具', '效率']
}

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

const FIELD_WEIGHTS = {
  title: 2,
  author: 1.5,
  description: 1,
  pageText: 0.5,
  category: 2.5,
  tags: 3
} as const

function buildSearchText(context: VideoContentContext) {
  return normalize(
    [
      context.title,
      context.author,
      context.description,
      context.pageText,
      context.category,
      ...(context.tags ?? [])
    ]
      .filter(Boolean)
      .join(' ')
  )
}

function matchedKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(normalize(keyword)))
}

function scoreKeywordFields(
  keywords: string[],
  fieldTexts: Array<{ text: string; weight: number }>
) {
  const matches: string[] = []
  let score = 0

  for (const keyword of keywords) {
    const normalizedKeyword = normalize(keyword)
    const keywordScore = fieldTexts.reduce(
      (total, field) => (field.text.includes(normalizedKeyword) ? total + field.weight : total),
      0
    )

    if (keywordScore > 0) {
      matches.push(keyword)
      score += keywordScore
    }
  }

  return { matches, score }
}

function scoreKeywords(context: VideoContentContext, keywords: string[]) {
  return scoreKeywordFields(keywords, [
    { text: normalize(context.title), weight: FIELD_WEIGHTS.title },
    { text: normalize(context.author), weight: FIELD_WEIGHTS.author },
    { text: normalize(context.description), weight: FIELD_WEIGHTS.description },
    { text: normalize(context.pageText), weight: FIELD_WEIGHTS.pageText },
    { text: normalize(context.category), weight: FIELD_WEIGHTS.category },
    { text: normalize((context.tags ?? []).join(' ')), weight: FIELD_WEIGHTS.tags }
  ])
}

function scoreExplicitContextKeywords(context: VideoContentContext, keywords: string[]) {
  return scoreKeywordFields(keywords, [
    { text: normalize(context.category), weight: FIELD_WEIGHTS.category },
    { text: normalize((context.tags ?? []).join(' ')), weight: FIELD_WEIGHTS.tags }
  ])
}

function ledgerKeywords(ledger: FavoriteLedger) {
  return [...ledger.keywords, ...(DEFAULT_LEDGER_KEYWORD_SUPPLEMENTS[ledger.id] ?? [])]
}

function inboxLedger(ledgers: FavoriteLedger[]) {
  return (
    ledgers.find((ledger) => ledger.id === 'inbox') ??
    createDefaultFavoriteLedgers().find((ledger) => ledger.id === 'inbox')!
  )
}

export function classifyVideoContent(
  context: VideoContentContext,
  ledgers: FavoriteLedger[] = createDefaultFavoriteLedgers()
): FavoriteLedgerClassification {
  const text = buildSearchText(context)
  const inbox = inboxLedger(ledgers)
  const riskMatches = matchedKeywords(text, RISK_KEYWORDS)

  if (!text) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false
    }
  }

  if (riskMatches.length > 0) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: riskMatches,
      reviewRequired: true
    }
  }

  const scored = ledgers
    .filter((ledger) => ledger.id !== 'inbox')
    .map((ledger) => {
      const keywords = ledgerKeywords(ledger)
      return {
        ledger,
        explicitScore: scoreExplicitContextKeywords(context, keywords).score,
        ...scoreKeywords(context, keywords)
      }
    })
    .filter(
      (entry) =>
        entry.matches.length > 0 &&
        (entry.ledger.enabled || (entry.ledger.isDefault && entry.explicitScore > 0))
    )
    .sort((left, right) => {
      if (left.ledger.isDefault !== right.ledger.isDefault) {
        return left.ledger.isDefault ? 1 : -1
      }

      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (right.matches.length !== left.matches.length) {
        return right.matches.length - left.matches.length
      }

      return left.ledger.priority - right.ledger.priority
    })

  const best = scored[0]

  if (!best) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: [],
      reviewRequired: false
    }
  }

  if (best.ledger.isDefault && !best.ledger.enabled) {
    return {
      ledgerId: inbox.id,
      displayName: inbox.displayName,
      matchedKeywords: best.matches,
      reviewRequired: true,
      suggestedLedgerId: best.ledger.id,
      suggestedDisplayName: best.ledger.displayName
    }
  }

  return {
    ledgerId: best.ledger.id,
    displayName: best.ledger.displayName,
    matchedKeywords: best.matches,
    reviewRequired: false
  }
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
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};

      const tags = Array.from(
        document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span')
      )
        .map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 20);

      return {
        title: document.querySelector('h1')?.textContent || document.title || '',
        author: document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || '',
        description: readMeta('description') || readText(['.desc-info-text', '.video-desc', '[class*="desc"]']),
        pageText: readText(['h1', '.video-info-title', '.video-desc', '.desc-info-text', '.up-info', '.tag-panel']),
        tags
      };
    })();
  `
}
