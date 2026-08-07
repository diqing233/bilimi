import { useCallback, useEffect, useId, useState, type SetStateAction } from 'react'

const EVENT_NAME = 'bilimi:exclusive-menu-open'

type ExclusiveMenuEvent = CustomEvent<{ id: string }>

export function useExclusiveMenu<T = boolean>(initial: T = false as T) {
  const id = useId()
  const [open, setOpen] = useState<T>(initial)

  useEffect(() => {
    const closeOther = (event: Event) => {
      const detail = (event as ExclusiveMenuEvent).detail
      if (detail?.id !== id) setOpen(initial)
    }
    window.addEventListener(EVENT_NAME, closeOther)
    return () => window.removeEventListener(EVENT_NAME, closeOther)
  }, [id])

  const setMenuOpen = useCallback((next: SetStateAction<T>) => {
    setOpen((current) => {
      const resolved = typeof next === 'function' ? next(current) : next
      if (resolved !== false && resolved !== undefined && resolved !== null) window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { id } }))
      return resolved
    })
  }, [id])

  return [open, setMenuOpen] as const
}
