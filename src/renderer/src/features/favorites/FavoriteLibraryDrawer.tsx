import { useEffect, useRef, useState } from 'react'
import { FavoriteLibraryApp } from './FavoriteLibraryApp'

const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 220
const KEYBOARD_HEIGHT_STEP = 24
const BROWSER_STACK_MIN_HEIGHT = 180
const DRAWER_RESIZE_HANDLE_HEIGHT = 6
const BROWSER_TAB_HEIGHT = 42
const COMPACT_BROWSER_TAB_HEIGHT = 38
const COMPACT_BROWSER_WIDTH = 1200
const COMPACT_BROWSER_HEIGHT = 760

type FavoriteLibraryDrawerProps = {
  open: boolean
  onClose: () => void
}

function browserTabHeight() {
  return window.innerWidth <= COMPACT_BROWSER_WIDTH || window.innerHeight <= COMPACT_BROWSER_HEIGHT
    ? COMPACT_BROWSER_TAB_HEIGHT
    : BROWSER_TAB_HEIGHT
}

function maximumHeight() {
  return Math.max(
    MIN_HEIGHT,
    window.innerHeight - browserTabHeight() - DRAWER_RESIZE_HANDLE_HEIGHT - BROWSER_STACK_MIN_HEIGHT
  )
}

function clampHeight(height: number) {
  const maximum = maximumHeight()
  return Math.min(Math.max(height, MIN_HEIGHT), maximum)
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return element.isConnected && !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden'
}

export function FavoriteLibraryDrawer({ open, onClose }: FavoriteLibraryDrawerProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(() => clampHeight(DEFAULT_HEIGHT))
  const dragStartRef = useRef<{ clientY: number; height: number }>()
  const hasBeenOpenedRef = useRef(open)
  const wasOpenRef = useRef(open)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const reconcileHeight = () => setHeight((current) => clampHeight(current))
    window.addEventListener('resize', reconcileHeight)
    return () => window.removeEventListener('resize', reconcileHeight)
  }, [])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const activeElement = document.activeElement
      previousFocusRef.current = activeElement instanceof HTMLElement && isVisible(activeElement)
        ? activeElement
        : null
    } else if (!open && wasOpenRef.current) {
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
    wasOpenRef.current = open
  }, [open])

  if (open) {
    hasBeenOpenedRef.current = true
  }

  if (!hasBeenOpenedRef.current) {
    return null
  }

  return (
    <section
      className="favorite-library-drawer"
      data-testid="favorite-library-drawer"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={collapsed ? undefined : { height: `${height}px` }}
      aria-label="收藏库"
      aria-hidden={!open || undefined}
      hidden={!open}
    >
      <div
        className="favorite-library-drawer__resize-handle"
        role="separator"
        aria-label="调整收藏库高度"
        aria-orientation="horizontal"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={maximumHeight()}
        aria-valuenow={height}
        tabIndex={0}
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
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHeight((current) => clampHeight(current + KEYBOARD_HEIGHT_STEP))
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHeight((current) => clampHeight(current - KEYBOARD_HEIGHT_STEP))
          } else if (event.key === 'Home') {
            event.preventDefault()
            setHeight(MIN_HEIGHT)
          } else if (event.key === 'End') {
            event.preventDefault()
            setHeight(maximumHeight())
          }
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
