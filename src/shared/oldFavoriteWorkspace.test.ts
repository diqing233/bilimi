import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceClassificationBatch,
  completeWorkspaceScan,
  createOldFavoriteWorkspace,
  freezeWorkspaceSegment,
  recordDiscoveredFavorites,
  redoWorkspaceChange,
  setWorkspaceReorganizationMode,
  undoWorkspaceChange
} from './oldFavoriteWorkspace'

describe('old favorite workspace', () => {
  it('creates an account-scoped workspace in scanning state before a baseline exists', () => {
    const workspace = createOldFavoriteWorkspace({
      accountMid: '00100',
      now: '2026-07-19T00:00:00.000Z'
    })

    expect(workspace).toMatchObject({
      accountMid: '100',
      status: 'scanning',
      segmentSize: 2_000,
      plannedAids: []
    })
    expect(workspace.baseline).toBeUndefined()
  })

  it('fixes the completed scan as an aid-only baseline', () => {
    const scanning = createOldFavoriteWorkspace({
      accountMid: '100',
      now: '2026-07-19T00:00:00.000Z'
    })

    const preview = completeWorkspaceScan(scanning, {
      revision: 7,
      aids: [3, 1, 3, 2],
      successfullyClassifiedAids: [1]
    })

    expect(preview.baseline).toEqual({ revision: 7, aids: [1, 2, 3] })
    expect(preview).toMatchObject({
      status: 'previewing',
      plannedAids: [2, 3],
      protectedAids: [1]
    })
    expect(preview).not.toHaveProperty('videos')
  })

  it('uses one ungrouped segment at or below 2000 aids and two segments at 2001 aids', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const single = completeWorkspaceScan(scanning, {
      revision: 1,
      aids: Array.from({ length: 2_000 }, (_, index) => index + 1)
    })
    const multi = completeWorkspaceScan(scanning, {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })

    expect(single.segments).toHaveLength(1)
    expect(single.hasMultipleSegments).toBe(false)
    expect(multi.segments.map((segment) => segment.aids.length)).toEqual([2_000, 1])
    expect(multi.hasMultipleSegments).toBe(true)
  })

  it('keeps additions discovered after a frozen 2000-item segment in the continuation area', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const workspace = completeWorkspaceScan(scanning, {
      revision: 1,
      aids: Array.from({ length: 2_001 }, (_, index) => index + 1)
    })
    const frozen = freezeWorkspaceSegment(workspace, 'segment-1')

    const updated = recordDiscoveredFavorites(frozen, [3_001, 3_001, 1])

    expect(updated.continuationAids).toEqual([3_001])
    expect(updated.baseline?.aids).toHaveLength(2_001)
    expect(updated.segments[0].aids).toHaveLength(2_000)
  })

  it('does not put discoveries into continuation before the current plan is frozen', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const preview = completeWorkspaceScan(scanning, { revision: 1, aids: [1, 2] })

    expect(recordDiscoveredFavorites(preview, [3])).toEqual(preview)
  })

  it('protects completed classifications for incremental rounds until full reorganization is explicit', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const incremental = completeWorkspaceScan(scanning, {
      revision: 1,
      aids: [1, 2, 3],
      successfullyClassifiedAids: [1, 2]
    })
    const full = setWorkspaceReorganizationMode(incremental, 'full')

    expect(incremental.plannedAids).toEqual([3])
    expect(incremental.protectedAids).toEqual([1, 2])
    expect(full.plannedAids).toEqual([1, 2, 3])
    expect(full.protectedAids).toEqual([])
  })

  it('undoes and redoes manual and one whole DeepSeek batch as aid-only deltas', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const preview = completeWorkspaceScan(scanning, { revision: 1, aids: [1, 2, 3] })
    const manual = applyWorkspaceClassificationBatch(preview, {
      source: 'manual',
      assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const deepSeek = applyWorkspaceClassificationBatch(manual, {
      source: 'deepseek',
      assignments: [
        { aid: 2, targetLedgerIds: ['knowledge'] },
        { aid: 3, targetLedgerIds: ['knowledge', 'technology'] }
      ]
    })

    expect(deepSeek.history).toHaveLength(2)
    expect(deepSeek.classifications).toMatchObject({
      '1': { targetLedgerIds: ['music'], source: 'manual' },
      '2': { targetLedgerIds: ['knowledge'], source: 'deepseek' },
      '3': { targetLedgerIds: ['knowledge', 'technology'], source: 'deepseek' }
    })
    expect(undoWorkspaceChange(deepSeek).classifications).toEqual({
      '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' }
    })
    expect(redoWorkspaceChange(undoWorkspaceChange(deepSeek)).classifications).toMatchObject({
      '2': { targetLedgerIds: ['knowledge'], source: 'deepseek' },
      '3': { targetLedgerIds: ['knowledge', 'technology'], source: 'deepseek' }
    })
  })

  it('rejects classification changes for a frozen segment', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const preview = completeWorkspaceScan(scanning, { revision: 1, aids: [1] })
    const frozen = freezeWorkspaceSegment(preview, 'segment-1')

    expect(() => applyWorkspaceClassificationBatch(frozen, {
      source: 'manual',
      assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })).toThrow('Old favorite workspace is frozen.')
  })

  it('rejects undo and redo after a segment has frozen the classification plan', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z' })
    const preview = completeWorkspaceScan(scanning, { revision: 1, aids: [1] })
    const changed = applyWorkspaceClassificationBatch(preview, {
      source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['music'] }]
    })
    const frozen = freezeWorkspaceSegment(changed, 'segment-1')

    expect(() => undoWorkspaceChange(frozen)).toThrow('Old favorite workspace plan is frozen.')
    expect(() => redoWorkspaceChange({ ...frozen, historyCursor: 0 })).toThrow('Old favorite workspace plan is frozen.')
  })

  it('honors a smaller configured segment size even when the full round is below 2000 items', () => {
    const scanning = createOldFavoriteWorkspace({ accountMid: '100', now: '2026-07-19T00:00:00.000Z', segmentSize: 1_000 })
    const preview = completeWorkspaceScan(scanning, {
      revision: 1, aids: Array.from({ length: 1_500 }, (_, index) => index + 1)
    })

    expect(preview.segments.map((segment) => segment.aids.length)).toEqual([1_000, 500])
    expect(preview.hasMultipleSegments).toBe(true)
  })

  it('rejects physical segment sizes outside the supported 500 to 2000 range', () => {
    expect(() => createOldFavoriteWorkspace({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z', segmentSize: 499
    })).toThrow('segment size is invalid')
    expect(() => createOldFavoriteWorkspace({
      accountMid: '100', now: '2026-07-19T00:00:00.000Z', segmentSize: 2_001
    })).toThrow('segment size is invalid')
  })
})
