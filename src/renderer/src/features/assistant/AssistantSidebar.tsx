import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { FloatingAssistantWorkspaceRequest } from './assistantRuntimeTypes'
import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX,
  clampAssistantSidebarWidthPx,
  getAssistantSidebarDefaultWidthPx
} from '@shared/assistantSidebarWidth'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import {
  PET_COLLAPSE_FAREWELL_LINES,
  PET_EXPAND_GREETING_LINE,
  pickPetLine
} from './petInteractionLines'
import { closeDurationFor, panelMotionTuning } from './panelMotionTuning'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger' | 'settings'

type AssistantSidebarProps = {
  onOpenInTab?: (url: string) => void
  onResizeActiveChange?: (active: boolean) => void
}

export { ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX, clampAssistantSidebarWidthPx }

type SidebarDragState = {
  startClientX: number
  startWidth: number
  pointerId: number
  target: HTMLDivElement | null
}

const SIDEBAR_WIDTH_SAVE_DELAY_MS = 200

type SidebarWorkspaceProps = {
  activeTab: AssistantSidebarTab
  onActiveTabChange: (tab: AssistantSidebarTab) => void
  onRequestCollapse: () => void
  onOpenInTab?: (url: string) => void
  workspaceRequest: (Pick<FloatingAssistantWorkspaceRequest, 'tab' | 'ledgerId' | 'ledgerTitle' | 'createLedger' | 'openNoteArchive' | 'archiveId' | 'versionId' | 'organizeOldFavorites' | 'selectedFavoriteAids' | 'selectedFavoriteSelection'> & { requestId: number }) | undefined
}

const SidebarWorkspace = memo(function SidebarWorkspace({
  activeTab,
  onActiveTabChange,
  onRequestCollapse,
  onOpenInTab,
  workspaceRequest
}: SidebarWorkspaceProps) {
  return (
    <FloatingAssistantApp
      mode="sidebar"
      activeTab={activeTab}
      onActiveTabChange={onActiveTabChange}
      onRequestCollapse={onRequestCollapse}
      onOpenInTab={onOpenInTab}
      workspaceRequestsEnabled={false}
      workspaceRequest={workspaceRequest}
    />
  )
})

