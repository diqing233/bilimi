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

export function planFavoriteArchiveTargets(args: {
  context: VideoContentContext
  ledgers: FavoriteLedger[]
  multiArchiveMode: FavoriteArchiveMultiMode
}): FavoriteArchiveTarget[] {
  const defaultLedger = chooseDefaultArchiveLedger(args.context, args.ledgers)
  const customMatches = args.ledgers
    .filter((ledger) => !ledger.isDefault && ledger.enabled)
    .map((ledger) => ({ ledger, ...scoreLedger(args.context, ledger) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      if (right.matchedKeywords.length !== left.matchedKeywords.length) {
        return right.matchedKeywords.length - left.matchedKeywords.length
      }
      return left.ledger.priority - right.ledger.priority
    })

  const maxTargets = maxTargetCount(args.multiArchiveMode)
  const targets: FavoriteArchiveTarget[] = []

  if (customMatches.length > 0) {
    const customLimit = args.multiArchiveMode === 'three' ? 2 : 1
    targets.push(...customMatches.slice(0, Math.min(customLimit, maxTargets)).map((entry) => toTarget(entry.ledger)))
  }

  if (defaultLedger && defaultLedger.id !== 'inbox' && targets.length < maxTargets) {
    targets.push(toTarget(defaultLedger))
  }

  if (targets.length === 0) {
    if (defaultLedger) {
      targets.push(toTarget(defaultLedger))
    }
  }

  return targets.slice(0, maxTargets)
}
