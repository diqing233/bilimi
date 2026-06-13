import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import type { FavoriteLedger, FavoriteLedgerClassification } from '@shared/types'

export type VideoContentContext = {
  title?: string
  description?: string
  pageText?: string
  tags?: string[]
}

const RISK_KEYWORDS = ['带货', '广告', '软广', '恰饭', '推广', '避雷', '割韭菜', '骗局', '夸大', '引流', '标题党']

const DEFAULT_LEDGER_KEYWORD_SUPPLEMENTS: Record<string, string[]> = {
  humor: ['鬼畜'],
  play: ['运动', '技巧'],
  life: ['探店', 'vlog'],
  craft: ['软件', '软件教程']
}

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

function matchedKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) => text.includes(normalize(keyword)))
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
  const enabledLedgers = ledgers
    .filter((ledger) => ledger.enabled)
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? 1 : -1
      }

      return left.priority - right.priority
    })
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

  const scored = enabledLedgers
    .filter((ledger) => ledger.id !== 'inbox')
    .map((ledger) => ({
      ledger,
      matches: matchedKeywords(text, ledgerKeywords(ledger))
    }))
    .filter((entry) => entry.matches.length > 0)
    .sort((left, right) => {
      if (left.ledger.isDefault !== right.ledger.isDefault) {
        return left.ledger.isDefault ? 1 : -1
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
