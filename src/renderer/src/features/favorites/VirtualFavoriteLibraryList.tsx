import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'

export type FavoriteLibraryListItem = {
  aid: number
  title?: string
}

type VirtualFavoriteLibraryListProps<T extends FavoriteLibraryListItem> = {
  ariaLabel: string
  /** The current repository page only; never pass a repository-wide snapshot. */
  items: readonly T[]
  itemKey?: (item: T) => string | number
  itemHeight?: number
  height?: number
  overscan?: number
  className?: string
  /** Restores a cached viewport position without reloading the repository page. */
  scrollTop?: number
  /** Changes when a new result view must apply scrollTop even if its numeric value is unchanged. */
  scrollResetKey?: string | number
  /** Receives user-initiated scrolling so the account view cache can retain it. */
  onScrollTopChange?: (scrollTop: number) => void
  /** Called for visible rows only, so thumbnails can be requested lazily. */
  renderItem?: (item: T) => ReactNode
}

function normalizedScrollTop(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

const defaultItemKey = (item: FavoriteLibraryListItem) => item.aid

function VirtualFavoriteLibraryListInner<T extends FavoriteLibraryListItem>({
  ariaLabel,
  items,
  itemKey = defaultItemKey,
  itemHeight = 64,
  height = 600,
  overscan = 6,
  className,
  scrollTop,
  scrollResetKey,
  onScrollTopChange,
  renderItem = (item) => item.title ?? `Video ${item.aid}`
}: VirtualFavoriteLibraryListProps<T>) {
  const [viewport, setViewport] = useState(() => ({ scrollTop: normalizedScrollTop(scrollTop), height }))
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const listRef = useRef<HTMLDivElement>(null)
  const pendingProgrammaticScrollTop = useRef<number | null>(null)
  const settledScrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latestUserScrollTopRef = useRef<number | undefined>(undefined)
  const onScrollTopChangeRef = useRef(onScrollTopChange)
  const appliedScrollResetKeyRef = useRef(scrollResetKey)
  onScrollTopChangeRef.current = onScrollTopChange
  const observers = useRef(new Map<string, ResizeObserver>())
  const itemHeights = useMemo(() => items.map((item) => Math.max(itemHeight, measuredHeights[String(itemKey(item))] ?? 0)), [itemHeight, itemKey, items, measuredHeights])
  const offsets = useMemo(() => {
    const values = [0]
    for (const itemHeight of itemHeights) values.push(values.at(-1)! + itemHeight)
    return values
  }, [itemHeights])
  const maxScrollTop = Math.max(0, offsets.at(-1)! - viewport.height)
  const effectiveScrollTop = Math.min(viewport.scrollTop, maxScrollTop)
  const firstVisible = useMemo(() => {
    let low = 0
    let high = items.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (offsets[middle + 1] <= effectiveScrollTop) low = middle + 1
      else high = middle
    }
    return low
  }, [effectiveScrollTop, items.length, offsets])
  const visibleCount = Math.max(1, Math.ceil(viewport.height / itemHeight))
  const start = Math.max(0, firstVisible - overscan)
  const end = Math.min(items.length, firstVisible + visibleCount + overscan * 2)
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])
  useEffect(() => () => {
    observers.current.forEach((observer) => observer.disconnect())
    observers.current.clear()
    if (settledScrollTimerRef.current) clearTimeout(settledScrollTimerRef.current)
    if (latestUserScrollTopRef.current !== undefined) onScrollTopChangeRef.current?.(latestUserScrollTopRef.current)
  }, [])
  useEffect(() => {
    if (scrollTop === undefined) return
    const resetRequested = appliedScrollResetKeyRef.current !== scrollResetKey
    appliedScrollResetKeyRef.current = scrollResetKey
    if (!resetRequested && latestUserScrollTopRef.current !== undefined) return
    const requestedScrollTop = normalizedScrollTop(scrollTop)
    const nextScrollTop = Math.min(requestedScrollTop, maxScrollTop)
    if (listRef.current && listRef.current.scrollTop !== nextScrollTop) {
      pendingProgrammaticScrollTop.current = nextScrollTop
      listRef.current.scrollTop = nextScrollTop
    }
    setViewport((current) => current.scrollTop === nextScrollTop ? current : { ...current, scrollTop: nextScrollTop })
    if (nextScrollTop !== requestedScrollTop) onScrollTopChange?.(nextScrollTop)
  }, [maxScrollTop, onScrollTopChange, scrollResetKey, scrollTop])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const nextScrollTop = event.currentTarget.scrollTop
    setViewport({
      scrollTop: nextScrollTop,
      height: event.currentTarget.clientHeight || height
    })
    const isProgrammaticRestore = pendingProgrammaticScrollTop.current === nextScrollTop
    pendingProgrammaticScrollTop.current = null
    if (isProgrammaticRestore) {
      return
    }
    latestUserScrollTopRef.current = nextScrollTop
    if (settledScrollTimerRef.current) clearTimeout(settledScrollTimerRef.current)
    settledScrollTimerRef.current = setTimeout(() => {
      settledScrollTimerRef.current = undefined
      const settledScrollTop = latestUserScrollTopRef.current
      latestUserScrollTopRef.current = undefined
      if (settledScrollTop !== undefined) onScrollTopChangeRef.current?.(settledScrollTop)
    }, 150)
  }, [height])
  const observeRow = useCallback((key: string, element: HTMLDivElement | null) => {
    observers.current.get(key)?.disconnect()
    observers.current.delete(key)
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const measuredHeight = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
      setMeasuredHeights((current) => current[key] === measuredHeight ? current : { ...current, [key]: measuredHeight })
    })
    observer.observe(element)
    observers.current.set(key, observer)
  }, [])

  return (
    <div
      ref={listRef}
      role="list"
      aria-label={ariaLabel}
      className={className}
      data-virtualized="true"
      onScroll={onScroll}
      style={{ height, overflowY: 'auto', position: 'relative', contain: 'strict' }}
    >
      <div aria-hidden="true" style={{ height: offsets.at(-1) }} />
      {visibleItems.map((item, offset) => (
        <div
          key={itemKey(item)}
          ref={(element) => observeRow(String(itemKey(item)), element)}
          role="listitem"
          data-last-item={start + offset === items.length - 1 || undefined}
          style={{ position: 'absolute', insetInline: 0, top: offsets[start + offset], minHeight: itemHeight }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

export const VirtualFavoriteLibraryList = memo(VirtualFavoriteLibraryListInner) as typeof VirtualFavoriteLibraryListInner
