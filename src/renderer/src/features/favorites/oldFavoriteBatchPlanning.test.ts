import { describe, expect, it } from 'vitest'
import {
  buildArchiveExecutionDiff,
  deriveVisibleArchiveGroups,
  rebuildBatchArchivePlan,
  type BatchPlanningItem
} from './oldFavoriteBatchPlanning'

const baseItem = (overrides: Partial<BatchPlanningItem> = {}): BatchPlanningItem => ({
  itemKey: 'default::1',
  aid: 1,
  title: '原神剧情考据',
  sourceFolderTitle: '默认收藏夹',
  tags: [],
  currentFormalLedgerIds: [],
  lastConfirmedLedgerIds: [],
  targetLedgerIds: [],
  targetOrigin: 'automatic',
  executionState: 'pending',
  ...overrides
})

describe('oldFavoriteBatchPlanning', () => {
  it('restores the formal or last-confirmed baseline before reclassifying old videos', () => {
    const items = Array.from({ length: 242 }, (_, index) =>
      baseItem({
        itemKey: `default::${index + 1}`,
        aid: index + 1,
        currentFormalLedgerIds: index < 40 ? ['genshin'] : [],
        lastConfirmedLedgerIds: index < 202 ? ['genshin'] : []
      })
    )

    const rebuilt = rebuildBatchArchivePlan(items, () => [])

    expect(rebuilt.filter((item) => item.targetLedgerIds.includes('genshin'))).toHaveLength(202)
    expect(rebuilt.filter((item) => item.targetLedgerIds.length === 0)).toHaveLength(40)
  })

  it('uses fetched tags to really rebuild automatic targets and never falls back to staging after a formal match', () => {
    const rebuilt = rebuildBatchArchivePlan(
      [baseItem({ targetLedgerIds: ['inbox'], tags: ['原神'] })],
      (item) => (item.tags.includes('原神') ? ['genshin'] : [])
    )

    expect(rebuilt[0]).toMatchObject({
      targetLedgerIds: ['genshin'],
      classificationInputRevision: 1
    })
  })

  it('preserves manual and executed targets while rebuilding automatic pending rows', () => {
    const rebuilt = rebuildBatchArchivePlan(
      [
        baseItem({ itemKey: 'manual', targetLedgerIds: ['music'], targetOrigin: 'manual' }),
        baseItem({
          itemKey: 'executed',
          targetLedgerIds: ['knowledge'],
          executionState: 'succeeded'
        }),
        baseItem({ itemKey: 'auto', targetLedgerIds: [] })
      ],
      () => ['genshin']
    )

    expect(rebuilt.map((item) => item.targetLedgerIds)).toEqual([
      ['music'],
      ['knowledge'],
      ['genshin']
    ])
  })

  it('builds target-level execution differences using replace for one target and append for many', () => {
    expect(buildArchiveExecutionDiff(['old'], ['new'])).toEqual({
      addLedgerIds: ['new'],
      removeLedgerIds: ['old'],
      mode: 'replace'
    })
    expect(buildArchiveExecutionDiff(['already'], ['already', 'extra'])).toEqual({
      addLedgerIds: ['extra'],
      removeLedgerIds: [],
      mode: 'append'
    })
    expect(buildArchiveExecutionDiff(['already'], ['already'])).toEqual({
      addLedgerIds: [],
      removeLedgerIds: [],
      mode: 'replace'
    })
  })

  it('derives preview groups only from ledgers that currently contain videos', () => {
    expect(
      deriveVisibleArchiveGroups([
        baseItem({ targetLedgerIds: ['game'] }),
        baseItem({ itemKey: '2', aid: 2, targetLedgerIds: [] })
      ])
    ).toEqual([{ ledgerId: 'game', itemCount: 1 }])
  })
})
