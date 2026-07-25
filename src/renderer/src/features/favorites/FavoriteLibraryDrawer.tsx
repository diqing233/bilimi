import { useEffect, useRef, useState } from 'react'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import { FavoriteLibraryApp, type FavoriteLibraryDrawerStatus } from './FavoriteLibraryApp'
import { closeDurationFor, panelMotionTuning } from '../assistant/panelMotionTuning'

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
  onResizeActiveChange?: (active: boolean) => void
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

export function FavoriteLibraryDrawer({
  open,
  collapsed,
  onClose,
  onCollapsedChange,
  onResizeActiveChange
}: FavoriteLibraryDrawerProps) {
  const [height, setHeight] = useState(savedHeight)
  const [dragging, setDragging] = useState(false)
  const [account, setAccount] = useState<FavoriteLibraryAccount>()
  const [drawerStatus, setDrawerStatus] = useState<FavoriteLibraryDrawerStatus>()
  const [closing, setClosing] = useState(false)
  const [visible, setVisible] = useState(open)
  const [opening, setOpening] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const dragStartRef = useRef<{ clientY: number; height: number }>()
  const closeTimerRef = useRef<number | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const openingFrameRef = useRef<number | null>(null)
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

  useEffect(() => {
    if (open) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      if (!visible) {
        setVisible(true)
        setOpening(true)
        openingFrameRef.current = window.requestAnimationFrame(() => {
          openingFrameRef.current = null
          setOpening(false)
        })
      }
      setClosing(false)
      return
    }

    if (!visible) return

    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setClosing(false)
      setVisible(false)
    }, closeDurationFor(panelMotionTuning(), 'drawer-close'))
  }, [open, visible])

  useEffect(() => {
    if (!open && collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
      setCollapsing(false)
    }
  }, [open])

  useEffect(() => {
    if (collapsed) {
      setCollapsing(false)
    }
  }, [collapsed])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
    if (openingFrameRef.current !== null) window.cancelAnimationFrame(openingFrameRef.current)
  }, [])

  if (open) {
    hasBeenOpenedRef.current = true
  }

  if (!hasBeenOpenedRef.current || !visible) {
    return null
  }

  const beginDrawerCollapse = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
    }
    setCollapsing(true)
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      onCollapsedChange(true)
    }, closeDurationFor(panelMotionTuning(), 'drawer-collapse'))
  }

  const toggleDrawerCollapsed = () => {
    if (collapsing) {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current)
        collapseTimerRef.current = null
      }
      setCollapsing(false)
      return
    }

    if (!collapsed) {
      beginDrawerCollapse()
      return
    }

    onCollapsedChange(false)
    setOpening(true)
    openingFrameRef.current = window.requestAnimationFrame(() => {
      openingFrameRef.current = null
      setOpening(false)
    })
  }

  return (
    <section
      className="favorite-library-drawer"
      data-testid="favorite-library-drawer"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-collapsing={collapsing || undefined}
      data-closing={closing || undefined}
      data-opening={opening || undefined}
      style={collapsed ? undefined : { height: `${height}px` }}
      aria-label="收藏库"
      aria-hidden={!open || undefined}
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
          onResizeActiveChange?.(true)
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
          onResizeActiveChange?.(false)
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          if (shouldCollapse) beginDrawerCollapse()
        }}
        onPointerCancel={() => {
          dragStartRef.current = undefined
          setDragging(false)
          onResizeActiveChange?.(false)
        }}
        onDoubleClick={() => {
          setHeight(clampHeight(DEFAULT_HEIGHT))
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
          <button
            type="button"
            aria-label={collapsed ? '展开收藏库' : '收起收藏库'}
            title={collapsed ? '展开收藏库' : '收起收藏库'}
            onClick={toggleDrawerCollapsed}
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
