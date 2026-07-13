import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import {
  applyArchivePlanSelection,
  buildExecutableArchivePlan,
  createArchivePlanState,
  moveArchivePlanItemToUnclassified,
  revertArchivePlanArea,
  revertArchivePlanItem
} from './favoriteArchivePlanState'

const item = {
  aid: 101,
  title: '东京旅行攻略',
  sourceFolderTitle: '默认收藏夹',
  originalSuggestedLedgerIds: ['life-interest'],
  currentTargetLedgerIds: ['life-interest'],
  selectedTargetLedgerIds: ['life-interest'],
  userModified: false
}

describe('favoriteArchivePlanState', () => {
  it('moves one item to another ledger and keeps original suggestion', () => {
    const state = createArchivePlanState([item])
    const next = applyArchivePlanSelection(state, 101, ['knowledge'], 'user')

    expect(next.items[0]).toMatchObject({
      originalSuggestedLedgerIds: ['life-interest'],
      currentTargetLedgerIds: ['knowledge'],
      selectedTargetLedgerIds: ['knowledge'],
      userModified: true,
      lastChangeSource: 'user'
    })
  })

  it('updates and reverts one duplicate aid occurrence without changing another source row', () => {
    const state = createArchivePlanState([
      { ...item, sourceFolderTitle: 'Source A' },
      {
        ...item,
        sourceFolderTitle: 'Source B',
        originalSuggestedLedgerIds: ['knowledge'],
        currentTargetLedgerIds: ['knowledge'],
        selectedTargetLedgerIds: ['knowledge']
      }
    ])

    const changed = applyArchivePlanSelection(
      state,
      { aid: 101, sourceFolderTitle: 'Source A' },
      ['music'],
      'user'
    )

    expect(changed.items).toEqual([
      expect.objectContaining({
        aid: 101,
        sourceFolderTitle: 'Source A',
        currentTargetLedgerIds: ['music'],
        selectedTargetLedgerIds: ['music'],
        userModified: true
      }),
      expect.objectContaining({
        aid: 101,
        sourceFolderTitle: 'Source B',
        currentTargetLedgerIds: ['knowledge'],
        selectedTargetLedgerIds: ['knowledge'],
        userModified: false
      })
    ])

    const reverted = revertArchivePlanItem(changed, { aid: 101, sourceFolderTitle: 'Source A' })

    expect(reverted.items).toEqual([
      expect.objectContaining({
        sourceFolderTitle: 'Source A',
        currentTargetLedgerIds: ['life-interest'],
        selectedTargetLedgerIds: ['life-interest'],
        userModified: false
      }),
      expect.objectContaining({
        sourceFolderTitle: 'Source B',
        currentTargetLedgerIds: ['knowledge'],
        selectedTargetLedgerIds: ['knowledge'],
        userModified: false
      })
    ])
  })

  it('keeps same-title duplicate aid rows addressable by unique item keys only', () => {
    const state = createArchivePlanState([
      { ...item, sourceFolderTitle: 'Same Source' },
      {
        ...item,
        sourceFolderTitle: 'Same Source',
        originalSuggestedLedgerIds: ['knowledge'],
        currentTargetLedgerIds: ['knowledge'],
        selectedTargetLedgerIds: ['knowledge']
      }
    ])

    expect(new Set(state.items.map((entry) => entry.itemKey)).size).toBe(2)

    const ambiguous = applyArchivePlanSelection(state, 101, ['music'], 'user')
    expect(ambiguous.items).toEqual(state.items)

    const changed = applyArchivePlanSelection(
      state,
      { itemKey: state.items[1].itemKey },
      ['music'],
      'user'
    )

    expect(changed.items[0]).toMatchObject({
      currentTargetLedgerIds: ['life-interest'],
      userModified: false
    })
    expect(changed.items[1]).toMatchObject({
      currentTargetLedgerIds: ['music'],
      userModified: true
    })
  })

  it('reverts one item to the original preview state', () => {
    const changed = applyArchivePlanSelection(createArchivePlanState([item]), 101, [], 'user')
    const reverted = revertArchivePlanItem(changed, 101)

    expect(reverted.items[0]).toMatchObject({
      currentTargetLedgerIds: ['life-interest'],
      selectedTargetLedgerIds: ['life-interest'],
      userModified: false
    })
  })

  it('moves one item to the unclassified area', () => {
    const moved = moveArchivePlanItemToUnclassified(createArchivePlanState([item]), 101, 'user')

    expect(moved.items[0]).toMatchObject({
      currentTargetLedgerIds: [],
      selectedTargetLedgerIds: [],
      userModified: true,
      lastChangeSource: 'user'
    })
  })

  it('reverts all changed items in one target area', () => {
    const base = createArchivePlanState([
      item,
      {
        ...item,
        aid: 102,
        originalSuggestedLedgerIds: ['knowledge'],
        currentTargetLedgerIds: ['knowledge'],
        selectedTargetLedgerIds: ['knowledge']
      }
    ])
    const changed = applyArchivePlanSelection(
      applyArchivePlanSelection(base, 101, ['knowledge'], 'user'),
      102,
      [],
      'user'
    )

    const revertedKnowledge = revertArchivePlanArea(changed, 'knowledge')
    const revertedUnclassified = revertArchivePlanArea(changed, 'unclassified')

    expect(revertedKnowledge.items.find((entry) => entry.aid === 101)).toMatchObject({
      currentTargetLedgerIds: ['life-interest'],
      userModified: false
    })
    expect(revertedKnowledge.items.find((entry) => entry.aid === 102)?.userModified).toBe(true)
    expect(revertedUnclassified.items.find((entry) => entry.aid === 102)).toMatchObject({
      currentTargetLedgerIds: ['knowledge'],
      userModified: false
    })
  })

  it('builds executable plans only from selected real bilimi targets', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge'
        ? { ...ledger, bilibiliFolderId: '9001' }
        : ledger.id === 'life-interest'
          ? { ...ledger, bilibiliFolderId: '9005' }
          : ledger
    )
    const state = createArchivePlanState([
      {
        ...item,
        currentTargetLedgerIds: ['knowledge', 'life-interest', 'unclassified'],
        selectedTargetLedgerIds: ['knowledge', 'unclassified']
      },
      {
        ...item,
        aid: 102,
        currentTargetLedgerIds: ['life-interest'],
        selectedTargetLedgerIds: []
      }
    ])

    expect(buildExecutableArchivePlan(state, ledgers)).toEqual([
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'knowledge',
        targetFolderId: '9001'
      })
    ])
  })

  it('keeps selected real bilimi targets without synced folder ids executable', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'life-interest'
        ? { ...ledger, bilibiliFolderId: undefined }
        : ledger
    )
    const state = createArchivePlanState([
      {
        ...item,
        currentTargetLedgerIds: ['life-interest', 'unclassified', 'inbox'],
        selectedTargetLedgerIds: ['life-interest', 'unclassified', 'inbox']
      }
    ])

    expect(buildExecutableArchivePlan(state, ledgers)).toEqual([
      expect.objectContaining({
        aid: 101,
        targetLedgerId: 'life-interest',
        targetFolderId: ''
      })
    ])
  })
})
