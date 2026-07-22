import { useRef, useState } from 'react'
import { FavoriteLibraryApp } from './FavoriteLibraryApp'

const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 220
const RESERVED_BROWSER_HEIGHT = 180

type FavoriteLibraryDrawerProps = {
  open: boolean
  onClose: () => void
}

function clampHeight(height: number) {
  const maximum = Math.max(MIN_HEIGHT, window.innerHeight - RESERVED_BROWSER_HEIGHT)
  return Math.min(Math.max(height, MIN_HEIGHT), maximum)
}

export function FavoriteLibraryDrawer({ open, onClose }: FavoriteLibraryDrawerProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const dragStartRef = useRef<{ clientY: number; height: number }>()

  if (!open) {
    return null
  }

  return (
    <section
      className="favorite-library-drawer"
      data-testid="favorite-library-drawer"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={collapsed ? undefined : { height: `${height}px` }}
      aria-label="收藏库"
    >
      <div
        className="favorite-library-drawer__resize-handle"
        role="separator"
        aria-label="调整收藏库高度"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={Math.max(MIN_HEIGHT, window.innerHeight - RESERVED_BROWSER_HEIGHT)}
        aria-valuenow={height}
        onPointerDown={(event) => {
          dragStartRef.current = { clientY: event.clientY, height }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = dragStartRef.current
          if (!start) return
          setHeight(clampHeight(start.height + start.clientY - event.clientY))
        }}
        onPointerUp={(event) => {
          dragStartRef.current = undefined
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerCancel={() => {
          dragStartRef.current = undefined
        }}
      />
      <header className="favorite-library-drawer__header">
        <strong>收藏库</strong>
        <div className="favorite-library-drawer__actions">
          <button
            type="button"
            aria-label={collapsed ? '展开收藏库' : '收起收藏库'}
            title={collapsed ? '展开收藏库' : '收起收藏库'}
            onClick={() => setCollapsed((current) => !current)}
          >
            {collapsed ? '展开' : '收起'}
          </button>
          <button type="button" aria-label="关闭收藏库" title="关闭收藏库" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>
      <div className="favorite-library-drawer__body" hidden={collapsed}>
        <FavoriteLibraryApp embedded />
      </div>
    </section>
  )
}
