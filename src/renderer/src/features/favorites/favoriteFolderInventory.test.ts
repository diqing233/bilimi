import { describe, expect, it } from 'vitest'
import { buildFavoriteFolderInventory } from './favoriteFolderInventory'

describe('buildFavoriteFolderInventory', () => {
  it('lists every ordinary and managed folder including empty folders', () => {
    const inventory = buildFavoriteFolderInventory({
      ordinaryFolders: [
        { id: 'ordinary-a', title: '默认收藏夹', memberAids: [1, 2] },
        { id: 'ordinary-empty', title: '空收藏夹', memberAids: [] }
      ],
      managedFolders: [
        { id: 'formal', logicalId: 'game', title: 'bilimi·游戏', memberAids: [2, 3], isInbox: false },
        { id: 'staging', logicalId: 'inbox', title: 'bilimi·暂存', memberAids: [4], isInbox: true },
        { id: 'managed-empty', logicalId: 'music', title: 'bilimi·音乐', memberAids: [], isInbox: false }
      ]
    })

    expect(inventory.folders.map((folder) => folder.id)).toEqual([
      'ordinary-a',
      'ordinary-empty',
      'formal',
      'staging',
      'managed-empty'
    ])
    expect(inventory.folders.find((folder) => folder.id === 'ordinary-empty')).toMatchObject({
      existingCount: 0,
      selected: true,
      locked: false
    })
    expect(inventory.folders.find((folder) => folder.id === 'managed-empty')).toMatchObject({
      existingCount: 0,
      selected: false,
      locked: true
    })
  })

  it('defaults staging to selected without protecting it and deduplicates formal protection by aid', () => {
    const inventory = buildFavoriteFolderInventory({
      ordinaryFolders: [
        { id: 'ordinary-a', title: '默认收藏夹', memberAids: [1, 2, 4] },
        { id: 'ordinary-b', title: '稍后再看', memberAids: [1, 5] }
      ],
      managedFolders: [
        { id: 'formal-a', logicalId: 'game', title: 'bilimi·游戏', memberAids: [1, 2], isInbox: false },
        { id: 'formal-b', logicalId: 'knowledge', title: 'bilimi·知识', memberAids: [2, 3], isInbox: false },
        { id: 'staging', logicalId: 'inbox', title: 'bilimi·暂存', memberAids: [4, 5], isInbox: true }
      ]
    })

    expect(inventory.totalUniqueAidCount).toBe(5)
    expect(inventory.protectedUniqueAidCount).toBe(3)
    expect(inventory.pendingUniqueAids).toEqual([4, 5])
    expect(inventory.folders.find((folder) => folder.id === 'staging')).toMatchObject({
      selected: true,
      locked: false,
      pendingAidCount: 2
    })
  })

  it('allows partial formal unlock and only releases aids owned by unlocked logical folders', () => {
    const inventory = buildFavoriteFolderInventory({
      ordinaryFolders: [{ id: 'ordinary', title: '默认收藏夹', memberAids: [1, 2, 3, 4] }],
      managedFolders: [
        { id: 'formal-a-1', logicalId: 'game', title: 'bilimi·游戏', memberAids: [1, 2], isInbox: false },
        { id: 'formal-a-2', logicalId: 'game', title: 'bilimi·游戏·2', memberAids: [3], isInbox: false },
        { id: 'formal-b', logicalId: 'knowledge', title: 'bilimi·知识', memberAids: [2, 4], isInbox: false }
      ],
      unlockedLogicalIds: ['game'],
      selectedManagedLogicalIds: ['game']
    })

    expect(inventory.folders.filter((folder) => folder.logicalId === 'game')).toEqual([
      expect.objectContaining({ selected: true, locked: false }),
      expect.objectContaining({ selected: true, locked: false })
    ])
    expect(inventory.pendingUniqueAids).toEqual([1, 2, 3])
    expect(inventory.protectedUniqueAids).toEqual([4])
  })

  it('honors persisted ordinary and staging selections while keeping both selectable', () => {
    const inventory = buildFavoriteFolderInventory({
      ordinaryFolders: [
        { id: 'ordinary-a', title: '默认收藏夹', memberAids: [1] },
        { id: 'ordinary-b', title: '稍后再看', memberAids: [2] }
      ],
      managedFolders: [
        { id: 'staging', logicalId: 'inbox', title: 'bilimi·暂存', memberAids: [3], isInbox: true }
      ],
      selectedOrdinaryFolderIds: ['ordinary-b'],
      selectedManagedLogicalIds: []
    })

    expect(inventory.folders.map(({ id, selected }) => [id, selected])).toEqual([
      ['ordinary-a', false],
      ['ordinary-b', true],
      ['staging', false]
    ])
    expect(inventory.pendingUniqueAids).toEqual([2])
  })
})
