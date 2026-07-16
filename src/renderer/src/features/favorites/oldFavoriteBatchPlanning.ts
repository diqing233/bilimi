export type BatchPlanningTargetOrigin = 'automatic' | 'manual' | 'deepseek'
export type BatchPlanningExecutionState = 'pending' | 'running' | 'succeeded' | 'failed'

export type BatchPlanningItem = {
  itemKey: string
  aid: number
  title: string
  author?: string
  description?: string
  category?: string
  tags: string[]
  sourceFolderTitle: string
  currentFormalLedgerIds: string[]
  lastConfirmedLedgerIds: string[]
  targetLedgerIds: string[]
  targetOrigin: BatchPlanningTargetOrigin
  executionState: BatchPlanningExecutionState
  classificationInputRevision?: number
}

export type ArchiveExecutionDiff = {
  addLedgerIds: string[]
  removeLedgerIds: string[]
  mode: 'replace' | 'append'
}

function uniqueFormalTargets(ledgerIds: string[]) {
  return Array.from(
    new Set(ledgerIds.filter((ledgerId) => ledgerId !== 'inbox' && ledgerId !== 'unclassified'))
  )
}

function reorganizationBaseline(item: BatchPlanningItem) {
  const currentFormalTargets = uniqueFormalTargets(item.currentFormalLedgerIds)
  return currentFormalTargets.length > 0
    ? currentFormalTargets
    : uniqueFormalTargets(item.lastConfirmedLedgerIds)
}

export function rebuildBatchArchivePlan(
  items: BatchPlanningItem[],
  classify: (item: BatchPlanningItem) => string[]
): BatchPlanningItem[] {
  return items.map((item) => {
    if (item.targetOrigin !== 'automatic' || item.executionState !== 'pending') {
      return { ...item, tags: [...item.tags], targetLedgerIds: [...item.targetLedgerIds] }
    }

    const classifiedTargets = uniqueFormalTargets(classify(item))
    const baselineTargets = reorganizationBaseline(item)
    return {
      ...item,
      tags: [...item.tags],
      targetLedgerIds: classifiedTargets.length > 0 ? classifiedTargets : baselineTargets,
      classificationInputRevision: (item.classificationInputRevision ?? 0) + 1
    }
  })
}

export function buildArchiveExecutionDiff(
  currentFormalLedgerIds: string[],
  expectedLedgerIds: string[]
): ArchiveExecutionDiff {
  const current = uniqueFormalTargets(currentFormalLedgerIds)
  const expected = uniqueFormalTargets(expectedLedgerIds)
  const currentSet = new Set(current)
  const expectedSet = new Set(expected)
  const mode = expected.length <= 1 ? 'replace' : 'append'

  return {
    addLedgerIds: expected.filter((ledgerId) => !currentSet.has(ledgerId)),
    removeLedgerIds:
      mode === 'replace' ? current.filter((ledgerId) => !expectedSet.has(ledgerId)) : [],
    mode
  }
}

export function deriveVisibleArchiveGroups(items: BatchPlanningItem[]) {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const ledgerId of uniqueFormalTargets(item.targetLedgerIds)) {
      counts.set(ledgerId, (counts.get(ledgerId) ?? 0) + 1)
    }
  }

  return [...counts].map(([ledgerId, itemCount]) => ({ ledgerId, itemCount }))
}
