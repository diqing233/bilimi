export type FavoriteInventoryOrdinaryFolder = {
  id: string
  title: string
  memberAids: number[]
}

export type FavoriteInventoryManagedFolder = FavoriteInventoryOrdinaryFolder & {
  logicalId: string
  isInbox: boolean
}

export type FavoriteFolderInventoryItem = {
  id: string
  title: string
  kind: 'ordinary' | 'managed'
  logicalId?: string
  isInbox: boolean
  existingCount: number
  pendingAidCount: number
  selected: boolean
  locked: boolean
}

type FavoriteFolderInventoryOptions = {
  ordinaryFolders: FavoriteInventoryOrdinaryFolder[]
  managedFolders: FavoriteInventoryManagedFolder[]
  unlockedLogicalIds?: string[]
  selectedOrdinaryFolderIds?: string[]
  selectedManagedLogicalIds?: string[]
}

const uniqueValidAids = (aids: number[]) =>
  Array.from(new Set(aids.filter((aid) => Number.isFinite(aid) && aid > 0)))

export function buildFavoriteFolderInventory(options: FavoriteFolderInventoryOptions) {
  const unlockedLogicalIds = new Set(options.unlockedLogicalIds ?? [])
  const selectedOrdinaryFolderIds = new Set(
    options.selectedOrdinaryFolderIds ?? options.ordinaryFolders.map((folder) => folder.id)
  )
  const selectedManagedLogicalIds = new Set(options.selectedManagedLogicalIds ?? [])
  const protectedUniqueAids = new Set<number>()

  for (const folder of options.managedFolders) {
    if (!folder.isInbox && !unlockedLogicalIds.has(folder.logicalId)) {
      for (const aid of uniqueValidAids(folder.memberAids)) {
        protectedUniqueAids.add(aid)
      }
    }
  }

  for (const folder of options.managedFolders) {
    const selectedForReorganization = !folder.isInbox &&
      unlockedLogicalIds.has(folder.logicalId) &&
      selectedManagedLogicalIds.has(folder.logicalId)
    if (selectedForReorganization) {
      for (const aid of uniqueValidAids(folder.memberAids)) {
        protectedUniqueAids.delete(aid)
      }
    }
  }

  const selectedCandidateAids = new Set<number>()
  for (const folder of options.ordinaryFolders) {
    if (!selectedOrdinaryFolderIds.has(folder.id)) {
      continue
    }
    for (const aid of uniqueValidAids(folder.memberAids)) {
      selectedCandidateAids.add(aid)
    }
  }
  for (const folder of options.managedFolders) {
    const selected = (folder.isInbox
      ? options.selectedManagedLogicalIds === undefined || selectedManagedLogicalIds.has(folder.logicalId)
      : (
      unlockedLogicalIds.has(folder.logicalId) && selectedManagedLogicalIds.has(folder.logicalId)
      ))
    if (selected) {
      for (const aid of uniqueValidAids(folder.memberAids)) {
        selectedCandidateAids.add(aid)
      }
    }
  }

  const pendingUniqueAids = Array.from(selectedCandidateAids)
    .filter((aid) => !protectedUniqueAids.has(aid))
    .sort((left, right) => left - right)
  const pendingSet = new Set(pendingUniqueAids)

  const ordinaryItems: FavoriteFolderInventoryItem[] = options.ordinaryFolders.map((folder) => {
    const memberAids = uniqueValidAids(folder.memberAids)
    const selected = selectedOrdinaryFolderIds.has(folder.id)
    return {
      id: folder.id,
      title: folder.title,
      kind: 'ordinary',
      isInbox: false,
      existingCount: memberAids.length,
      pendingAidCount: selected ? memberAids.filter((aid) => pendingSet.has(aid)).length : 0,
      selected,
      locked: false
    }
  })
  const managedItems: FavoriteFolderInventoryItem[] = options.managedFolders.map((folder) => {
    const unlocked = folder.isInbox || unlockedLogicalIds.has(folder.logicalId)
    const selected = (folder.isInbox
      ? options.selectedManagedLogicalIds === undefined || selectedManagedLogicalIds.has(folder.logicalId)
      : (
      unlocked && selectedManagedLogicalIds.has(folder.logicalId)
      ))
    const memberAids = uniqueValidAids(folder.memberAids)
    return {
      id: folder.id,
      title: folder.title,
      kind: 'managed',
      logicalId: folder.logicalId,
      isInbox: folder.isInbox,
      existingCount: memberAids.length,
      pendingAidCount: selected ? memberAids.filter((aid) => pendingSet.has(aid)).length : 0,
      selected,
      locked: !unlocked
    }
  })

  const allAids = new Set<number>()
  for (const folder of [...options.ordinaryFolders, ...options.managedFolders]) {
    for (const aid of uniqueValidAids(folder.memberAids)) {
      allAids.add(aid)
    }
  }

  return {
    folders: [...ordinaryItems, ...managedItems],
    totalUniqueAidCount: allAids.size,
    protectedUniqueAidCount: protectedUniqueAids.size,
    protectedUniqueAids: Array.from(protectedUniqueAids).sort((left, right) => left - right),
    pendingUniqueAids
  }
}
