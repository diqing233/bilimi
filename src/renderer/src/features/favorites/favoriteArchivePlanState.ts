import type { FavoriteLedger, FavoriteLedgerClassificationDiagnostic } from '@shared/types'

export type FavoriteArchivePlanChangeSource =
  | 'classifier'
  | 'user'
  | 'transfer'
  | 'deepseek'
  | 'rejudge'

export type FavoriteArchivePlanItemState = {
  itemKey: string
  aid: number
  title: string
  author?: string
  description?: string
  tags?: string[]
  category?: string
  sourceFolderTitle: string
  originalSuggestedLedgerIds: string[]
  currentTargetLedgerIds: string[]
  selectedTargetLedgerIds: string[]
  lowConfidence?: boolean
  classificationDiagnostic?: FavoriteLedgerClassificationDiagnostic
  userModified: boolean
  lastChangeSource: FavoriteArchivePlanChangeSource
}

export type FavoriteArchivePlanState = {
  items: FavoriteArchivePlanItemState[]
  originalItemsByAid: Record<number, FavoriteArchivePlanItemState>
  originalItemsByKey: Record<string, FavoriteArchivePlanItemState>
}

export type FavoriteArchiveTransactionState = {
  archivePlanState: FavoriteArchivePlanState
  selectedCandidateKeys: string[]
  draftLedgers: FavoriteLedger[]
  candidateSourceLedgerIdsByItemKey: Record<string, Record<string, string[]>>
}

export type FavoriteArchiveCandidateTransaction = {
  candidateKey: string
  candidateLedgerId: string
  candidateLedger: FavoriteLedger
  affectedItemKeys: string[]
  selected: boolean
}

export type FavoriteArchivePlanItemSelector =
  | number
  | { itemKey: string }
  | { aid: number; sourceFolderTitle?: string }

export type ExecutableArchivePlanItem = {
  aid: number
  title: string
  sourceFolderTitle: string
  targetLedgerId: string
  targetFolderId: string
}

type ArchivePlanItemInput = Omit<
  FavoriteArchivePlanItemState,
  'itemKey' | 'lastChangeSource' | 'userModified'
> &
  Partial<Pick<FavoriteArchivePlanItemState, 'itemKey' | 'lastChangeSource' | 'userModified'>>

function planItemKey(item: Pick<FavoriteArchivePlanItemState, 'aid' | 'sourceFolderTitle'>) {
  return `${item.sourceFolderTitle}::${item.aid}`
}

function cloneItem(item: FavoriteArchivePlanItemState): FavoriteArchivePlanItemState {
  return {
    ...item,
    originalSuggestedLedgerIds: [...item.originalSuggestedLedgerIds],
    currentTargetLedgerIds: [...item.currentTargetLedgerIds],
    selectedTargetLedgerIds: [...item.selectedTargetLedgerIds]
  }
}

function uniquePlanItemKey(
  item: ArchivePlanItemInput,
  itemKeyCounts: Map<string, number>
) {
  const baseKey = item.itemKey ?? planItemKey(item)
  const count = itemKeyCounts.get(baseKey) ?? 0
  itemKeyCounts.set(baseKey, count + 1)
  return count === 0 ? baseKey : `${baseKey}#${count + 1}`
}

function normalizeItem(
  item: ArchivePlanItemInput,
  itemKeyCounts: Map<string, number>
): FavoriteArchivePlanItemState {
  return {
    ...item,
    itemKey: uniquePlanItemKey(item, itemKeyCounts),
    originalSuggestedLedgerIds: [...item.originalSuggestedLedgerIds],
    currentTargetLedgerIds: [...item.currentTargetLedgerIds],
    selectedTargetLedgerIds: [...item.selectedTargetLedgerIds],
    userModified: item.userModified ?? false,
    lastChangeSource: item.lastChangeSource ?? 'classifier'
  }
}

export function createArchivePlanState(items: ArchivePlanItemInput[]): FavoriteArchivePlanState {
  const itemKeyCounts = new Map<string, number>()
  const normalizedItems = items.map((item) => normalizeItem(item, itemKeyCounts))
  const originalItemsByAid: Record<number, FavoriteArchivePlanItemState> = {}

  for (const item of normalizedItems) {
    originalItemsByAid[item.aid] ??= item
  }

  return {
    items: normalizedItems,
    originalItemsByAid,
    originalItemsByKey: Object.fromEntries(
      normalizedItems.map((item) => [item.itemKey, item])
    )
  }
}

