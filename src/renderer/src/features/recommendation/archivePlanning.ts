import type {
  FavoriteArchiveMultiMode,
  FavoriteArchiveStrategy,
  FavoriteLedger,
  FavoriteLedgerClassification,
  FavoriteLedgerClassificationDiagnostic,
  FavoriteLedgerId
} from '@shared/types'
import {
  classifyVideoContent,
  classifyVideoContentCandidates,
  type VideoContentContext
} from './videoClassifier'

export type FavoriteArchiveTarget = {
  ledgerId: FavoriteLedgerId
  displayName: string
  folderId: string
  keywords: string[]
  ruleType?: FavoriteLedger['ruleType']
  isDefault: boolean
  diagnostic?: FavoriteLedgerClassificationDiagnostic
  selectedByStrategy: boolean
}

function shouldSelectByStrategy(
  classification: FavoriteLedgerClassification,
  strategy: FavoriteArchiveStrategy
) {
  if (classification.ledgerId === 'inbox' || classification.reviewRequired) {
    return false
  }

  if (strategy === 'aggressive') {
    return true
  }

  const diagnostic = classification.diagnostic
  if (!diagnostic) {
    return strategy === 'balanced'
  }

  if (strategy === 'conservative') {
    return diagnostic.confidence === 'high' && !diagnostic.lowConfidence
  }

  return (
    !diagnostic.lowConfidence &&
    (diagnostic.strongSignals.length > 0 ||
      diagnostic.entityAliases.length > 0 ||
      diagnostic.conceptClusters.length > 0 ||
      diagnostic.scoreGap >= 2.5)
  )
}

function toTarget(
  ledger: FavoriteLedger,
  options: {
    diagnostic?: FavoriteLedgerClassificationDiagnostic
    selectedByStrategy?: boolean
  } = {}
): FavoriteArchiveTarget {
  return {
    ledgerId: ledger.id,
    displayName: ledger.displayName,
    folderId: ledger.bilibiliFolderId ?? '',
    keywords: ledger.keywords,
    ruleType: ledger.ruleType,
    isDefault: ledger.isDefault,
    diagnostic: options.diagnostic,
    selectedByStrategy: options.selectedByStrategy ?? true
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

type ScoredArchiveLedger = {
  ledger: FavoriteLedger
  classification: FavoriteLedgerClassification
  matchedKeywords: string[]
  score: number
}

function classifyArchiveCandidate(
  classifications: FavoriteLedgerClassification[],
  ledger: FavoriteLedger
): ScoredArchiveLedger {
  const classification =
    classifications.find((candidate) => {
      return candidate.ledgerId === ledger.id || candidate.suggestedLedgerId === ledger.id
    }) ??
    ({
      ledgerId: 'inbox',
      displayName: '',
      matchedKeywords: [],
      reviewRequired: false
    } satisfies FavoriteLedgerClassification)

  return {
    ledger,
    classification,
    matchedKeywords: classification.matchedKeywords,
    score: classification.diagnostic?.score ?? 0
  }
}

function sortScoredLedgers(
  left: { ledger: FavoriteLedger; matchedKeywords: string[]; score: number },
  right: { ledger: FavoriteLedger; matchedKeywords: string[]; score: number }
) {
  const leftRuleType = left.ledger.ruleType ?? 'keyword'
  const rightRuleType = right.ledger.ruleType ?? 'keyword'
  if (leftRuleType !== rightRuleType) {
    return leftRuleType === 'keyword' ? 1 : -1
  }

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
  archiveStrategy?: FavoriteArchiveStrategy
}): FavoriteArchiveTarget[] {
  const archiveStrategy = args.archiveStrategy ?? 'aggressive'
  const defaultClassification = classifyVideoContent(args.context, args.ledgers)
  const defaultSelectedByStrategy = shouldSelectByStrategy(defaultClassification, archiveStrategy)
  const candidateClassifications = classifyVideoContentCandidates(args.context, args.ledgers)
  const fallbackDefaultLedger =
    args.ledgers.find((ledger) => ledger.id === defaultClassification.ledgerId) ?? null
  const customMatches = args.ledgers
    .filter((ledger) => !ledger.isDefault && ledger.enabled)
    .map((ledger) => classifyArchiveCandidate(candidateClassifications, ledger))
    .filter((entry) => entry.classification.ledgerId === entry.ledger.id && entry.score > 0)
    .sort(sortScoredLedgers)
  const defaultMatches = args.ledgers
    .filter((ledger) => ledger.isDefault && ledger.enabled && ledger.id !== 'inbox')
    .map((ledger) => classifyArchiveCandidate(candidateClassifications, ledger))
    .filter((entry) => entry.classification.ledgerId === entry.ledger.id && entry.score > 0)
    .sort(sortScoredLedgers)

  const maxTargets = maxTargetCount(args.multiArchiveMode)
  const targets: FavoriteArchiveTarget[] = []

  if (customMatches.length > 0) {
    const customLimit = args.multiArchiveMode === 'three' ? 2 : maxTargets
    targets.push(
      ...customMatches
        .slice(0, Math.min(customLimit, maxTargets))
        .map((entry) =>
          toTarget(entry.ledger, {
            diagnostic: entry.classification.diagnostic,
            selectedByStrategy: shouldSelectByStrategy(entry.classification, archiveStrategy)
          })
        )
    )
  }

  if (targets.length < maxTargets) {
    const existingTargetIds = new Set(targets.map((target) => target.ledgerId))
    targets.push(
      ...defaultMatches
        .filter((entry) => !existingTargetIds.has(entry.ledger.id))
        .slice(0, maxTargets - targets.length)
        .map((entry) =>
          toTarget(entry.ledger, {
            diagnostic: entry.classification.diagnostic,
            selectedByStrategy: shouldSelectByStrategy(entry.classification, archiveStrategy)
          })
        )
    )
  }

  if (targets.length === 0) {
    if (fallbackDefaultLedger) {
      targets.push(
        toTarget(fallbackDefaultLedger, {
          diagnostic:
            fallbackDefaultLedger.id === defaultClassification.ledgerId
              ? defaultClassification.diagnostic
              : undefined,
          selectedByStrategy: defaultSelectedByStrategy
        })
      )
    }
  }

  return targets.slice(0, maxTargets)
}
