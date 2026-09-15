import { useCallback, useEffect, useId, useState, type SetStateAction } from 'react'

const EVENT_NAME = 'bilimi:exclusive-menu-open'
const SCOPE_ATTRIBUTE = 'data-bilimi-exclusive-menu-id'

type ExclusiveMenuEvent = CustomEvent<{ id: string }>

function eventIsInsideScope(event: Event, id: string) {
  return event.composedPath().some((target) => target instanceof Element && target.getAttribute(SCOPE_ATTRIBUTE) === id)
}

export function useExclusiveMenu<T = boolean>(initial: T = false as T) {
  const id = useId()
  const [open, setOpen] = useState<T>(initial)
  const active = open !== false && open !== undefined && open !== null

  useEffect(() => {
    const closeOther = (event: Event) => {
      const detail = (event as ExclusiveMenuEvent).detail
      if (detail?.id !== id) setOpen(initial)
    }
    window.addEventListener(EVENT_NAME, closeOther)
    return () => window.removeEventListener(EVENT_NAME, closeOther)
  }, [id, initial])

  useEffect(() => {
    if (!active) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!eventIsInsideScope(event, id)) setOpen(initial)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(initial)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [active, id, initial])

  const setMenuOpen = useCallback((next: SetStateAction<T>) => {
    setOpen((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      if (resolved !== false && resolved !== undefined && resolved !== null) window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { id } }))
      return resolved
    })
  }, [id])

  return [open, setMenuOpen, { [SCOPE_ATTRIBUTE]: id }] as const
}
