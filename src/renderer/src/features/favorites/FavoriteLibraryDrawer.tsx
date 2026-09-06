import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import { FavoriteLibraryApp, type FavoriteLibraryDrawerStatus, type FavoriteLibraryUiCallbacks } from './FavoriteLibraryApp'
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
  collapsed?: boolean
  onClose: () => void
  onCollapsedChange?: (collapsed: boolean) => void
  onResizeActiveChange?: (active: boolean) => void
  uiCallbacks?: FavoriteLibraryUiCallbacks
}

export type FavoriteLibraryDrawerHandle = {
  expand: () => void
  isCollapsed: () => boolean
}

type FavoriteLibraryAccount = { mid: string; nickname?: string }

const FavoriteLibraryWorkspace = memo(FavoriteLibraryApp)

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

export const FavoriteLibraryDrawer = forwardRef<FavoriteLibraryDrawerHandle, FavoriteLibraryDrawerProps>(function FavoriteLibraryDrawer({
  open,
  collapsed: controlledCollapsed,
  onClose,
  onCollapsedChange,
  onResizeActiveChange,
  uiCallbacks
}, forwardedRef) {
  const controlled = controlledCollapsed !== undefined
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false)
  const collapsed = controlled ? controlledCollapsed : uncontrolledCollapsed
  const [height, setHeight] = useState(savedHeight)
  const [dragging, setDragging] = useState(false)
  const [account, setAccount] = useState<FavoriteLibraryAccount>()
  const [drawerStatus, setDrawerStatus] = useState<FavoriteLibraryDrawerStatus>()
  const [closing, setClosing] = useState(false)
  const [visible, setVisible] = useState(open)
  const [opening, setOpening] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  const [maximizing, setMaximizing] = useState(false)
  const [maximizeStartHeight, setMaximizeStartHeight] = useState<number>()
  const drawerRef = useRef<HTMLElement>(null)
  const liveHeightRef = useRef(height)
  const dragStartRef = useRef<{ clientY: number; height: number } | undefined>(undefined)
  const closeTimerRef = useRef<number | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const openingFrameRef = useRef<number | null>(null)
  const maximizeFrameRef = useRef<number | null>(null)
  const maximizeTimerRef = useRef<number | null>(null)
  const hasBeenOpenedRef = useRef(open)
  const wasOpenRef = useRef(open)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const collapsedRef = useRef(collapsed)
  collapsedRef.current = collapsed

  useEffect(() => {
    if (!controlled || collapseTimerRef.current === null) return
    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
    setCollapsing(false)
  }, [controlled, controlledCollapsed])

  useEffect(() => {
    const reconcileHeight = () => setHeight((current) => clampHeight(current))
    window.addEventListener('resize', reconcileHeight)
    return () => window.removeEventListener('resize', reconcileHeight)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(DRAWER_HEIGHT_STORAGE_KEY, String(height))
  }, [height])

  liveHeightRef.current = height

  const applyLiveHeight = (nextHeight: number) => {
    liveHeightRef.current = nextHeight
    drawerRef.current?.style.setProperty('height', `${nextHeight}px`)
  }

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

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current)
    if (openingFrameRef.current !== null) window.cancelAnimationFrame(openingFrameRef.current)
    if (maximizeFrameRef.current !== null) window.cancelAnimationFrame(maximizeFrameRef.current)
    if (maximizeTimerRef.current !== null) window.clearTimeout(maximizeTimerRef.current)
  }, [])

  useImperativeHandle(forwardedRef, () => ({
    expand: () => {
      if (!collapsedRef.current) return
      if (!controlled) setUncontrolledCollapsed(false)
      onCollapsedChange?.(false)
      setOpening(true)
      openingFrameRef.current = window.requestAnimationFrame(() => {
        openingFrameRef.current = null
        setOpening(false)
      })
    },
    isCollapsed: () => collapsedRef.current
  }), [controlled, onCollapsedChange])

  if (open) {
    hasBeenOpenedRef.current = true
  }

  if (!hasBeenOpenedRef.current) {
    return null
  }

  const beginDrawerCollapse = () => {
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current)
    }
    setCollapsing(true)
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null
      setCollapsing(false)
      if (!controlled) setUncontrolledCollapsed(true)
      onCollapsedChange?.(true)
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

    if (!controlled) setUncontrolledCollapsed(false)
    onCollapsedChange?.(false)
    setOpening(true)
    openingFrameRef.current = window.requestAnimationFrame(() => {
      openingFrameRef.current = null
      setOpening(false)
    })
  }

  const expandAndMaximize = () => {
    if (maximizing) return
    const next = maximumHeight()
    if (!collapsed && height === next) return
    setMaximizing(true)
    const finish = () => {
      maximizeTimerRef.current = window.setTimeout(() => {
        maximizeTimerRef.current = null
        setMaximizing(false)
      }, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1 : panelMotionTuning().drawerExpandMs)
    }
    if (collapsed) {
      const startHeight = Math.max(MIN_HEIGHT, drawerRef.current?.getBoundingClientRect().height ?? MIN_HEIGHT)
      setMaximizeStartHeight(startHeight)
      if (!controlled) setUncontrolledCollapsed(false)
      onCollapsedChange?.(false)
      maximizeFrameRef.current = window.requestAnimationFrame(() => {
        maximizeFrameRef.current = null
        setMaximizeStartHeight(undefined)
        setHeight(next)
        finish()
      })
      return
    }
    setHeight(next)
    finish()
  }

  const notices = drawerStatus?.notices ?? []
  const activeNotice = notices[0]
  const additionalNoticeCount = Math.max(0, notices.length - 1)

  return (
    <section
      ref={drawerRef}
      className="favorite-library-drawer"
      data-testid="favorite-library-drawer"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-collapsing={collapsing || undefined}
      data-closing={closing || undefined}
      data-opening={opening || undefined}
      data-maximizing={maximizing || undefined}
      style={open ? (collapsed ? undefined : {
        height: `${maximizeStartHeight ?? height}px`,
        '--favorite-library-drawer-height-duration': `${panelMotionTuning().drawerExpandMs}ms`
      } as React.CSSProperties) : { display: 'none' }}
      aria-label="收藏库"
      aria-hidden={!open || undefined}
      inert={!open}
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
          applyLiveHeight(clampHeight(start.height + start.clientY - event.clientY))
        }}
        onPointerUp={(event) => {
          const finalHeight = liveHeightRef.current
          const shouldCollapse = finalHeight <= MIN_HEIGHT + COLLAPSE_SNAP_DISTANCE
          dragStartRef.current = undefined
          setDragging(false)
          setHeight(finalHeight)
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
      <header className="favorite-library-drawer__header" role="banner" aria-label="小咪收藏库">
        <div className="favorite-library-drawer__title">
          <img className="favorite-library-drawer__brand-mark" src={workingPetUrl} alt="小咪收藏库" />
          <strong>小咪收藏库{account ? <span className="favorite-library-drawer__account">{`（${account.nickname ?? `UID：${account.mid}`}）`}</span> : null}</strong>
        </div>
        {activeNotice ? <div className="favorite-library-drawer__notice" role="status" title={activeNotice.message}>
          <span aria-hidden="true">⚠</span>
          <span className="favorite-library-drawer__notice-message">{activeNotice.message}</span>
          {additionalNoticeCount ? <span className="favorite-library-drawer__notice-more">另有{additionalNoticeCount}条</span> : null}
          <button type="button" onClick={activeNotice.onActivate}>{activeNotice.actionLabel ?? '查看'}</button>
        </div> : null}
        <div className="favorite-library-drawer__actions">
          <button type="button" aria-label="展开并拉到最高" title="展开并拉到最高" disabled={maximizing} onClick={expandAndMaximize}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h14M12 19V8m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
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
      <div className="favorite-library-drawer__body" data-dragging={dragging ? 'true' : undefined} hidden={collapsed}>
        <FavoriteLibraryWorkspace embedded active={open && !collapsed} onAccountChange={setAccount} onDrawerStatusChange={setDrawerStatus} uiCallbacks={uiCallbacks} />
      </div>
    </section>
  )
})
