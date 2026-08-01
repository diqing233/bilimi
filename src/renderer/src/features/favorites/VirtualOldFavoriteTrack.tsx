import { memo, useCallback, useMemo, useState, type ReactNode, type UIEvent } from 'react'

type VirtualOldFavoriteTrackProps<T> = {
  ariaLabel: string
  items: readonly T[]
  itemKey: (item: T) => string | number
  itemWidth: number
  renderItem: (item: T) => ReactNode
  className?: string
  overscan?: number
}

function VirtualOldFavoriteTrackInner<T>({
  ariaLabel,
  items,
  itemKey,
  itemWidth,
  renderItem,
  className,
  overscan = 3
}: VirtualOldFavoriteTrackProps<T>) {
  const [windowState, setWindowState] = useState({ scrollLeft: 0, width: itemWidth * 2 })
  const visibleCount = Math.max(1, Math.ceil(windowState.width / itemWidth))
  const start = Math.max(0, Math.floor(windowState.scrollLeft / itemWidth) - overscan)
  const end = Math.min(items.length, start + visibleCount + overscan * 2)
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setWindowState({
      scrollLeft: event.currentTarget.scrollLeft,
      width: event.currentTarget.clientWidth || itemWidth * 2
    })
  }, [itemWidth])

  return (
    <div
      className={className}
      aria-label={ariaLabel}
      data-virtualized="true"
      onScroll={onScroll}
    >
      <div
        className="favorite-ledger-panel__virtual-track-spacer"
        style={{ width: items.length * itemWidth }}
        aria-hidden="true"
      />
      {visibleItems.map((item, offset) => (
        <div
          key={itemKey(item)}
          className="favorite-ledger-panel__virtual-track-item"
          style={{ left: (start + offset) * itemWidth, width: itemWidth, height: 'var(--old-favorite-preview-card-height)' }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

export const VirtualOldFavoriteTrack = memo(VirtualOldFavoriteTrackInner) as typeof VirtualOldFavoriteTrackInner
