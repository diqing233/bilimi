import { memo, useCallback, useMemo, useState, type ReactNode, type UIEvent } from 'react'

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
  /** Called for visible rows only, so thumbnails can be requested lazily. */
  renderItem?: (item: T) => ReactNode
}

function VirtualFavoriteLibraryListInner<T extends FavoriteLibraryListItem>({
  ariaLabel,
  items,
  itemKey = (item) => item.aid,
  itemHeight = 64,
  height = 600,
  overscan = 6,
  className,
  renderItem = (item) => item.title ?? `Video ${item.aid}`
}: VirtualFavoriteLibraryListProps<T>) {
  const [viewport, setViewport] = useState({ scrollTop: 0, height })
  const visibleCount = Math.max(1, Math.ceil(viewport.height / itemHeight))
  const start = Math.max(0, Math.floor(viewport.scrollTop / itemHeight) - overscan)
  const end = Math.min(items.length, start + visibleCount + overscan * 2)
  const visibleItems = useMemo(() => items.slice(start, end), [end, items, start])
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setViewport({
      scrollTop: event.currentTarget.scrollTop,
      height: event.currentTarget.clientHeight || height
    })
  }, [height])

  return (
    <div
      role="list"
      aria-label={ariaLabel}
      className={className}
      data-virtualized="true"
      onScroll={onScroll}
      style={{ height, overflowY: 'auto', position: 'relative', contain: 'strict' }}
    >
      <div aria-hidden="true" style={{ height: items.length * itemHeight }} />
      {visibleItems.map((item, offset) => (
        <div
          key={itemKey(item)}
          role="listitem"
          style={{ position: 'absolute', insetInline: 0, top: (start + offset) * itemHeight, height: itemHeight }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  )
}

export const VirtualFavoriteLibraryList = memo(VirtualFavoriteLibraryListInner) as typeof VirtualFavoriteLibraryListInner