export function AssistantSidebar({ onOpenInTab, onResizeActiveChange }: AssistantSidebarProps = {}) {
  const dragState = useRef<SidebarDragState | null>(null)
  const latestSidebarWidthPx = useRef<number | null>(null)
  const sidebarShell = useRef<HTMLDivElement | null>(null)
  const sidebarPanel = useRef<HTMLElement | null>(null)
  const pendingWidthSave = useRef<number | null | undefined>(undefined)
  const widthSavesInFlight = useRef(0)
  const widthSaveTimer = useRef<number | null>(null)
  const widthInteractionStarted = useRef(false)
  const closeTimer = useRef<number | null>(null)
  const openingFrame = useRef<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const workspaceRequestVersion = useRef(0)
  const [workspaceRequest, setWorkspaceRequest] = useState<(Pick<FloatingAssistantWorkspaceRequest, 'tab' | 'ledgerId' | 'ledgerTitle' | 'createLedger' | 'openNoteArchive' | 'archiveId' | 'versionId' | 'organizeOldFavorites' | 'selectedFavoriteAids' | 'selectedFavoriteSelection'> & { requestId: number }) | undefined>()

  latestSidebarWidthPx.current = sidebarWidthPx

  async function persistSidebarWidth(widthPx: number | null) {
    widthSavesInFlight.current += 1
    try {
      await window.bilimiDesktop?.saveAssistantSidebarWidth?.(widthPx)
    } catch {
      // Width remains locally applied; a later drag can issue the next save.
    } finally {
      widthSavesInFlight.current -= 1
    }
  }

  function applySidebarWidth(widthPx: number | null) {
    latestSidebarWidthPx.current = widthPx
    const value = widthPx === null ? '' : `${widthPx}px`
    sidebarShell.current?.style.setProperty('--assistant-sidebar-width', value)
    sidebarPanel.current?.style.setProperty('--assistant-sidebar-width', value)
  }

  function scheduleSidebarWidthSave(widthPx: number | null) {
    pendingWidthSave.current = widthPx
    if (widthSaveTimer.current !== null) window.clearTimeout(widthSaveTimer.current)
    widthSaveTimer.current = window.setTimeout(() => {
      widthSaveTimer.current = null
      const pendingWidth = pendingWidthSave.current
      pendingWidthSave.current = undefined
      if (pendingWidth !== undefined) void persistSidebarWidth(pendingWidth)
    }, SIDEBAR_WIDTH_SAVE_DELAY_MS)
  }

  function cancelPendingSidebarWidthSave() {
    if (widthSaveTimer.current !== null) {
      window.clearTimeout(widthSaveTimer.current)
      widthSaveTimer.current = null
    }
    pendingWidthSave.current = undefined
  }

  const collapseSidebar = useCallback(() => {
    if (openingFrame.current !== null) {
      window.cancelAnimationFrame(openingFrame.current)
      openingFrame.current = null
    }
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: 'sleepy',
      message: pickPetLine(PET_COLLAPSE_FAREWELL_LINES)
    })
    setCollapsed(true)
    setClosing(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setClosing(false)
    }, closeDurationFor(panelMotionTuning(), 'sidebar-collapse'))
  }, [])

  const expandSidebar = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosing(false)
    setCollapsed(false)
    setOpening(true)
    if (openingFrame.current !== null) window.cancelAnimationFrame(openingFrame.current)
    openingFrame.current = window.requestAnimationFrame(() => {
      openingFrame.current = null
      setOpening(false)
    })
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: 'hint',
      message: PET_EXPAND_GREETING_LINE
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onOpenAssistant?.(() => {
      expandSidebar()
    })
  }, [])

  useEffect(() => window.bilimiDesktop?.onOpenFloatingAssistantWorkspace?.((payload) => {
    // Pet-originated workspace commands remain in their floating host. Drawer commands explicitly target the persistent sidebar.
    if (!payload.ledgerId && !payload.sidebar) return
    expandSidebar()
    setWorkspaceRequest({
      tab: payload.tab,
      ledgerId: payload.ledgerId,
      ledgerTitle: payload.ledgerTitle,
      createLedger: payload.createLedger,
      openNoteArchive: payload.openNoteArchive,
      archiveId: payload.archiveId,
      versionId: payload.versionId,
      organizeOldFavorites: payload.organizeOldFavorites,
      selectedFavoriteAids: payload.selectedFavoriteAids,
      selectedFavoriteSelection: payload.selectedFavoriteSelection,
      requestId: ++workspaceRequestVersion.current
    })
  }), [])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    if (openingFrame.current !== null) window.cancelAnimationFrame(openingFrame.current)
    if (widthSaveTimer.current !== null) {
      window.clearTimeout(widthSaveTimer.current)
      widthSaveTimer.current = null
      const pendingWidth = pendingWidthSave.current
      pendingWidthSave.current = undefined
      if (pendingWidth !== undefined) void persistSidebarWidth(pendingWidth)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    async function loadWidthPreference() {
      const widthPx = await window.bilimiDesktop?.loadAssistantSidebarWidth?.()
      if (disposed || widthPx === undefined || widthInteractionStarted.current) return
      setSidebarWidthPx(
        widthPx === null ? null : clampAssistantSidebarWidthPx(widthPx, window.innerWidth)
      )
    }

    void loadWidthPreference()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantSidebarWidthChanged?.((widthPx) => {
      if (widthPx === null) {
        widthInteractionStarted.current = true
        cancelPendingSidebarWidthSave()
        applySidebarWidth(null)
        setSidebarWidthPx(null)
        return
      }
      if (
        dragState.current ||
        pendingWidthSave.current !== undefined ||
        widthSavesInFlight.current > 0
      ) return
      widthInteractionStarted.current = true
      const nextWidth = clampAssistantSidebarWidthPx(widthPx, window.innerWidth)
      if (nextWidth === latestSidebarWidthPx.current) return
      setSidebarWidthPx(nextWidth)
    })
  }, [])

  useEffect(() => {
    if (sidebarWidthPx === null) {
      return
    }

    function handleWindowResize() {
      setSidebarWidthPx((currentWidth) =>
        currentWidth === null ? null : clampAssistantSidebarWidthPx(currentWidth, window.innerWidth)
      )
    }

    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [sidebarWidthPx])

  useEffect(() => {
    function finishDrag(event?: Event) {
      const currentDrag = dragState.current

      if (!currentDrag) {
        return
      }
      if (event && 'pointerId' in event && event.pointerId !== currentDrag.pointerId) {
        return
      }

      dragState.current = null
      setResizing(false)
      onResizeActiveChange?.(false)
      try {
        currentDrag.target?.releasePointerCapture?.(currentDrag.pointerId)
      } catch {
        // Some runtimes throw if capture was already released.
      }
      setSidebarWidthPx(latestSidebarWidthPx.current)
      scheduleSidebarWidthSave(latestSidebarWidthPx.current)
    }

    function moveDrag(event: globalThis.PointerEvent) {
      const currentDrag = dragState.current

      if (!currentDrag) {
        return
      }
      if (event.pointerId !== currentDrag.pointerId) {
        return
      }

      if ((event.buttons & 1) !== 1) {
        dragState.current = null
        setResizing(false)
        onResizeActiveChange?.(false)
        try {
          currentDrag.target?.releasePointerCapture?.(currentDrag.pointerId)
        } catch {
          // Some runtimes throw if capture was already released.
        }
        setSidebarWidthPx(latestSidebarWidthPx.current)
        scheduleSidebarWidthSave(latestSidebarWidthPx.current)
        return
      }

      const widthDelta = currentDrag.startClientX - event.clientX
      applySidebarWidth(
        clampAssistantSidebarWidthPx(currentDrag.startWidth + widthDelta, window.innerWidth)
      )
    }

    window.addEventListener('pointermove', moveDrag)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('lostpointercapture', finishDrag)
    window.addEventListener('blur', finishDrag)

    return () => {
      window.removeEventListener('pointermove', moveDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('lostpointercapture', finishDrag)
      window.removeEventListener('blur', finishDrag)
    }
  }, [onResizeActiveChange])

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    widthInteractionStarted.current = true
    const startWidth =
      latestSidebarWidthPx.current ??
      clampAssistantSidebarWidthPx(getAssistantSidebarDefaultWidthPx(window.innerWidth), window.innerWidth)

    dragState.current = {
      startClientX: event.clientX,
      startWidth,
      pointerId: event.pointerId,
      target: event.currentTarget
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture is a best-effort guard; the resize shield still protects webviews.
    }
    applySidebarWidth(startWidth)
    setResizing(true)
    onResizeActiveChange?.(true)
  }

  const sidebarStyle =
    sidebarWidthPx === null
      ? undefined
      : ({
          '--assistant-sidebar-width': `${sidebarWidthPx}px`
        } as CSSProperties)

  return (
    <div
      ref={sidebarShell}
      className="assistant-sidebar-shell"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-closing={closing || undefined}
      data-opening={opening || undefined}
      style={sidebarStyle}
    >
    <aside
      ref={sidebarPanel}
      className="assistant-sidebar"
      aria-label="bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
      data-closing={closing || undefined}
      data-opening={opening || undefined}
      style={sidebarStyle}
    >
      <div
        className="assistant-sidebar__resize-handle"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        onPointerDown={beginSidebarResize}
        onDoubleClick={() => {
          widthInteractionStarted.current = true
          if (dragState.current) onResizeActiveChange?.(false)
          dragState.current = null
          applySidebarWidth(null)
          setSidebarWidthPx(null)
          scheduleSidebarWidthSave(null)
        }}
      />
      {resizing ? <div className="assistant-sidebar__resize-shield" aria-hidden="true" /> : null}
      <div className="assistant-sidebar__workspace" hidden={collapsed && !closing}>
        <SidebarWorkspace
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onRequestCollapse={collapseSidebar}
          onOpenInTab={onOpenInTab}
          workspaceRequest={workspaceRequest}
        />
      </div>
    </aside>
    <button
      type="button"
      className="assistant-sidebar__collapse-button"
      aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
      onClick={() => {
        if (collapsed) {
          expandSidebar()
          return
        }

        collapseSidebar()
      }}
    >
      <img
        className="assistant-sidebar__collapse-pet"
        src={idlePetUrl}
        alt={collapsed ? '小咪展开侧栏' : '小咪收起侧栏'}
      />
      <span className="assistant-sidebar__collapse-label" aria-hidden="true">
        {collapsed ? '展开' : '折叠'}
      </span>
    </button>
    </div>
  )
}
