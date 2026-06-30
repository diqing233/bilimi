import type {
  FavoriteArchiveMultiMode,
  FavoriteLedger,
  FavoriteLedgerId
} from '@shared/types'
import { classifyVideoContent, type VideoContentContext } from './videoClassifier'

export type FavoriteArchiveTarget = {
  ledgerId: FavoriteLedgerId
  displayName: string
  folderId: string
  keywords: string[]
  isDefault: boolean
}

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function scoreLedger(context: VideoContentContext, ledger: FavoriteLedger) {
  const fields = [
    { text: normalize(context.title), weight: 2 },
    { text: normalize(context.author), weight: 1.5 },
    { text: normalize(context.description), weight: 1 },
    { text: normalize(context.pageText), weight: 0.5 },
    { text: normalize(context.category), weight: 2.5 },
    { text: normalize((context.tags ?? []).join(' ')), weight: 3 }
  ]
  let score = 0
  const matchedKeywords: string[] = []

  for (const keyword of ledger.keywords) {
    const normalizedKeyword = normalize(keyword)
    const keywordScore = fields.reduce(
      (total, field) => (field.text.includes(normalizedKeyword) ? total + field.weight : total),
      0
    )
    if (keywordScore > 0) {
      score += keywordScore
      matchedKeywords.push(keyword)
    }
  }

  return { matchedKeywords, score }
}

function toTarget(ledger: FavoriteLedger): FavoriteArchiveTarget {
  return {
    ledgerId: ledger.id,
    displayName: ledger.displayName,
    folderId: ledger.bilibiliFolderId ?? '',
    keywords: ledger.keywords,
    isDefault: ledger.isDefault
  }
}

function maxTargetCount(mode: FavoriteArchiveMultiMode) {
  if (mode === 'three') {
    return 3
  }
  if (mode === 'two') {
    return 2
  }
  return 1
}

function hasSignal(context: VideoContentContext, signals: string[]) {
  const text = normalize(
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
  return signals.some((signal) => text.includes(normalize(signal)))
}

function chooseDefaultArchiveLedger(context: VideoContentContext, ledgers: FavoriteLedger[]) {
  const defaultLedgers = ledgers.filter((ledger) => ledger.isDefault)

  if (hasSignal(context, ['genshin', '原神'])) {
    const gameLedger = defaultLedgers.find((ledger) => ledger.id === 'game')
    if (gameLedger?.enabled) {
      return gameLedger
    }
  }

  const defaultClassification = classifyVideoContent(context, defaultLedgers)
  return defaultLedgers.find((ledger) => ledger.id === defaultClassification.ledgerId)
}

function scoreDefaultArchiveLedger(context: VideoContentContext, ledger: FavoriteLedger) {
  const scored = scoreLedger(context, ledger)

  if (ledger.id === 'game' && hasSignal(context, ['genshin', '原神'])) {
    return {
      matchedKeywords: scored.matchedKeywords.includes('genshin')
        ? scored.matchedKeywords
        : ['genshin', ...scored.matchedKeywords],
      score: Math.max(scored.score, 100)
    }
  }

  return scored
}

function sortScoredLedgers(
  left: { ledger: FavoriteLedger; matchedKeywords: string[]; score: number },
  right: { ledger: FavoriteLedger; matchedKeywords: string[]; score: number }
) {
  if (right.score !== left.score) {
    return right.score - left.score
  }
  if (right.matchedKeywords.length !== left.matchedKeywords.length) {
    return right.matchedKeywords.length - left.matchedKeywords.length
  }
  return left.ledger.priority - right.ledger.priority
}

export function planFavoriteArchiveTargets(args: {
  context: VideoContentContext
  ledgers: FavoriteLedger[]
  multiArchiveMode: FavoriteArchiveMultiMode
}): FavoriteArchiveTarget[] {
  const fallbackDefaultLedger = chooseDefaultArchiveLedger(args.context, args.ledgers)
  const customMatches = args.ledgers
    .filter((ledger) => !ledger.isDefault && ledger.enabled)
    .map((ledger) => ({ ledger, ...scoreLedger(args.context, ledger) }))
    .filter((entry) => entry.score > 0)
    .sort(sortScoredLedgers)
  const defaultMatches = args.ledgers
    .filter((ledger) => ledger.isDefault && ledger.enabled && ledger.id !== 'inbox')
    .map((ledger) => ({ ledger, ...scoreDefaultArchiveLedger(args.context, ledger) }))
    .filter((entry) => entry.score > 0)
    .sort(sortScoredLedgers)

  const maxTargets = maxTargetCount(args.multiArchiveMode)
  const targets: FavoriteArchiveTarget[] = []

  if (customMatches.length > 0) {
    const customLimit = args.multiArchiveMode === 'three' ? 2 : maxTargets
    targets.push(...customMatches.slice(0, Math.min(customLimit, maxTargets)).map((entry) => toTarget(entry.ledger)))
  }

  if (targets.length < maxTargets) {
    const existingTargetIds = new Set(targets.map((target) => target.ledgerId))
    targets.push(
      ...defaultMatches
        .filter((entry) => !existingTargetIds.has(entry.ledger.id))
        .slice(0, maxTargets - targets.length)
        .map((entry) => toTarget(entry.ledger))
    )
  }

  if (targets.length === 0) {
    if (fallbackDefaultLedger) {
      targets.push(toTarget(fallbackDefaultLedger))
    }
  }

  return targets.slice(0, maxTargets)
}
