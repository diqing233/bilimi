import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

export type FavoriteLibrarySelectionSnapshot = {
  selectedAids: number[]
  selectAllScope: boolean
  excludedAids: number[]
}

const EMPTY_SELECTION: FavoriteLibrarySelectionSnapshot = {
  selectedAids: [],
  selectAllScope: false,
  excludedAids: []
}

export class FavoriteLibrarySelectionStore {
  private snapshot = EMPTY_SELECTION
  private listeners = new Set<() => void>()
  private aidListeners = new Map<number, Set<() => void>>()

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeAid = (aid: number, listener: () => void) => {
    const listeners = this.aidListeners.get(aid) ?? new Set<() => void>()
    listeners.add(listener)
    this.aidListeners.set(aid, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.aidListeners.delete(aid)
    }
  }

  isAidSelected = (aid: number) => this.snapshot.selectAllScope
    ? !this.snapshot.excludedAids.includes(aid)
    : this.snapshot.selectedAids.includes(aid)

  clear = () => this.publish(EMPTY_SELECTION)

  toggleAid = (aid: number) => {
    const current = this.snapshot
    if (current.selectAllScope) {
      const excludedAids = current.excludedAids.includes(aid)
        ? current.excludedAids.filter((candidate) => candidate !== aid)
        : [...current.excludedAids, aid].sort((left, right) => left - right)
      this.publish({ ...current, excludedAids }, [aid])
      return
    }
    const selectedAids = current.selectedAids.includes(aid)
      ? current.selectedAids.filter((candidate) => candidate !== aid)
      : [...current.selectedAids, aid].sort((left, right) => left - right)
    this.publish({ ...current, selectedAids }, [aid])
  }

  toggleAll = () => {
    if (this.snapshot.selectAllScope) this.clear()
    else this.publish({ selectedAids: [], selectAllScope: true, excludedAids: [] })
  }

  private publish(snapshot: FavoriteLibrarySelectionSnapshot, changedAids?: readonly number[]) {
    const previous = this.snapshot
    this.snapshot = snapshot
    this.listeners.forEach((listener) => listener())
    if (changedAids) {
      changedAids.forEach((aid) => this.aidListeners.get(aid)?.forEach((listener) => listener()))
      return
    }
    const affected = new Set([...previous.selectedAids, ...previous.excludedAids, ...snapshot.selectedAids, ...snapshot.excludedAids])
    this.aidListeners.forEach((listeners, aid) => {
      if (previous.selectAllScope !== snapshot.selectAllScope || affected.has(aid)) listeners.forEach((listener) => listener())
    })
  }
}

export function FavoriteLibrarySelectionSubscriber({
  store,
  children
}: {
  store: FavoriteLibrarySelectionStore
  children: (snapshot: FavoriteLibrarySelectionSnapshot) => ReactNode
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return children(snapshot)
}

export function FavoriteLibrarySelectionCheckbox({
  store,
  aid,
  label
}: {
  store: FavoriteLibrarySelectionStore
  aid: number
  label: string
}) {
  const subscribe = useCallback((listener: () => void) => store.subscribeAid(aid, listener), [aid, store])
  const getSnapshot = useCallback(() => store.isAidSelected(aid), [aid, store])
  const checked = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return <input type="checkbox" aria-label={label} checked={checked} onClick={(event) => event.stopPropagation()} onChange={() => store.toggleAid(aid)} />
}
