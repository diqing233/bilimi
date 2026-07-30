import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  PET_HOVER_SHORTCUT_LIMIT,
  PET_SORTABLE_HOVER_SHORTCUTS,
  normalizePetHoverShortcuts,
  type PetHoverShortcutId
} from '@shared/petHoverShortcuts'
import {
  createPetHoverShortcutFieldStore,
  type PetHoverShortcutFieldStore
} from './petHoverShortcutFieldStore'

type PetHoverShortcutSettingsProps = {
  value?: PetHoverShortcutId[]
  onCommit: (shortcuts: PetHoverShortcutId[]) => void
  fieldStore?: PetHoverShortcutFieldStore
}

export function PetHoverShortcutSettings({ value = [], onCommit, fieldStore }: PetHoverShortcutSettingsProps) {
  const fallbackStoreRef = useRef<PetHoverShortcutFieldStore | null>(null)
  if (!fallbackStoreRef.current) fallbackStoreRef.current = createPetHoverShortcutFieldStore(value)
  const authoritativeStore = fieldStore ?? fallbackStoreRef.current
  const authoritativeValue = useSyncExternalStore(
    authoritativeStore.subscribe,
    authoritativeStore.getSnapshot,
    authoritativeStore.getSnapshot
  )
  const [draft, setDraft] = useState(() => authoritativeValue)
  const draftRef = useRef(draft)
  const commitRef = useRef(onCommit)
  const commitTimerRef = useRef<number | null>(null)

  commitRef.current = onCommit

  useEffect(() => {
    if (fieldStore) return
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = null
    fallbackStoreRef.current?.set(value)
  }, [fieldStore, value])
  useEffect(() => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = null
    const authoritative = normalizePetHoverShortcuts(authoritativeValue)
    draftRef.current = authoritative
    setDraft(authoritative)
  }, [authoritativeValue])
  useEffect(() => () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
  }, [])

  function toggleShortcut(shortcutId: PetHoverShortcutId) {
    const current = draftRef.current
    const selected = current.includes(shortcutId)
    if (!selected && current.length >= PET_HOVER_SHORTCUT_LIMIT) return

    const next = normalizePetHoverShortcuts(
      selected ? current.filter((id) => id !== shortcutId) : [...current, shortcutId]
    )
    draftRef.current = next
    setDraft(next)
    if (fieldStore) {
      fieldStore.set(next)
      commitRef.current(next)
      return
    }
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current)
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null
      commitRef.current(draftRef.current)
    }, 0)
  }

  return PET_SORTABLE_HOVER_SHORTCUTS.map((shortcut) => {
    const selectedIndex = draft.indexOf(shortcut.id)
    const selected = selectedIndex >= 0
    const selectionFull = draft.length >= PET_HOVER_SHORTCUT_LIMIT
    const orderLabel = selected ? ` 第 ${selectedIndex + 1} 位` : ''

    return (
      <button
        key={shortcut.id}
        className="assistant-settings__hover-shortcut"
        type="button"
        aria-label={`${shortcut.label} ${shortcut.title}${orderLabel}`}
        aria-pressed={selected}
        disabled={!selected && selectionFull}
        onClick={() => toggleShortcut(shortcut.id)}
      >
        <span className="assistant-settings__hover-shortcut-mark">
          {selected ? selectedIndex + 1 : shortcut.label}
        </span>
        <span className="assistant-settings__hover-shortcut-copy">
          <strong>{shortcut.label}</strong>
          <small>{shortcut.title}</small>
        </span>
      </button>
    )
  })
}
