import { useCallback, useSyncExternalStore, type ReactNode } from 'react'

export type FavoriteLedgerEnableEntry = {
  id: string
  enabled: boolean
  operable: boolean
  forceEnabledOnBulk?: boolean
  saveError?: string
}

type EnableSummary = {
  enabledCount: number
  operableCount: number
  allOperableEnabled: boolean
}

const EMPTY_SUMMARY: EnableSummary = { enabledCount: 0, operableCount: 0, allOperableEnabled: false }

export class FavoriteLedgerEnableStore {
  private entries = new Map<string, FavoriteLedgerEnableEntry>()
  private summary = EMPTY_SUMMARY
  private listeners = new Set<() => void>()
  private idListeners = new Map<string, Set<() => void>>()

  constructor(entries: FavoriteLedgerEnableEntry[]) {
    this.reset(entries)
  }

  getSummary = () => this.summary
  isEnabled = (id: string) => this.entries.get(id)?.enabled ?? false
  isOperable = (id: string) => this.entries.get(id)?.operable ?? false
  getSaveError = (id: string) => this.entries.get(id)?.saveError
  getEnabledById = () => new Map([...this.entries].map(([id, entry]) => [id, entry.enabled]))

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

  reset(entries: FavoriteLedgerEnableEntry[]) {
    const previous = this.entries
    this.entries = new Map(entries.map((entry) => [entry.id, { ...entry }]))
    const changed = new Set([...previous.keys(), ...this.entries.keys()])
    for (const id of [...changed]) {
      const before = previous.get(id)
      const after = this.entries.get(id)
      if (before?.enabled === after?.enabled && before?.operable === after?.operable && before?.saveError === after?.saveError) changed.delete(id)
    }
    this.publish(changed)
  }

  reconcile(entries: FavoriteLedgerEnableEntry[]) {
    const next = entries.map((entry) => ({
      ...entry,
      enabled: this.entries.get(entry.id)?.enabled ?? entry.enabled,
      saveError: this.entries.get(entry.id)?.saveError
    }))
    this.reset(next)
  }

  replaceEnabled(enabledById: ReadonlyMap<string, boolean>) {
    const changed: string[] = []
    for (const [id, entry] of this.entries) {
      const enabled = enabledById.get(id)
      if (enabled === undefined || enabled === entry.enabled) continue
      this.entries.set(id, { ...entry, enabled })
      changed.push(id)
    }
    this.publish(changed)
  }

  setEnabled(id: string, enabled: boolean) {
    const entry = this.entries.get(id)
    if (!entry || entry.enabled === enabled) return false
    this.entries.set(id, { ...entry, enabled })
    const enabledCount = this.summary.enabledCount + (enabled ? 1 : -1)
    this.summary = {
      ...this.summary,
      enabledCount,
      allOperableEnabled: this.summary.operableCount > 0 && enabledCount === this.summary.operableCount
    }
    this.idListeners.get(id)?.forEach((listener) => listener())
    this.listeners.forEach((listener) => listener())
    return true
  }

  setSaveError(id: string, saveError: string | undefined) {
    const entry = this.entries.get(id)
    if (!entry || entry.saveError === saveError) return false
    this.entries.set(id, { ...entry, saveError })
    this.idListeners.get(id)?.forEach((listener) => listener())
    return true
  }

  toggle(id: string) {
    const entry = this.entries.get(id)
    if (!entry?.operable) return false
    const enabled = !entry.enabled
    this.entries.set(id, { ...entry, enabled })
    const enabledCount = this.summary.enabledCount + (enabled ? 1 : -1)
    this.summary = {
      ...this.summary,
      enabledCount,
      allOperableEnabled: this.summary.operableCount > 0 && enabledCount === this.summary.operableCount
    }
    this.idListeners.get(id)?.forEach((listener) => listener())
    this.listeners.forEach((listener) => listener())
    return true
  }

  toggleAll() {
    const enable = !this.summary.allOperableEnabled
    const changed: string[] = []
    for (const [id, entry] of this.entries) {
      const enabled = entry.forceEnabledOnBulk ? true : entry.operable ? enable : entry.enabled
      if (enabled === entry.enabled) continue
      this.entries.set(id, { ...entry, enabled })
      changed.push(id)
    }
    this.publish(changed)
    return changed.length > 0
  }

  private publish(changedIds: Iterable<string>) {
    const operable = [...this.entries.values()].filter((entry) => entry.operable)
    const nextSummary = operable.length
      ? {
          enabledCount: operable.filter((entry) => entry.enabled).length,
          operableCount: operable.length,
          allOperableEnabled: operable.every((entry) => entry.enabled)
        }
      : EMPTY_SUMMARY
    const summaryChanged = nextSummary.enabledCount !== this.summary.enabledCount ||
      nextSummary.operableCount !== this.summary.operableCount ||
      nextSummary.allOperableEnabled !== this.summary.allOperableEnabled
    this.summary = nextSummary
    for (const id of changedIds) this.idListeners.get(id)?.forEach((listener) => listener())
    if (summaryChanged) this.listeners.forEach((listener) => listener())
  }
}

export function FavoriteLedgerEnableButton({
  store,
  id,
  onToggle,
  children
}: {
  store: FavoriteLedgerEnableStore
  id: string
  onToggle?: () => void
  children: (state: { enabled: boolean; saveError: string | undefined; toggle: () => void }) => ReactNode
}) {
  const subscribe = useCallback((listener: () => void) => store.subscribeId(id, listener), [id, store])
  const getSnapshot = useCallback(() => store.isEnabled(id), [id, store])
  const getSaveError = useCallback(() => store.getSaveError(id), [id, store])
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const saveError = useSyncExternalStore(subscribe, getSaveError, getSaveError)
  return children({ enabled, saveError, toggle: onToggle ?? (() => { store.toggle(id) }) })
}

export function FavoriteLedgerEnableSummary({
  store,
  children
}: {
  store: FavoriteLedgerEnableStore
  children: (summary: EnableSummary) => ReactNode
}) {
  const summary = useSyncExternalStore(store.subscribe, store.getSummary, store.getSummary)
  return children(summary)
}