function cloneOriginalsByAid(
  originalItemsByAid: FavoriteArchivePlanState['originalItemsByAid']
) {
  return Object.fromEntries(
    Object.entries(originalItemsByAid).map(([itemAid, item]) => [itemAid, cloneItem(item)])
  )
}

function cloneOriginalsByKey(
  originalItemsByKey: FavoriteArchivePlanState['originalItemsByKey']
) {
  return Object.fromEntries(
    Object.entries(originalItemsByKey).map(([itemKey, item]) => [itemKey, cloneItem(item)])
  )
}

function cloneOriginals(state: FavoriteArchivePlanState) {
  return {
    originalItemsByAid: cloneOriginalsByAid(state.originalItemsByAid),
    originalItemsByKey: cloneOriginalsByKey(state.originalItemsByKey)
  }
}

function resolveItemKey(state: FavoriteArchivePlanState, selector: FavoriteArchivePlanItemSelector) {
  if (typeof selector === 'number') {
    const matches = state.items.filter((item) => item.aid === selector)
    return matches.length === 1 ? matches[0].itemKey : undefined
  }

  if ('itemKey' in selector) {
    return selector.itemKey
  }

  const matches = state.items.filter(
    (item) =>
      item.aid === selector.aid &&
      (!selector.sourceFolderTitle || item.sourceFolderTitle === selector.sourceFolderTitle)
  )
  return matches.length === 1 ? matches[0].itemKey : undefined
}

export function applyArchivePlanSelection(
  state: FavoriteArchivePlanState,
  selector: FavoriteArchivePlanItemSelector,
  ledgerIds: string[],
  source: FavoriteArchivePlanChangeSource
): FavoriteArchivePlanState {
  const itemKey = resolveItemKey(state, selector)

  if (!itemKey) {
    return state
  }

  return {
    ...state,
    items: state.items.map((item) =>
      item.itemKey === itemKey
        ? {
            ...cloneItem(item),
            currentTargetLedgerIds: [...ledgerIds],
            selectedTargetLedgerIds: [...ledgerIds],
            userModified: source !== 'classifier',
            lastChangeSource: source
          }
        : cloneItem(item)
    ),
    ...cloneOriginals(state)
  }
}

export function moveArchivePlanItemToUnclassified(
  state: FavoriteArchivePlanState,
  selector: FavoriteArchivePlanItemSelector,
  source: FavoriteArchivePlanChangeSource
): FavoriteArchivePlanState {
  return applyArchivePlanSelection(state, selector, [], source)
}

export function revertArchivePlanItem(
  state: FavoriteArchivePlanState,
  selector: FavoriteArchivePlanItemSelector
): FavoriteArchivePlanState {
  const itemKey = resolveItemKey(state, selector)
  const originalItem = itemKey ? state.originalItemsByKey[itemKey] : undefined

  if (!originalItem) {
    return state
  }

  return {
    ...state,
    items: state.items.map((item) =>
      item.itemKey === originalItem.itemKey ? cloneItem(originalItem) : cloneItem(item)
    ),
    ...cloneOriginals(state)
  }
}

export function revertArchivePlanArea(
  state: FavoriteArchivePlanState,
  areaLedgerId: string | 'unclassified'
): FavoriteArchivePlanState {
  return state.items.reduce((nextState, item) => {
    const inArea =
      areaLedgerId === 'unclassified'
        ? item.currentTargetLedgerIds.length === 0
        : item.currentTargetLedgerIds.includes(areaLedgerId)

    return inArea ? revertArchivePlanItem(nextState, { itemKey: item.itemKey }) : nextState
  }, state)
}

function cloneLedger(ledger: FavoriteLedger): FavoriteLedger {
  return {
    ...ledger,
    keywords: [...ledger.keywords]
  }
}

