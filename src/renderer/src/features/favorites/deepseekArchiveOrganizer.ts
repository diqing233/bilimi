import type {
  DeepSeekArchiveMode,
  DeepSeekArchiveVideoResult,
  DeepSeekGenerateRequest,
  FavoriteLedger
} from '@shared/types'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
import {
  applyArchivePlanSelection,
  type FavoriteArchivePlanItemState,
  type FavoriteArchivePlanState
} from './favoriteArchivePlanState'

type FavoriteArchiveOrganizeRequest = Extract<
  DeepSeekGenerateRequest,
  { kind: 'favorite-archive-organize' }
>

export type DeepSeekArchiveRunSnapshot = FavoriteArchivePlanState

export type DeepSeekArchiveApplyStats = {
  successCount: number
  failedCount: number
  truncatedCount: number
}

export type ApplyDeepSeekArchiveResultsArgs = {
  state: FavoriteArchivePlanState
  ledgers: FavoriteLedger[]
  enabledLedgerIds: string[]
  multiArchiveLimit: 1 | 2 | 3
  results: DeepSeekArchiveVideoResult[]
}

export type ApplyDeepSeekArchiveResultsResult = {
  state: FavoriteArchivePlanState
  stats: DeepSeekArchiveApplyStats
  messages: string[]
  redDisplacementMessages: string[]
}

function cloneItem(item: FavoriteArchivePlanItemState): FavoriteArchivePlanItemState {
  return {
    ...item,
    originalSuggestedLedgerIds: [...item.originalSuggestedLedgerIds],
    currentTargetLedgerIds: [...item.currentTargetLedgerIds],
    selectedTargetLedgerIds: [...item.selectedTargetLedgerIds]
  }
}

function cloneState(state: FavoriteArchivePlanState): FavoriteArchivePlanState {
  return {
    items: state.items.map(cloneItem),
    originalItemsByAid: Object.fromEntries(
      Object.entries(state.originalItemsByAid).map(([aid, item]) => [aid, cloneItem(item)])
    ),
    originalItemsByKey: Object.fromEntries(
      Object.entries(state.originalItemsByKey).map(([itemKey, item]) => [itemKey, cloneItem(item)])
    )
  }
}

function uniqueLedgerIds(ledgerIds: string[]): string[] {
  return Array.from(new Set(ledgerIds.map((ledgerId) => ledgerId.trim()).filter(Boolean)))
}

function isUnclassifiedTarget(ledgerId: string): boolean {
  const normalized = ledgerId.trim()
  return normalized === 'unclassified' || normalized === '未分类'
}

function findUniqueItemByAid(state: FavoriteArchivePlanState, aid: number) {
  const matches = state.items.filter((item) => item.aid === aid)
  return matches.length === 1 ? matches[0] : undefined
}

function findItemByAidAndSourceFolder(
  state: FavoriteArchivePlanState,
  aid: number,
  sourceFolderTitle: string
) {
  const matches = state.items.filter(
    (item) => item.aid === aid && item.sourceFolderTitle === sourceFolderTitle
  )
  return matches.length === 1 ? matches[0] : undefined
}

function findItemForResult(state: FavoriteArchivePlanState, result: DeepSeekArchiveVideoResult) {
  if (typeof result.aid !== 'number') {
    return undefined
  }

  if (result.sourceFolderTitle?.trim()) {
    return findItemByAidAndSourceFolder(state, result.aid, result.sourceFolderTitle.trim())
  }

  return findUniqueItemByAid(state, result.aid)
}

function ledgerName(ledgersById: Map<string, FavoriteLedger>, ledgerId: string): string {
  return ledgerId === 'unclassified' || ledgerId === '未分类'
    ? '未分类'
    : (ledgersById.get(ledgerId)?.displayName ?? ledgerId)
}

function formatTargets(ledgersById: Map<string, FavoriteLedger>, ledgerIds: string[]): string {
  return ledgerIds.length === 0
    ? '未分类'
    : ledgerIds.map((ledgerId) => ledgerName(ledgersById, ledgerId)).join(' + ')
}

function enabledLedgerSet(ledgers: FavoriteLedger[], enabledLedgerIds: string[]): Set<string> {
  const requestedEnabledIds = new Set(enabledLedgerIds)
  return new Set(
    ledgers
      .filter((ledger) => ledger.enabled && requestedEnabledIds.has(ledger.id))
      .map((ledger) => ledger.id)
  )
}

function isApplicableResult(
  result: DeepSeekArchiveVideoResult,
  currentState: FavoriteArchivePlanState
): result is DeepSeekArchiveVideoResult & { aid: number } {
  return !result.invalid && typeof result.aid === 'number' && Boolean(findItemForResult(currentState, result))
}

function selectTargets(args: {
  item: FavoriteArchivePlanItemState
  result: DeepSeekArchiveVideoResult
  validEnabledLedgerIds: Set<string>
}): { ok: true; targets: string[]; attemptedTargets: string[] } | { ok: false; message: string } {
  const rawTargets = uniqueLedgerIds(args.result.targetLedgerIds)

  if (rawTargets.length === 0 || rawTargets.some(isUnclassifiedTarget) || rawTargets.includes('inbox')) {
    return {
      ok: false,
      message: `DeepSeek 整理失败：不可用目标 ${rawTargets.length > 0 ? rawTargets.join(', ') : '空目标'}`
    }
  }

  const invalidTargets = rawTargets.filter((ledgerId) => !args.validEnabledLedgerIds.has(ledgerId))
  if (invalidTargets.length > 0) {
    return { ok: false, message: `DeepSeek 整理失败：不可用目标 ${invalidTargets.join(', ')}` }
  }

  const keptTargets = args.result.keepOriginal ? args.item.selectedTargetLedgerIds : []
  const attemptedTargets = uniqueLedgerIds([...keptTargets, ...rawTargets])
  return { ok: true, targets: attemptedTargets, attemptedTargets }
}

