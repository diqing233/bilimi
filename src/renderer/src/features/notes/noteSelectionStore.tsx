import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

export type NoteSelectionSnapshot = {
  ids: ReadonlySet<string>
  count: number
}

const EMPTY_IDS = new Set<string>()
const EMPTY_SNAPSHOT: NoteSelectionSnapshot = { ids: EMPTY_IDS, count: 0 }

export class NoteSelectionStore {
  private snapshot = EMPTY_SNAPSHOT
  private listeners = new Set<() => void>()
  private idListeners = new Map<string, Set<() => void>>()

  getSnapshot = () => this.snapshot
  getSelectedIds = () => [...this.snapshot.ids]
  isSelected = (id: string) => this.snapshot.ids.has(id)

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeId = (id: string, listener: () => void) => {
    const listeners = this.idListeners.get(id) ?? new Set<() => void>()
    listeners.add(listener)
    this.idListeners.set(id, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) this.idListeners.delete(id)
    }
  }

  toggle = (id: string) => {
    const ids = new Set(this.snapshot.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    this.publish(ids, [id])
  }

  replace = (ids: Iterable<string>) => {
    const nextIds = new Set(ids)
    if (nextIds.size === this.snapshot.ids.size && [...nextIds].every((id) => this.snapshot.ids.has(id))) return
    const changedIds = new Set([...this.snapshot.ids, ...nextIds])
    for (const id of this.snapshot.ids) if (nextIds.has(id)) changedIds.delete(id)
    this.publish(nextIds, changedIds)
  }

  clear = () => this.replace([])

  retain = (availableIds: ReadonlySet<string>) => {
    this.replace([...this.snapshot.ids].filter((id) => availableIds.has(id)))
  }

  private publish(ids: Set<string>, changedIds: Iterable<string>) {
    this.snapshot = ids.size ? { ids, count: ids.size } : EMPTY_SNAPSHOT
    this.listeners.forEach((listener) => listener())
    for (const id of changedIds) this.idListeners.get(id)?.forEach((listener) => listener())
  }
}

export function NoteSelectionSubscriber({
  store,
  children
}: {
  store: NoteSelectionStore
  children: (snapshot: NoteSelectionSnapshot) => ReactNode
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return children(snapshot)
}

export function NoteSelectionCheckbox({
  store,
  id,
  label
}: {
  store: NoteSelectionStore
  id: string
  label: string
}) {
  const subscribe = useCallback((listener: () => void) => store.subscribeId(id, listener), [id, store])
  const getSnapshot = useCallback(() => store.isSelected(id), [id, store])
  const checked = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return <input type="checkbox" aria-label={label} checked={checked} onChange={() => store.toggle(id)} />
}
