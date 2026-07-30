import { normalizePetHoverShortcuts, type PetHoverShortcutId } from '@shared/petHoverShortcuts'

export type PetHoverShortcutFieldStore = {
  getSnapshot: () => PetHoverShortcutId[]
  set: (shortcuts: PetHoverShortcutId[]) => void
  subscribe: (listener: () => void) => () => void
}

export function createPetHoverShortcutFieldStore(initialValue: unknown): PetHoverShortcutFieldStore {
  let snapshot = normalizePetHoverShortcuts(initialValue)
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    set(value) {
      const next = normalizePetHoverShortcuts(value)
      if (next.length === snapshot.length && next.every((id, index) => id === snapshot[index])) return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
