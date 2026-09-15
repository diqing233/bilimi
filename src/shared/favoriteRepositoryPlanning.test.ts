import { describe, expect, it } from 'vitest'
import {
  planRemoteCapacity,
  resolveRepositoryTargets
} from './favoriteRepositoryPlanning'

describe('favorite repository planning', () => {
  it('routes a low-confidence automatic proposal to unclassified instead of a second target', () => {
    expect(resolveRepositoryTargets({
      candidates: [
        { ledgerId: 'game', source: 'system-low' },
        { ledgerId: 'knowledge', source: 'system-low' }
      ],
      maximumTargets: 3
    })).toEqual({ targetLedgerIds: [], reason: 'insufficient-reliable-targets' })
  })

  it('prefers manual proposals over DeepSeek and automatic proposals', () => {
    expect(resolveRepositoryTargets({
      candidates: [
        { ledgerId: 'manual-game', source: 'manual' },
        { ledgerId: 'deepseek-knowledge', source: 'deepseek' },
        { ledgerId: 'automatic-ai', source: 'system-high' }
      ],
      maximumTargets: 3
    })).toEqual({ targetLedgerIds: ['manual-game'], reason: null })
  })

  it('allows DeepSeek to retain the configured number of targets', () => {
    expect(resolveRepositoryTargets({
      candidates: [
        { ledgerId: 'music', source: 'deepseek' },
        { ledgerId: 'live', source: 'deepseek' },
        { ledgerId: 'review', source: 'deepseek' }
      ],
      maximumTargets: 2
    })).toEqual({ targetLedgerIds: ['live', 'music'], reason: null })
  })

  it('clamps the configured multi-target limit to the supported range of one through three', () => {
    const candidates = [
      { ledgerId: 'one', source: 'deepseek' as const },
      { ledgerId: 'two', source: 'deepseek' as const },
      { ledgerId: 'three', source: 'deepseek' as const },
      { ledgerId: 'four', source: 'deepseek' as const }
    ]

    expect(resolveRepositoryTargets({ candidates, maximumTargets: 99 }).targetLedgerIds)
      .toEqual(['four', 'one', 'three'])
    expect(resolveRepositoryTargets({ candidates, maximumTargets: 0 }).targetLedgerIds)
      .toEqual(['four'])
    expect(resolveRepositoryTargets({ candidates, maximumTargets: Number.NaN }).targetLedgerIds)
      .toEqual(['four'])
    expect(resolveRepositoryTargets({ candidates, maximumTargets: Number.POSITIVE_INFINITY }).targetLedgerIds)
      .toEqual(['four'])
  })

  it('trims and deterministically deduplicates equivalent winning ledger candidates', () => {
    const candidates = [
      { ledgerId: ' zeta ', source: 'deepseek' as const },
      { ledgerId: 'alpha', source: 'deepseek' as const },
      { ledgerId: 'zeta', source: 'deepseek' as const },
      { ledgerId: ' beta', source: 'deepseek' as const }
    ]

    expect(resolveRepositoryTargets({ candidates, maximumTargets: 3 }))
      .toEqual({ targetLedgerIds: ['alpha', 'beta', 'zeta'], reason: null })
    expect(resolveRepositoryTargets({ candidates: [...candidates].reverse(), maximumTargets: 3 }))
      .toEqual({ targetLedgerIds: ['alpha', 'beta', 'zeta'], reason: null })
  })

  it('keeps an automatic high-confidence proposal to one target', () => {
    expect(resolveRepositoryTargets({
      candidates: [
        { ledgerId: 'knowledge', source: 'system-high' },
        { ledgerId: 'technology', source: 'system-high' }
      ],
      maximumTargets: 3
    })).toEqual({ targetLedgerIds: ['knowledge'], reason: null })
  })

  it('blocks a remote plan that would exceed the Bilibili folder limit', () => {
    expect(planRemoteCapacity({ currentFolderCount: 99, shardCreates: 1, inboxTotal: 0 }))
      .toMatchObject({ allowed: false, reason: 'folder-limit-exceeded' })
  })

  it('allows the 99th folder and exactly 1000 members in a physical shard', () => {
    expect(planRemoteCapacity({
      currentFolderCount: 98,
      shardCreates: 1,
      inboxTotal: 50_000,
      maximumProjectedShardMembers: 1_000
    })).toMatchObject({ allowed: true, reason: null })
  })

  it('blocks a remote plan whose default inbox would exceed 50000 items', () => {
    expect(planRemoteCapacity({ currentFolderCount: 1, shardCreates: 0, inboxTotal: 50_001 }))
      .toMatchObject({ allowed: false, reason: 'inbox-capacity-exceeded' })
  })

  it('blocks a remote plan whose projected physical shard exceeds 1000 members', () => {
    expect(planRemoteCapacity({
      currentFolderCount: 1,
      shardCreates: 0,
      inboxTotal: 1,
      maximumProjectedShardMembers: 1_001
    })).toMatchObject({ allowed: false, reason: 'shard-capacity-exceeded' })
  })

  it.each([
    { currentFolderCount: -1, shardCreates: 0, inboxTotal: 0 },
    { currentFolderCount: Number.NaN, shardCreates: 0, inboxTotal: 0 },
    { currentFolderCount: Number.POSITIVE_INFINITY, shardCreates: 0, inboxTotal: 0 },
    { currentFolderCount: 0, shardCreates: -1, inboxTotal: 0 },
    { currentFolderCount: 0, shardCreates: 0, inboxTotal: Number.NaN },
    { currentFolderCount: 0, shardCreates: 0, inboxTotal: 0, maximumProjectedShardMembers: -1 },
    { currentFolderCount: 0, shardCreates: 0, inboxTotal: 0, maximumProjectedShardMembers: Number.POSITIVE_INFINITY },
    { currentFolderCount: 0.5, shardCreates: 0, inboxTotal: 0 }
  ])('fails closed for invalid remote capacity input %#', (input) => {
    expect(planRemoteCapacity(input)).toEqual({
      allowed: false,
      reason: 'invalid-input',
      projectedFolderCount: 0
    })
  })
})