export function buildDeepSeekArchiveRequest(
  previewState: FavoriteArchivePlanState,
  ledgers: FavoriteLedger[],
  mode: DeepSeekArchiveMode,
  multiArchiveLimit: 1 | 2 | 3
): FavoriteArchiveOrganizeRequest {
  const videos = previewState.items
    .filter((item) => {
      if (mode === 'classified-only') {
        return item.currentTargetLedgerIds.length > 0
      }

      if (mode === 'unclassified-only') {
        return item.currentTargetLedgerIds.length === 0
      }

      if (mode === 'low-confidence-and-unclassified') {
        return item.lowConfidence || item.currentTargetLedgerIds.length === 0
      }

      return true
    })
    .map((item) => ({
      aid: item.aid,
      title: item.title,
      author: item.author,
      description: item.description,
      tags: item.tags,
      category: item.category,
      sourceFolderTitle: item.sourceFolderTitle,
      originalSuggestedLedgerIds: [...item.originalSuggestedLedgerIds],
      currentTargetLedgerIds: [...item.currentTargetLedgerIds],
      selectedTargetLedgerIds: [...item.selectedTargetLedgerIds],
      lowConfidence: item.lowConfidence,
      classificationDiagnostic: item.classificationDiagnostic
    }))

  return {
    kind: 'favorite-archive-organize',
    mode,
    videos,
    ledgers: ledgers
      .filter((ledger) => ledger.enabled && ledger.id !== 'inbox')
      .map((ledger) => {
        const parsedRules = parseFavoriteLedgerRules(ledger)
        return {
          id: ledger.id,
          displayName: ledger.displayName,
          keywords: parsedRules.localKeywords,
          deepSeekConstraint: parsedRules.deepSeekConstraint,
          ruleType: ledger.ruleType,
          enabled: ledger.enabled
        }
      }),
    multiArchiveLimit
  }
}

export function applyDeepSeekArchiveResults(
  args: ApplyDeepSeekArchiveResultsArgs
): ApplyDeepSeekArchiveResultsResult {
  let nextState = cloneState(args.state)
  const ledgersById = new Map(args.ledgers.map((ledger) => [ledger.id, ledger]))
  const validEnabledLedgerIds = enabledLedgerSet(args.ledgers, args.enabledLedgerIds)
  const stats: DeepSeekArchiveApplyStats = {
    successCount: 0,
    failedCount: 0,
    truncatedCount: 0
  }
  const messages: string[] = []
  const redDisplacementMessages: string[] = []

  for (const result of args.results) {
    if (!isApplicableResult(result, nextState)) {
      stats.failedCount += 1
      messages.push(
        `DeepSeek 整理失败：${result.aid ?? '未知视频'} ${result.errorMessage ?? '结果无效或视频不存在'}`
      )
      continue
    }

    const item = findItemForResult(nextState, result)
    if (!item) {
      stats.failedCount += 1
      messages.push(`DeepSeek 整理失败：${result.aid} 结果无效或视频不存在`)
      continue
    }

    const selected = selectTargets({ item, result, validEnabledLedgerIds })
    if (!selected.ok) {
      stats.failedCount += 1
      messages.push(selected.message)
      continue
    }

    const previousTargets = [...item.selectedTargetLedgerIds]
    let nextTargets = selected.targets

    if (selected.attemptedTargets.length > args.multiArchiveLimit) {
      stats.truncatedCount += 1
      nextTargets = selected.attemptedTargets.slice(0, args.multiArchiveLimit)
      const displacementMessage = `DeepSeek 整理：${formatTargets(
        ledgersById,
        selected.attemptedTargets
      )} 超过 ${args.multiArchiveLimit} 个目标，已保留 ${formatTargets(ledgersById, nextTargets)}`
      redDisplacementMessages.push(displacementMessage)
      messages.push(displacementMessage)
    }

    nextState = applyArchivePlanSelection(nextState, { itemKey: item.itemKey }, nextTargets, 'deepseek')
    stats.successCount += 1
    messages.push(
      `DeepSeek 整理：${formatTargets(ledgersById, previousTargets)} -> ${formatTargets(
        ledgersById,
        nextTargets
      )}${result.reason ? `：${result.reason}` : ''}`
    )
  }

  return {
    state: nextState,
    stats,
    messages,
    redDisplacementMessages
  }
}

export function createDeepSeekArchiveSnapshot(
  state: FavoriteArchivePlanState
): DeepSeekArchiveRunSnapshot {
  return cloneState(state)
}

export function revertDeepSeekArchiveRun(
  state: FavoriteArchivePlanState,
  snapshot: DeepSeekArchiveRunSnapshot
): FavoriteArchivePlanState {
  void state
  return cloneState(snapshot)
}
