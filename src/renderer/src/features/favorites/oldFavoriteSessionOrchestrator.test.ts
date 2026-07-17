import { describe, expect, it, vi } from 'vitest'
import {
  createOldFavoriteBatch,
  type OldFavoriteSessionsState,
  type OldFavoriteTaskKind
} from '../../../../shared/oldFavoriteSessions'
import {
  OldFavoriteSessionOrchestrator,
  type OldFavoriteSessionCoordinator
} from './oldFavoriteSessionOrchestrator'

function createHarness(initial: OldFavoriteSessionsState = { version: 1, batches: [], lease: null }) {
  let state = structuredClone(initial)
  const coordinator: OldFavoriteSessionCoordinator = {
    load: vi.fn(async () => structuredClone(state)),
    save: vi.fn(async (next) => {
      state = structuredClone(next)
      return structuredClone(state)
    }),
    acquire: vi.fn(async (batchId, segmentId, task, accountMid) => {
      const batch = state.batches.find((candidate) => candidate.id === batchId)
      if (
        state.lease ||
        !batch ||
        batch.status !== 'active' ||
        batch.accountMid !== accountMid ||
        !batch.segments.some((segment) => segment.id === segmentId)
      ) {
        return false
      }
      state.lease = { batchId, segmentId, task }
      return true
    }),
    release: vi.fn(async (batchId, segmentId) => {
      const lease = state.lease
      if (!lease || lease.batchId !== batchId || lease.segmentId !== segmentId) return false
      state.lease = null
      return true
    })
  }

  return { coordinator, getState: () => structuredClone(state) }
}

