import { useEffect, useRef, useState } from 'react'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import { FavoriteLibraryApp, type FavoriteLibraryDrawerStatus } from './FavoriteLibraryApp'

const DEFAULT_HEIGHT = 360
const MIN_HEIGHT = 220
const COLLAPSE_SNAP_DISTANCE = 28
const KEYBOARD_HEIGHT_STEP = 24
const BROWSER_STACK_MIN_HEIGHT = 180
const DRAWER_RESIZE_HANDLE_HEIGHT = 6
const BROWSER_TAB_HEIGHT = 42
const COMPACT_BROWSER_TAB_HEIGHT = 38
const COMPACT_BROWSER_WIDTH = 1200
const COMPACT_BROWSER_HEIGHT = 760
const DRAWER_HEIGHT_STORAGE_KEY = 'bilimi:favorite-library-drawer-height'

type FavoriteLibraryDrawerProps = {
  open: boolean
  collapsed: boolean
  onClose: () => void
  onCollapsedChange: (collapsed: boolean) => void
}

type FavoriteLibraryAccount = { mid: string; nickname?: string }

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

function savedHeight() {
  const stored = Number(window.localStorage.getItem(DRAWER_HEIGHT_STORAGE_KEY))
  return clampHeight(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_HEIGHT)
}

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  return element.isConnected && !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden'
}

export function FavoriteLibraryDrawer({ open, collapsed, onClose, onCollapsedChange }: FavoriteLibraryDrawerProps) {
  const [height, setHeight] = useState(savedHeight)
  const [heightBeforeMaximize, setHeightBeforeMaximize] = useState<number>()
  const [dragging, setDragging] = useState(false)
  const [account, setAccount] = useState<FavoriteLibraryAccount>()
  const [drawerStatus, setDrawerStatus] = useState<FavoriteLibraryDrawerStatus>()
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
    window.localStorage.setItem(DRAWER_HEIGHT_STORAGE_KEY, String(height))
  }, [height])

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

  const maximized = heightBeforeMaximize !== undefined
  const toggleMaximumHeight = () => {
    if (maximized) {
      setHeight(clampHeight(heightBeforeMaximize))
      setHeightBeforeMaximize(undefined)
      return
    }
    setHeightBeforeMaximize(height)
    setHeight(maximumHeight())
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
          setDragging(true)
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = dragStartRef.current
          if (!start) return
          setHeight(clampHeight(start.height + start.clientY - event.clientY))
        }}
        onPointerUp={(event) => {
          const shouldCollapse = height <= MIN_HEIGHT + COLLAPSE_SNAP_DISTANCE
          dragStartRef.current = undefined
          setDragging(false)
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          if (shouldCollapse) onCollapsedChange(true)
        }}
        onPointerCancel={() => {
          dragStartRef.current = undefined
          setDragging(false)
        }}
        onDoubleClick={() => {
          setHeight(clampHeight(DEFAULT_HEIGHT))
          setHeightBeforeMaximize(undefined)
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
        <div className="favorite-library-drawer__title">
          <img className="favorite-library-drawer__brand-mark" src={workingPetUrl} alt="小咪收藏库" />
          <strong>小咪收藏库</strong>
          {account ? <span>{account.nickname ?? `UID：${account.mid}`}</span> : null}
        </div>
        <div className="favorite-library-drawer__actions">
          <button type="button" aria-label={maximized ? '恢复高度' : '拉到最高'} title={maximized ? '恢复高度' : '拉到最高'} onClick={toggleMaximumHeight}>
            {maximized ? '恢复高度' : '拉到最高'}
          </button>
          <button
            type="button"
            aria-label={collapsed ? '展开收藏库' : '收起收藏库'}
            title={collapsed ? '展开收藏库' : '收起收藏库'}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            {collapsed ? '展开' : '收起'}
          </button>
          <button type="button" aria-label="关闭收藏库" title="关闭收藏库" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>
      {drawerStatus?.hasRemoteAttention ? <div className="favorite-library-drawer__remote-warning" role="status">
        <span>远程操作待处理</span>
        <button type="button" onClick={drawerStatus.onGoToPending}>去待处理</button>
      </div> : null}
      <div className="favorite-library-drawer__body" data-dragging={dragging ? 'true' : undefined} hidden={collapsed}>
        <FavoriteLibraryApp embedded onAccountChange={setAccount} onDrawerStatusChange={setDrawerStatus} />
      </div>
    </section>
  )
}
