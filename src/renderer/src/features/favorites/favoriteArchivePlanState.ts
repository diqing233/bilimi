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
    originalItemsByAid[item.aid] ??= cloneItem(item)
  }

  return {
    items: normalizedItems.map(cloneItem),
    originalItemsByAid,
    originalItemsByKey: Object.fromEntries(
      normalizedItems.map((item) => [item.itemKey, cloneItem(item)])
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

export function buildExecutableArchivePlan(
  state: FavoriteArchivePlanState,
  ledgers: FavoriteLedger[]
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
        continue
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
