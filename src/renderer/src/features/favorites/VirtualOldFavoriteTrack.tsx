import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react'

const PREVIEW_CARD_PEEK_WIDTH = 56
const PREVIEW_CARD_GAP = 18
const FALLBACK_ITEM_WIDTH = 280
const MIN_ITEM_WIDTH = 160

type VirtualOldFavoriteTrackProps<T> = {
  ariaLabel: string
  items: readonly T[]
  itemKey: (item: T) => string | number
  renderItem: (item: T) => ReactNode
  className?: string
  overscan?: number
}

function VirtualOldFavoriteTrackInner<T>({
  ariaLabel,
  items,
  itemKey,
  renderItem,
  className,
  overscan = 3
}: VirtualOldFavoriteTrackProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const measuredSizeRef = useRef({ width: 0, itemWidth: FALLBACK_ITEM_WIDTH })
  const [windowState, setWindowState] = useState({ scrollLeft: 0, width: 0, itemWidth: FALLBACK_ITEM_WIDTH })
  const itemStep = windowState.itemWidth + PREVIEW_CARD_GAP
  const visibleCount = Math.max(1, Math.ceil((windowState.width || windowState.itemWidth * 2) / itemStep))
  const start = Math.max(0, Math.floor(windowState.scrollLeft / itemStep) - overscan)
  const end = Math.min(items.length, start + visibleCount + overscan * 2)
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])
  const updateWindowState = useCallback((element: HTMLDivElement, measureSize = false) => {
    const width = element.clientWidth
    let { itemWidth } = measuredSizeRef.current
    if (measureSize || measuredSizeRef.current.width !== width) {
      const computedStyle = getComputedStyle(element)
      const contentWidth = Math.max(0, width - parseFloat(computedStyle.paddingLeft || '0') - parseFloat(computedStyle.paddingRight || '0'))
      itemWidth = contentWidth > 0
        ? Math.max(MIN_ITEM_WIDTH, contentWidth - PREVIEW_CARD_PEEK_WIDTH)
        : FALLBACK_ITEM_WIDTH
      measuredSizeRef.current = { width, itemWidth }
    }
    setWindowState((current) => current.scrollLeft === element.scrollLeft && current.width === width && current.itemWidth === itemWidth
      ? current
      : { scrollLeft: element.scrollLeft, width, itemWidth })
  }, [])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    updateWindowState(event.currentTarget)
  }, [updateWindowState])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    updateWindowState(track, true)
    if (typeof ResizeObserver !== 'function') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => updateWindowState(track, true))
    })
    observer.observe(track)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [updateWindowState])

  return (
    <div
      ref={trackRef}
      className={className}
      aria-label={ariaLabel}
      data-virtualized="true"
      onScroll={onScroll}
    >
      <div
        className="favorite-ledger-panel__virtual-track-spacer"
        style={{ width: Math.max(0, items.length * itemStep - PREVIEW_CARD_GAP) }}
        aria-hidden="true"
      />
      {visibleItems.map((item, offset) => (
        <div
          key={itemKey(item)}
          className="favorite-ledger-panel__virtual-track-item"
          style={{ left: (start + offset) * itemStep, width: windowState.itemWidth, height: 'var(--old-favorite-preview-card-height)' }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

export const VirtualOldFavoriteTrack = memo(VirtualOldFavoriteTrackInner) as typeof VirtualOldFavoriteTrackInner
