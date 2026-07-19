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
    })).toEqual({ targetLedgerIds: ['music', 'live'], reason: null })
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
})
