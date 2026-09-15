import { memo, useCallback, useMemo, useState, type ReactNode, type UIEvent } from 'react'

type VirtualOldFavoriteListProps<T> = {
  ariaLabel: string
  items: readonly T[]
  itemKey: (item: T) => string | number
  itemHeight: number
  height: number
  renderItem: (item: T) => ReactNode
  overscan?: number
  revision?: unknown
  className?: string
}

function VirtualOldFavoriteListInner<T>({
  ariaLabel,
  items,
  itemKey,
  itemHeight,
  height,
  renderItem,
  overscan = 4,
  className
}: VirtualOldFavoriteListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const visibleCount = Math.ceil(height / itemHeight)
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const end = Math.min(items.length, start + visibleCount + overscan * 2)
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    setScrollTop(event.currentTarget.scrollTop)
  }, [])

  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={className}
      style={{ height, overflowY: 'auto', position: 'relative' }}
      onScroll={onScroll}
    >
      <div aria-hidden="true" style={{ height: items.length * itemHeight }} />
      {visibleItems.map((item, offset) => (
        <div
          key={itemKey(item)}
          role="listitem"
          style={{
            position: 'absolute',
            insetInline: 0,
            top: (start + offset) * itemHeight,
            height: itemHeight
          }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

export const VirtualOldFavoriteList = memo(VirtualOldFavoriteListInner) as typeof VirtualOldFavoriteListInner
