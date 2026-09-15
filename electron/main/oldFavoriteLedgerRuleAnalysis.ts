import { normalizeClassificationText } from '../../src/shared/recommendation/classificationText'

const RULE_ANALYSIS_BATCH_SIZE = 128

export type OldFavoriteLedgerRuleAnalysisItem = {
  aid: number
  title?: string
  author?: string
  tags?: string[]
}

export type OldFavoriteLedgerRuleAnalysisSegment = {
  id: string
  items: OldFavoriteLedgerRuleAnalysisItem[]
}

export type OldFavoriteLedgerRuleAnalysisRule = {
  ruleType: 'keyword' | 'author' | 'tag'
  keywords: string[]
}

export type OldFavoriteLedgerRuleAnalysisOptions = {
  shouldCancel?: () => boolean
  onProgress?: (completed: number, total: number) => void
  yieldToEventLoop?: () => Promise<void>
}

function matchesRule(item: OldFavoriteLedgerRuleAnalysisItem, rule: OldFavoriteLedgerRuleAnalysisRule) {
  const keywords = rule.keywords.map(normalizeClassificationText).filter(Boolean)
  const fields = rule.ruleType === 'author'
    ? [item.author]
    : rule.ruleType === 'tag' ? item.tags ?? [] : [item.title, item.author, ...(item.tags ?? [])]
  const normalizedFields = fields.map((field) => normalizeClassificationText(field)).filter(Boolean)
  return keywords.some((keyword) => normalizedFields.some((field) => field.includes(keyword)))
}

export async function analyzeOldFavoriteLedgerRule(
  segments: readonly OldFavoriteLedgerRuleAnalysisSegment[],
  rule: OldFavoriteLedgerRuleAnalysisRule,
  options: OldFavoriteLedgerRuleAnalysisOptions = {}
) {
  const yieldToEventLoop = options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setImmediate(resolve)))
  const matchedAidsBySegment = new Map<string, Set<number>>()
  const total = segments.reduce((count, segment) => count + segment.items.length, 0)
  let processed = 0

  for (const segment of segments) {
    for (let start = 0; start < segment.items.length; start += RULE_ANALYSIS_BATCH_SIZE) {
      if (processed > 0) await yieldToEventLoop()
      if (options.shouldCancel?.()) throw new Error('Old favorite ledger rule analysis canceled.')
      const batch = segment.items.slice(start, start + RULE_ANALYSIS_BATCH_SIZE)
      const matched = batch.filter((item) => matchesRule(item, rule)).map((item) => item.aid)
      if (matched.length) {
        const segmentAids = matchedAidsBySegment.get(segment.id) ?? new Set<number>()
        for (const aid of matched) {
          if (Number.isSafeInteger(aid) && aid > 0) segmentAids.add(aid)
        }
        if (segmentAids.size) matchedAidsBySegment.set(segment.id, segmentAids)
      }
      processed += batch.length
      options.onProgress?.(processed, total)
    }
  }

  return Object.fromEntries([...matchedAidsBySegment].map(([segmentId, aids]) => [
    segmentId,
    [...aids].sort((left, right) => left - right)
  ]))
}
