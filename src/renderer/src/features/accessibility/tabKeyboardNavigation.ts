import type { KeyboardEvent } from 'react'

export function nextTabIndex(key: string, currentIndex: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight') return (currentIndex + 1) % count
  if (key === 'ArrowLeft') return (currentIndex - 1 + count) % count
  return null
}

export function handleTabListKeyDown(
  event: KeyboardEvent<HTMLElement>,
  currentIndex: number,
  count: number,
  select: (index: number) => void
): void {
  const nextIndex = nextTabIndex(event.key, currentIndex, count)
  if (nextIndex === null) return
  event.preventDefault()
  select(nextIndex)
  event.currentTarget.closest('[role="tablist"]')
    ?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]
    ?.focus()
}
