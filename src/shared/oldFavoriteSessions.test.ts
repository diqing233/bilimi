import { describe, expect, it } from 'vitest'
import {
  acquireAidOwnership,
  createOldFavoriteBatch,
  endOldFavoriteBatch,
  normalizeOldFavoriteSessionsForShutdown,
  planOldFavoriteRecovery,
  type OldFavoriteSessionsState
} from './oldFavoriteSessions'

const NOW = '2026-07-16T08:00:00.000Z'

describe('old favorite sessions', () => {
  it('splits 30,000 unique aids into stable performance segments near 1,500 items', () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [...Array(30_000)].map((_, index) => index + 1),
      now: NOW
    })

    expect(batch.segments).toHaveLength(20)
    expect(batch.segments.every((segment) => segment.aids.length === 1_500)).toBe(true)
    expect(new Set(batch.segments.flatMap((segment) => segment.aids))).toHaveLength(30_000)
    expect(batch.segments[1]).toMatchObject({ index: 1, id: `${batch.id}:segment:2` })
  })

  it('creates independent full and incremental user batches without stealing active aid ownership', () => {
    const full = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1, 2], now: NOW })
    const state: OldFavoriteSessionsState = { version: 1, batches: [full], lease: null }

    expect(acquireAidOwnership(state, '42', [2, 3, 3])).toEqual([3])
    const incremental = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'incremental',
      aids: acquireAidOwnership(state, '42', [2, 3]),
      now: '2026-07-16T09:00:00.000Z'
    })

    expect(incremental.kind).toBe('incremental')
    expect(incremental.segments[0].aids).toEqual([3])
  })

  it('keeps the complete user batch snapshot and per-segment checkpoint available for recovery', () => {
    const batch = createOldFavoriteBatch({
      accountMid: '42',
      kind: 'full',
      aids: [1],
      now: NOW,
      snapshot: {
        selection: { sourceFolderIds: ['10'], unlockedManagedFolderIds: ['20'] },
        preview: { items: [{ aid: 1, selectedTargetLedgerIds: ['game'] }] },
        archivePlanState: { version: 3 },
        recommendations: { accepted: ['game'] },
        deepSeek: { scope: 'batch-unmatched', completedGroups: 2 },
        execution: { completed: 4 },
        undo: { records: [1] },
        statistics: { total: 1 },
        currentStep: 'preview'
      }
    })
    batch.segments[0].checkpoint = { cursor: 1, page: 3, frozenExecutionAids: [1] }

    const afterShutdown = normalizeOldFavoriteSessionsForShutdown({
      version: 1,
      batches: [batch],
      lease: null
    })

    expect(afterShutdown.batches[0].snapshot).toMatchObject({
      currentStep: 'preview',
      selection: { sourceFolderIds: ['10'] },
      deepSeek: { scope: 'batch-unmatched', completedGroups: 2 }
    })
    expect(afterShutdown.batches[0].segments[0].checkpoint).toEqual({
      cursor: 1,
      page: 3,
      frozenExecutionAids: [1]
    })
  })

  it('ends the whole user batch as immutable history and releases its aid ownership', () => {
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1, 2], now: NOW })
    const state: OldFavoriteSessionsState = { version: 1, batches: [batch], lease: null }
    const ended = endOldFavoriteBatch(state, batch.id, '2026-07-16T10:00:00.000Z')

    expect(ended.batches[0]).toMatchObject({ status: 'ended', endedAt: '2026-07-16T10:00:00.000Z' })
    expect(ended.batches[0].segments.every((segment) => segment.status === 'ended')).toBe(true)
    expect(acquireAidOwnership(ended, '42', [1, 2])).toEqual([1, 2])
  })

  it('pauses running work on shutdown and marks an in-flight request result unknown', () => {
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: NOW })
    batch.segments[0].status = 'running'
    batch.segments[0].task = {
      kind: 'execute',
      status: 'running',
      currentAid: 1,
      requestState: 'in-flight'
    }

    const normalized = normalizeOldFavoriteSessionsForShutdown({
      version: 1,
      batches: [batch],
      lease: { batchId: batch.id, segmentId: batch.segments[0].id, task: 'execute' }
    })

    expect(normalized.lease).toBeNull()
    expect(normalized.batches[0].segments[0]).toMatchObject({
      status: 'paused',
      task: { status: 'paused', requestState: 'result-unknown' }
    })
  })

  it('locks a batch for a different account and requires reconciliation before resume', () => {
    const batch = createOldFavoriteBatch({ accountMid: '42', kind: 'full', aids: [1], now: NOW })
    batch.segments[0].status = 'paused'
    batch.segments[0].task = {
      kind: 'execute',
      status: 'paused',
      currentAid: 1,
      requestState: 'result-unknown'
    }

    expect(planOldFavoriteRecovery(batch, '99')).toEqual({ action: 'locked-account' })
    expect(planOldFavoriteRecovery(batch, '42')).toEqual({
      action: 'reconcile',
      segmentId: batch.segments[0].id,
      aids: [1]
    })
  })
})