export function applyArchiveCandidateTransaction(
  state: FavoriteArchiveTransactionState,
  transaction: FavoriteArchiveCandidateTransaction
): FavoriteArchiveTransactionState {
  const affectedItemKeys = new Set(transaction.affectedItemKeys)
  const sourcePositions = Object.fromEntries(
    Object.entries(state.candidateSourceLedgerIdsByItemKey).map(([itemKey, byCandidate]) => [
      itemKey,
      Object.fromEntries(
        Object.entries(byCandidate).map(([candidateKey, ledgerIds]) => [candidateKey, [...ledgerIds]])
      )
    ])
  )

  const nextItems = state.archivePlanState.items.map((item) => {
    if (!affectedItemKeys.has(item.itemKey)) {
      return cloneItem(item)
    }

    if (transaction.selected) {
      sourcePositions[item.itemKey] = {
        ...(sourcePositions[item.itemKey] ?? {}),
        [transaction.candidateKey]: item.currentTargetLedgerIds.filter((ledgerId) => ledgerId !== 'inbox')
      }
      const currentTargetLedgerIds = item.currentTargetLedgerIds.filter(
        (ledgerId) => ledgerId !== 'inbox' && ledgerId !== transaction.candidateLedgerId
      )
      const selectedTargetLedgerIds = item.selectedTargetLedgerIds.filter(
        (ledgerId) => ledgerId !== 'inbox' && ledgerId !== transaction.candidateLedgerId
      )
      return {
        ...cloneItem(item),
        currentTargetLedgerIds: [...currentTargetLedgerIds, transaction.candidateLedgerId],
        selectedTargetLedgerIds: [...selectedTargetLedgerIds, transaction.candidateLedgerId],
        userModified: true,
        lastChangeSource: 'user' as const
      }
    }

    const sourceLedgerIds = sourcePositions[item.itemKey]?.[transaction.candidateKey]
    if (!sourceLedgerIds) {
      return cloneItem(item)
    }
    delete sourcePositions[item.itemKey][transaction.candidateKey]
    if (Object.keys(sourcePositions[item.itemKey]).length === 0) {
      delete sourcePositions[item.itemKey]
    }
    const remainingCurrentTargetLedgerIds = item.currentTargetLedgerIds
      .filter((ledgerId) => ledgerId !== transaction.candidateLedgerId)
    const remainingSelectedTargetLedgerIds = item.selectedTargetLedgerIds
      .filter((ledgerId) => ledgerId !== transaction.candidateLedgerId)
    const originalItem = state.archivePlanState.originalItemsByKey[item.itemKey]
    return {
      ...cloneItem(item),
      currentTargetLedgerIds: remainingCurrentTargetLedgerIds.length > 0
        ? remainingCurrentTargetLedgerIds
        : [...(originalItem?.currentTargetLedgerIds ?? sourceLedgerIds)],
      selectedTargetLedgerIds: remainingSelectedTargetLedgerIds.length > 0
        ? remainingSelectedTargetLedgerIds
        : [...(originalItem?.selectedTargetLedgerIds ?? sourceLedgerIds)],
      userModified: true,
      lastChangeSource: 'user' as const
    }
  })

  const selectedCandidateKeys = new Set(state.selectedCandidateKeys)
  if (transaction.selected) {
    selectedCandidateKeys.add(transaction.candidateKey)
  } else {
    selectedCandidateKeys.delete(transaction.candidateKey)
  }

  const draftLedgers = transaction.selected
    ? state.draftLedgers.some((ledger) => ledger.id === transaction.candidateLedgerId)
      ? state.draftLedgers.map((ledger) =>
          ledger.id === transaction.candidateLedgerId
            ? { ...cloneLedger(ledger), enabled: true }
            : cloneLedger(ledger)
        )
      : [...state.draftLedgers.map(cloneLedger), cloneLedger(transaction.candidateLedger)]
    : state.draftLedgers
        .filter((ledger) => ledger.id !== transaction.candidateLedgerId)
        .map(cloneLedger)

  return {
    archivePlanState: {
      ...state.archivePlanState,
      items: nextItems,
      ...cloneOriginals(state.archivePlanState)
    },
    selectedCandidateKeys: [...selectedCandidateKeys],
    draftLedgers,
    candidateSourceLedgerIdsByItemKey: sourcePositions
  }
}

export function buildExecutableArchivePlan(
  state: FavoriteArchivePlanState,
  ledgers: FavoriteLedger[],
  options: { requireFolderId?: boolean } = {}
): ExecutableArchivePlanItem[] {
  const ledgersById = new Map(ledgers.map((ledger) => [ledger.id, ledger]))
  const planItems: ExecutableArchivePlanItem[] = []

  for (const item of state.items) {
    for (const ledgerId of item.selectedTargetLedgerIds) {
      if (ledgerId === 'inbox' || ledgerId === 'unclassified') {
        continue
      }

      const ledger = ledgersById.get(ledgerId)
      if (!ledger) {
        throw new Error(`无法解析归档目标：${ledgerId}`)
      }
      if (options.requireFolderId !== false && !ledger.bilibiliFolderId) {
        throw new Error(`归档目标尚未同步到 B 站：${ledger.displayName}`)
      }

      planItems.push({
        aid: item.aid,
        title: item.title,
        sourceFolderTitle: item.sourceFolderTitle,
        targetLedgerId: ledger.id,
        targetFolderId: ledger.bilibiliFolderId ?? ''
      })
    }
  }

  return planItems
}
