import type { FavoriteLedger, FavoriteLedgerRuleType } from './types'

export const DEEPSEEK_CONSTRAINT_MARKER = '【DeepSeek约束】'

export type ParsedFavoriteLedgerRules = {
  localKeywords: string[]
  deepSeekConstraint?: string
}

function cleanParts(parts: string[]) {
  return parts.map((part) => part.trim()).filter(Boolean)
}

function ruleType(ledger: Pick<FavoriteLedger, 'ruleType'>): FavoriteLedgerRuleType {
  return ledger.ruleType ?? 'keyword'
}

export function parseFavoriteLedgerRules(
  ledger: Pick<FavoriteLedger, 'keywords' | 'ruleType'>
): ParsedFavoriteLedgerRules {
  const keywords = cleanParts(ledger.keywords)

  if (ruleType(ledger) === 'deepseek') {
    const deepSeekConstraint = keywords.join('\n').trim()
    return {
      localKeywords: [],
      deepSeekConstraint: deepSeekConstraint || undefined
    }
  }

  const markerIndex = keywords.findIndex((keyword) => keyword === DEEPSEEK_CONSTRAINT_MARKER)
  if (markerIndex < 0) {
    return { localKeywords: keywords }
  }

  const localKeywords = keywords.slice(0, markerIndex)
  const deepSeekConstraint = keywords.slice(markerIndex + 1).join('\n').trim()

  return {
    localKeywords,
    deepSeekConstraint: deepSeekConstraint || undefined
  }
}
