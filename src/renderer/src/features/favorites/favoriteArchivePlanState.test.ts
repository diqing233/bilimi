import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import { describe, expect, it } from 'vitest'
import {
  applyArchiveCandidateTransaction,
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

  it('blocks selected real bilimi targets without synced folder ids', () => {
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

    expect(() => buildExecutableArchivePlan(state, ledgers)).toThrow(
      '归档目标尚未同步到 B 站：bilimi·生活日常'
    )
  })

  it('blocks execution when a selected custom target has no ledger definition', () => {
    const state = createArchivePlanState([
      {
        ...item,
        currentTargetLedgerIds: ['custom-author-hon'],
        selectedTargetLedgerIds: ['custom-author-hon']
      }
    ])

    expect(() => buildExecutableArchivePlan(state, createDefaultFavoriteLedgers())).toThrow(
      '无法解析归档目标：custom-author-hon'
    )
  })

  it('selects 326 candidate items in one immutable archive transaction', () => {
    const items = Array.from({ length: 326 }, (_, index) => ({
      ...item,
      aid: 1000 + index,
      currentTargetLedgerIds: ['inbox'],
      selectedTargetLedgerIds: ['inbox']
    }))
    const before = {
      archivePlanState: createArchivePlanState(items),
      selectedCandidateKeys: [],
      draftLedgers: createDefaultFavoriteLedgers(),
      candidateSourceLedgerIdsByItemKey: {}
    }

    const after = applyArchiveCandidateTransaction(before, {
      candidateKey: 'tag-cluster:hon',
      candidateLedgerId: 'custom-author-hon',
      candidateLedger: {
        ...createDefaultFavoriteLedgers()[0],
        id: 'custom-author-hon',
        displayName: '作者 Hon',
        isDefault: false
      },
      affectedItemKeys: before.archivePlanState.items.map((entry) => entry.itemKey),
      selected: true
    })

    expect(after).not.toBe(before)
    expect(after.archivePlanState.items).toHaveLength(326)
    expect(after.archivePlanState.items.every((entry) =>
      entry.currentTargetLedgerIds.includes('custom-author-hon')
    )).toBe(true)
    expect(after.selectedCandidateKeys).toEqual(['tag-cluster:hon'])
    expect(after.draftLedgers.find((ledger) => ledger.id === 'custom-author-hon')?.displayName).toBe(
      '作者 Hon'
    )
  })

  it('restores each item source position when a candidate is deselected', () => {
    const basePlan = createArchivePlanState([
      { ...item, aid: 201, currentTargetLedgerIds: ['knowledge'], selectedTargetLedgerIds: ['knowledge'] },
      { ...item, aid: 202, currentTargetLedgerIds: [], selectedTargetLedgerIds: [] }
    ])
    const candidateLedger = {
      ...createDefaultFavoriteLedgers()[0],
      id: 'custom-author-hon',
      displayName: '作者 Hon',
      isDefault: false
    }
    const selected = applyArchiveCandidateTransaction(
      {
        archivePlanState: basePlan,
        selectedCandidateKeys: [],
        draftLedgers: createDefaultFavoriteLedgers(),
        candidateSourceLedgerIdsByItemKey: {}
      },
      {
        candidateKey: 'author:hon',
        candidateLedgerId: candidateLedger.id,
        candidateLedger,
        affectedItemKeys: basePlan.items.map((entry) => entry.itemKey),
        selected: true
      }
    )

    const restored = applyArchiveCandidateTransaction(selected, {
      candidateKey: 'author:hon',
      candidateLedgerId: candidateLedger.id,
      candidateLedger,
      affectedItemKeys: basePlan.items.map((entry) => entry.itemKey),
      selected: false
    })

    expect(restored.archivePlanState.items.map((entry) => entry.currentTargetLedgerIds)).toEqual([
      ['knowledge'],
      []
    ])
    expect(restored.selectedCandidateKeys).toEqual([])
    expect(restored.draftLedgers.some((ledger) => ledger.id === candidateLedger.id)).toBe(false)
    expect(restored.candidateSourceLedgerIdsByItemKey).toEqual({})
  })

  it('does not restore a removed candidate during interleaved candidate cancellation', () => {
    const defaults = createDefaultFavoriteLedgers()
    const plan = createArchivePlanState([
      { ...item, currentTargetLedgerIds: ['knowledge'], selectedTargetLedgerIds: ['knowledge'] }
    ])
    const base = {
      archivePlanState: plan,
      selectedCandidateKeys: [],
      draftLedgers: defaults,
      candidateSourceLedgerIdsByItemKey: {}
    }
    const itemKey = plan.items[0].itemKey
    const candidate = (id: string, displayName: string) => ({
      ...defaults[0], id, displayName, isDefault: false
    })
    const selectA = applyArchiveCandidateTransaction(base, {
      candidateKey: 'candidate:A', candidateLedgerId: 'custom-A', candidateLedger: candidate('custom-A', 'A'),
      affectedItemKeys: [itemKey], selected: true
    })
    const selectB = applyArchiveCandidateTransaction(selectA, {
      candidateKey: 'candidate:B', candidateLedgerId: 'custom-B', candidateLedger: candidate('custom-B', 'B'),
      affectedItemKeys: [itemKey], selected: true
    })
    const cancelA = applyArchiveCandidateTransaction(selectB, {
      candidateKey: 'candidate:A', candidateLedgerId: 'custom-A', candidateLedger: candidate('custom-A', 'A'),
      affectedItemKeys: [itemKey], selected: false
    })
    const cancelB = applyArchiveCandidateTransaction(cancelA, {
      candidateKey: 'candidate:B', candidateLedgerId: 'custom-B', candidateLedger: candidate('custom-B', 'B'),
      affectedItemKeys: [itemKey], selected: false
    })

    expect(cancelA.archivePlanState.items[0].currentTargetLedgerIds).toEqual(['knowledge', 'custom-B'])
    expect(cancelB.archivePlanState.items[0].currentTargetLedgerIds).toEqual(['knowledge'])
    expect(cancelB.draftLedgers.some((ledger) => ledger.id.startsWith('custom-'))).toBe(false)
  })

  it('blocks execution when a resolved target has no Bilibili folder id', () => {
    const ledgers = createDefaultFavoriteLedgers().map((ledger) =>
      ledger.id === 'knowledge' ? { ...ledger, bilibiliFolderId: undefined } : ledger
    )
    const state = createArchivePlanState([
      { ...item, currentTargetLedgerIds: ['knowledge'], selectedTargetLedgerIds: ['knowledge'] }
    ])

    expect(() => buildExecutableArchivePlan(state, ledgers)).toThrow(
      '归档目标尚未同步到 B 站：bilimi·知识学习'
    )
  })
})