describe('OldFavoriteSessionOrchestrator', () => {
  it('continues the newest active full batch instead of creating a duplicate', async () => {
    const older = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: '2026-07-17T10:00:00Z', id: 'older' })
    const newer = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [2], now: '2026-07-17T10:00:11Z', id: 'newer' })
    const harness = createHarness({ version: 1, batches: [older, newer], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    const result = await orchestrator.beginScan({ accountMid: '42', kind: 'full', now: '2026-07-17T10:01:00Z' })

    expect(result.batch.id).toBe('newer')
    expect(result.acquired).toBe(false)
    expect(harness.coordinator.acquire).not.toHaveBeenCalled()
    expect(harness.getState().batches.map((batch) => batch.id)).toEqual(['older', 'newer'])
  })
  it('tracks each online request and records an unknown result before releasing on rejection', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [11, 12], now: '2026-07-16T08:00:00Z'
    })
    const harness = createHarness({ version: 1, batches: [batch], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await expect(orchestrator.runTrackedRequest({
      batchId: batch.id,
      segmentId: batch.segments[0].id,
      task: 'execute',
      accountMid: '42',
      currentAid: 12,
      checkpoint: { cursor: 1, frozenExecutionAids: [11, 12] },
      snapshot: { currentStep: 'execution', execution: { completed: 1 } },
      work: async () => { throw new Error('connection lost') }
    })).rejects.toThrow('connection lost')

    expect(harness.getState().lease).toBeNull()
    expect(harness.getState().batches[0].segments[0]).toMatchObject({
      status: 'paused',
      task: {
        kind: 'execute', status: 'paused', requestState: 'result-unknown', currentAid: 12
      },
      checkpoint: { cursor: 1, frozenExecutionAids: [11, 12] }
    })
  })

  it('marks a tracked request idle and releases after an explicit result', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [11], now: '2026-07-16T08:00:00Z'
    })
    const harness = createHarness({ version: 1, batches: [batch], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await expect(orchestrator.runTrackedRequest({
      batchId: batch.id,
      segmentId: batch.segments[0].id,
      task: 'tag',
      accountMid: '42',
      currentAid: 11,
      work: async () => 'done'
    })).resolves.toBe('done')

    expect(harness.getState().lease).toBeNull()
    expect(harness.getState().batches[0].segments[0]).toMatchObject({
      status: 'ready',
      task: { kind: 'tag', status: 'paused', requestState: 'idle', currentAid: 11 }
    })
  })

  it('persists a placeholder segment and claims scan before online work starts', async () => {
    const harness = createHarness()
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    const result = await orchestrator.beginScan({
      accountMid: ' 42 ',
      kind: 'full',
      now: '2026-07-16T08:00:00Z',
      snapshot: { currentStep: 'scan', selection: { folders: ['source'] } }
    })

    expect(result.acquired).toBe(true)
    expect(result.batch.segments).toEqual([
      expect.objectContaining({
        id: `${result.batch.id}:segment:1`,
        index: 0,
        aids: [],
        status: 'running',
        task: { kind: 'scan', status: 'running', requestState: 'idle' }
      })
    ])
    expect(harness.coordinator.save).toHaveBeenCalledBefore(
      vi.mocked(harness.coordinator.acquire)
    )
    expect(harness.getState().lease).toMatchObject({ task: 'scan' })
  })

  it.each<OldFavoriteTaskKind>(['scan', 'tag', 'deepseek', 'execute', 'reconcile'])(
    'atomically claims and always releases a %s lease around work',
    async (task) => {
      const batch = createOldFavoriteBatch({
        accountMid: '42',
        kind: 'full',
        aids: [1],
        now: '2026-07-16T08:00:00Z'
      })
      const harness = createHarness({ version: 1, batches: [batch], lease: null })
      const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
      const work = vi.fn(async () => {
        expect(harness.getState().lease).toMatchObject({ task })
        if (task === 'execute') throw new Error('stop')
        return task
      })

      if (task === 'execute') {
        await expect(
          orchestrator.runWithLease(batch.id, batch.segments[0].id, task, '42', work)
        ).rejects.toThrow('stop')
      } else {
        await expect(
          orchestrator.runWithLease(batch.id, batch.segments[0].id, task, '42', work)
        ).resolves.toBe(task)
      }

      expect(harness.coordinator.acquire).toHaveBeenCalledWith(
        batch.id,
        batch.segments[0].id,
        task,
        '42'
      )
      expect(harness.coordinator.release).toHaveBeenCalledWith(batch.id, batch.segments[0].id)
      expect(harness.getState().lease).toBeNull()
    }
  )

  it('rejects work when the atomic lease claim loses the race', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [1],
      now: '2026-07-16T08:00:00Z'
    })
    const harness = createHarness({
      version: 1,
      batches: [batch],
      lease: { batchId: 'other', segmentId: 'other:segment:1', task: 'tag' }
    })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
    const work = vi.fn()

    await expect(
      orchestrator.runWithLease(batch.id, batch.segments[0].id, 'scan', '42', work)
    ).rejects.toThrow('Old favorite task lease is unavailable.')
    expect(work).not.toHaveBeenCalled()
    expect(harness.coordinator.release).not.toHaveBeenCalled()
  })

  it('updates from the latest load without overwriting a concurrently held lease', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [11, 12],
      now: '2026-07-16T08:00:00Z'
    })
    const lease = { batchId: batch.id, segmentId: batch.segments[0].id, task: 'execute' as const }
    const harness = createHarness({ version: 1, batches: [batch], lease })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await orchestrator.updateSegment(batch.id, batch.segments[0].id, {
      status: 'paused',
      task: {
        kind: 'execute',
        status: 'paused',
        requestState: 'result-unknown',
        currentAid: 12
      },
      checkpoint: { cursor: 7, frozenExecutionAids: [11, 12] },
      snapshot: { currentStep: 'execution', execution: { completed: 1 } }
    })

    expect(harness.getState()).toMatchObject({
      lease,
      batches: [
        {
          snapshot: { currentStep: 'execution', execution: { completed: 1 } },
          segments: [
            {
              status: 'paused',
              task: {
                kind: 'execute',
                status: 'paused',
                requestState: 'result-unknown',
                currentAid: 12
              },
              checkpoint: { cursor: 7, frozenExecutionAids: [11, 12] }
            }
          ]
        }
      ]
    })
  })

  it('partially updates task status, request state, and current aid from the latest segment', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [11, 12],
      now: '2026-07-16T08:00:00Z'
    })
    batch.segments[0].task = {
      kind: 'tag',
      status: 'running',
      requestState: 'in-flight',
      currentAid: 11
    }
    const harness = createHarness({ version: 1, batches: [batch], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await orchestrator.updateSegment(batch.id, batch.segments[0].id, {
      taskStatus: 'paused',
      requestState: 'result-unknown',
      currentAid: 12
    })

    expect(harness.getState().batches[0].segments[0].task).toEqual({
      kind: 'tag',
      status: 'paused',
      requestState: 'result-unknown',
      currentAid: 12
    })
  })

  it('freezes each 2000-item discovery segment without rebuilding earlier segments', async () => {
    const harness = createHarness()
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
    const started = await orchestrator.beginScan({
      accountMid: '42',
      kind: 'full',
      now: '2026-07-16T08:00:00Z',
      snapshot: { selection: { folders: [1] }, currentStep: 'scan' }
    })
    const first = await orchestrator.appendDiscoveredAids(
      started.batch.id,
      Array.from({ length: 2_000 }, (_, index) => index + 1)
    )
    const frozenFirst = {
      id: first.segments[0].id,
      index: first.segments[0].index,
      aids: structuredClone(first.segments[0].aids)
    }
    const discovered = await orchestrator.appendDiscoveredAids(
      started.batch.id,
      Array.from({ length: 1_001 }, (_, index) => index + 2_001)
    )
    const rebuilt = await orchestrator.completeScan(started.batch.id, {
      statistics: { scanned: 3_001 },
      currentStep: 'preview'
    })

    expect(rebuilt.id).toBe(started.batch.id)
    expect(rebuilt.createdAt).toBe(started.batch.createdAt)
    expect(first.segments[0]).toMatchObject({
      aids: expect.any(Array),
      status: 'running',
      task: { kind: 'tag', status: 'running', requestState: 'idle' }
    })
    expect(first.segments[0].aids).toHaveLength(2_000)
    expect(discovered.segments.map((segment) => segment.aids.length)).toEqual([2_000, 1_001])
    expect(rebuilt.segments[0]).toMatchObject(frozenFirst)
    expect(rebuilt.segments.map((segment) => segment.status)).toEqual(['running', 'ready'])
    expect(rebuilt.snapshot).toEqual({
      selection: { folders: [1] },
      currentStep: 'preview',
      statistics: { scanned: 3_001 }
    })
    expect(harness.getState().lease).toMatchObject({ batchId: rebuilt.id, task: 'scan' })
  })

  it('marks one frozen segment ready without changing earlier manual snapshot data', async () => {
    const harness = createHarness()
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
    const started = await orchestrator.beginScan({
      accountMid: '42',
      kind: 'full',
      now: '2026-07-16T08:00:00Z',
      snapshot: { preview: { manualDecision: 'keep-me' } }
    })
    const discovered = await orchestrator.appendDiscoveredAids(
      started.batch.id,
      Array.from({ length: 4_000 }, (_, index) => index + 1)
    )

    const settled = await orchestrator.markSegmentTagsSettled(started.batch.id, 0)

    expect(settled.segments[0]).toMatchObject({ status: 'ready', task: undefined })
    expect(settled.segments[1]).toMatchObject({
      status: 'running',
      task: { kind: 'tag', status: 'running' }
    })
    expect(settled.snapshot).toEqual({ preview: { manualDecision: 'keep-me' } })
  })

  it('completes discovery without marking paused or running tag segments ready', async () => {
    const harness = createHarness()
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
    const started = await orchestrator.beginScan({ accountMid: '42', kind: 'full', now: '2026-07-16T08:00:00Z' })
    await orchestrator.appendDiscoveredAids(
      started.batch.id,
      Array.from({ length: 4_000 }, (_, index) => index + 1)
    )
    await orchestrator.updateSegment(started.batch.id, `${started.batch.id}:segment:1`, {
      status: 'paused', taskStatus: 'paused'
    })

    const completed = await orchestrator.completeScan(started.batch.id)

    expect(completed.segments.map((segment) => ({ status: segment.status, task: segment.task }))).toEqual([
      { status: 'paused', task: { kind: 'tag', status: 'paused', requestState: 'idle' } },
      { status: 'running', task: { kind: 'tag', status: 'running', requestState: 'idle' } }
    ])
  })

  it('reports why account mismatch, ended history, and another lease cannot run', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [1],
      now: '2026-07-16T08:00:00Z'
    })
    const ended = { ...structuredClone(batch), id: 'ended', status: 'ended' as const }
    const harness = createHarness({ version: 1, batches: [batch, ended], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await expect(orchestrator.canRun(batch.id, batch.segments[0].id, '7')).resolves.toEqual({
      allowed: false,
      reason: 'account-mismatch'
    })
    await expect(orchestrator.canRun(ended.id, ended.segments[0].id, '42')).resolves.toEqual({
      allowed: false,
      reason: 'batch-ended'
    })

    await harness.coordinator.acquire(batch.id, batch.segments[0].id, 'tag', '42')
    await expect(orchestrator.canRun(batch.id, batch.segments[0].id, '42')).resolves.toEqual({
      allowed: true
    })
    const other = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'incremental',
      aids: [2],
      now: '2026-07-16T09:00:00Z'
    })
    const state = harness.getState()
    await harness.coordinator.save({ ...state, batches: [...state.batches, other] })
    await expect(orchestrator.canRun(other.id, other.segments[0].id, '42')).resolves.toEqual({
      allowed: false,
      reason: 'lease-held'
    })
  })

  it('discards an empty incremental placeholder without changing earlier batches', async () => {
    const previous = createOldFavoriteBatch({
      accountMid: '42', kind: 'full', aids: [1], now: '2026-07-16T07:00:00Z'
    })
    const harness = createHarness({ version: 1, batches: [previous], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)
    const started = await orchestrator.beginScan({
      accountMid: '42', kind: 'incremental', now: '2026-07-16T08:00:00Z'
    })

    await orchestrator.discardBatch(started.batch.id)

    expect(harness.getState().batches).toEqual([previous])
    expect(harness.getState().lease).toBeNull()
  })

  it('returns only result-unknown aids that require reconciliation', async () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [21, 22, 23],
      now: '2026-07-16T08:00:00Z'
    })
    batch.segments[0].status = 'paused'
    batch.segments[0].task = {
      kind: 'execute',
      status: 'paused',
      requestState: 'result-unknown',
      currentAid: 22
    }
    const harness = createHarness({ version: 1, batches: [batch], lease: null })
    const orchestrator = new OldFavoriteSessionOrchestrator(harness.coordinator)

    await expect(orchestrator.getReconciliationAids(batch.id, '42')).resolves.toEqual([22])
    batch.segments[0].task.requestState = 'idle'
    await harness.coordinator.save({ version: 1, batches: [batch], lease: null })
    await expect(orchestrator.getReconciliationAids(batch.id, '42')).resolves.toEqual([])
  })
})
