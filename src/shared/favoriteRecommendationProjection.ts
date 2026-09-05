import type { OldFavoriteWorkspaceRecommendationCandidate } from './oldFavoriteWorkspace'
import type { FavoriteLedger } from './types'

export type FavoriteRecommendationLink =
  | { status: 'unlinked' }
  | { status: 'linked'; ledgerId: string }
  | { status: 'ambiguous'; ledgerIds: string[] }

function normalizedText(value: string) {
  return value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('zh-Hans-CN')
}

function normalizedKeywords(values: readonly string[]) {
  return [...new Set(values.map(normalizedText).filter(Boolean))].sort()
}

function candidateRuleType(candidate: OldFavoriteWorkspaceRecommendationCandidate) {
  return candidate.kind === 'author' ? 'author' as const : 'tag' as const
}

export function recommendationMatchesFavoriteLedger(
  candidate: OldFavoriteWorkspaceRecommendationCandidate,
  ledger: FavoriteLedger
) {
  return normalizedText(candidate.displayName) === normalizedText(ledger.displayName) &&
    candidateRuleType(candidate) === ledger.ruleType &&
    JSON.stringify(normalizedKeywords(candidate.keywords ?? [])) === JSON.stringify(normalizedKeywords(ledger.keywords))
}

export function buildFavoriteRecommendationLinks(
  candidates: readonly OldFavoriteWorkspaceRecommendationCandidate[],
  ledgers: readonly FavoriteLedger[]
): Record<string, FavoriteRecommendationLink> {
  return Object.fromEntries(candidates.map((candidate) => {
    const ledgerIds = ledgers
      .filter((ledger) => recommendationMatchesFavoriteLedger(candidate, ledger))
      .map((ledger) => ledger.id)
      .sort()
    const link: FavoriteRecommendationLink = ledgerIds.length === 0
      ? { status: 'unlinked' }
      : ledgerIds.length === 1
        ? { status: 'linked', ledgerId: ledgerIds[0]! }
        : { status: 'ambiguous', ledgerIds }
    return [candidate.id, link]
  }))
}
