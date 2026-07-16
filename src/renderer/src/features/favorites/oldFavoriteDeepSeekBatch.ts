export type DeepSeekBatchScope =
  | 'current-segment'
  | 'all-unmatched'
  | 'all-review'
  | 'all-unmatched-and-review'

export type DeepSeekBatchItem = {
  itemKey: string
  aid: number
  segmentIndex: number
  classificationState: 'matched' | 'unmatched' | 'review'
  targetLedgerIds: string[]
  targetOrigin: 'automatic' | 'manual' | 'deepseek'
  executionState: 'pending' | 'running' | 'succeeded' | 'failed'
}

export type DeepSeekBatchTask = {
  scope: DeepSeekBatchScope
  itemKeys: string[]
  chunks: string[][]
  completedItemKeys: string[]
  completedCount: number
  nextItemOffset: number
  chunkSize: number
  status: 'running' | 'paused' | 'completed'
}

function isInScope(item: DeepSeekBatchItem, scope: DeepSeekBatchScope, currentSegmentIndex: number) {
  if (scope === 'current-segment') return item.segmentIndex === currentSegmentIndex
  if (scope === 'all-unmatched') return item.classificationState === 'unmatched'
  if (scope === 'all-review') return item.classificationState === 'review'
  return item.classificationState === 'unmatched' || item.classificationState === 'review'
}

function chunksOf(itemKeys: string[], chunkSize: number) {
  const chunks: string[][] = []
  for (let index = 0; index < itemKeys.length; index += chunkSize) {
    chunks.push(itemKeys.slice(index, index + chunkSize))
  }
  return chunks
}

export function buildDeepSeekBatchTask(
  items: DeepSeekBatchItem[],
  options: { scope: DeepSeekBatchScope; currentSegmentIndex: number; chunkSize: number }
): DeepSeekBatchTask {
  if (!Number.isInteger(options.chunkSize) || options.chunkSize < 1) {
    throw new Error('DeepSeek chunk size must be a positive integer')
  }

  const itemKeys = items
    .filter(
      (item) =>
        item.targetOrigin !== 'manual' &&
        item.executionState === 'pending' &&
        isInScope(item, options.scope, options.currentSegmentIndex)
    )
    .map((item) => item.itemKey)

  return {
    scope: options.scope,
    itemKeys,
    chunks: chunksOf(itemKeys, options.chunkSize),
    completedItemKeys: [],
    completedCount: 0,
    nextItemOffset: 0,
    chunkSize: options.chunkSize,
    status: itemKeys.length === 0 ? 'completed' : 'running'
  }
}

export function applyDeepSeekBatchChunk(
  task: DeepSeekBatchTask,
  appliedItemKeys: string[]
): DeepSeekBatchTask {
  if (task.status !== 'running') {
    throw new Error('DeepSeek batch task is not running')
  }

  const activeChunkIndex = Math.floor(task.nextItemOffset / task.chunkSize)
  const activeChunk = new Set(task.chunks[activeChunkIndex] ?? [])
  if (appliedItemKeys.some((itemKey) => !activeChunk.has(itemKey))) {
    throw new Error('DeepSeek result is not part of the active chunk')
  }

  const completedItemKeys = [...new Set([...task.completedItemKeys, ...appliedItemKeys])]
  const nextItemOffset = Math.min(task.itemKeys.length, task.nextItemOffset + activeChunk.size)
  return {
    ...task,
    completedItemKeys,
    completedCount: completedItemKeys.length,
    nextItemOffset,
    status: nextItemOffset >= task.itemKeys.length ? 'completed' : 'running'
  }
}

export function pauseDeepSeekBatchTask(task: DeepSeekBatchTask): DeepSeekBatchTask {
  return task.status === 'running' ? { ...task, status: 'paused' } : { ...task }
}

export function resumeDeepSeekBatchTask(task: DeepSeekBatchTask): DeepSeekBatchTask {
  return task.status === 'paused' ? { ...task, status: 'running' } : { ...task }
}

export function applyDeepSeekBatchTargets(
  items: DeepSeekBatchItem[],
  results: Array<{ itemKey: string; targetLedgerIds: string[] }>
) {
  const resultsByItemKey = new Map(results.map((result) => [result.itemKey, result]))
  let appliedCount = 0
  let protectedCount = 0

  const nextItems = items.map((item) => {
    const result = resultsByItemKey.get(item.itemKey)
    if (!result) return { ...item, targetLedgerIds: [...item.targetLedgerIds] }

    if (item.targetOrigin === 'manual' || item.executionState !== 'pending') {
      protectedCount += 1
      return { ...item, targetLedgerIds: [...item.targetLedgerIds] }
    }

    appliedCount += 1
    return {
      ...item,
      targetLedgerIds: [...new Set(result.targetLedgerIds)],
      targetOrigin: 'deepseek' as const
    }
  })

  return { items: nextItems, appliedCount, protectedCount }
}
