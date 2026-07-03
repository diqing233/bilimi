import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import {
  ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX,
  clampAssistantSidebarWidthPx
} from '@shared/assistantSidebarWidth'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import {
  PET_COLLAPSE_FAREWELL_LINES,
  PET_EXPAND_GREETING_LINE,
  pickPetLine
} from './petInteractionLines'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger' | 'settings'

type AssistantSidebarProps = {
  onOpenInTab?: (url: string) => void
}

export { ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX, clampAssistantSidebarWidthPx }

type SidebarDragState = {
  startClientX: number
  startWidth: number
  pointerId: number
  target: HTMLDivElement | null
}

export function AssistantSidebar({ onOpenInTab }: AssistantSidebarProps = {}) {
  const dragState = useRef<SidebarDragState | null>(null)
  const latestSidebarWidthPx = useRef<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')
  const [sidebarWidthPx, setSidebarWidthPx] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)

  latestSidebarWidthPx.current = sidebarWidthPx

  async function persistSidebarWidth(widthPx: number | null) {
    const currentPreferences = await window.bilimiDesktop?.loadPreferences?.()

    if (!currentPreferences || !window.bilimiDesktop?.savePreferences) {
      return
    }

    await window.bilimiDesktop.savePreferences({
      ...currentPreferences,
      assistantSidebarWidthPx: widthPx
    })
  }

  function collapseSidebar() {
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: 'sleepy',
      message: pickPetLine(PET_COLLAPSE_FAREWELL_LINES)
    })
    setCollapsed(true)
  }

  function expandSidebar() {
    setCollapsed(false)
    window.bilimiDesktop?.setAssistantPetHint?.({
      tone: 'hint',
      message: PET_EXPAND_GREETING_LINE
    })
  }

  useEffect(() => {
    return window.bilimiDesktop?.onOpenAssistant?.(() => {
      expandSidebar()
    })
  }, [])

  useEffect(() => {
    let disposed = false

    async function loadWidthPreference() {
      const preferences = await window.bilimiDesktop?.loadPreferences?.()

      if (!disposed && preferences?.assistantSidebarWidthPx) {
        setSidebarWidthPx(clampAssistantSidebarWidthPx(preferences.assistantSidebarWidthPx, window.innerWidth))
      }
    }

    void loadWidthPreference()

    return () => {
      disposed = true
    }
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
    function finishDrag() {
      const currentDrag = dragState.current

      if (!currentDrag) {
        return
      }

      dragState.current = null
      setResizing(false)
      try {
        currentDrag.target?.releasePointerCapture?.(currentDrag.pointerId)
      } catch {
        // Some runtimes throw if capture was already released.
      }
      void persistSidebarWidth(latestSidebarWidthPx.current)
    }

    function moveDrag(event: globalThis.PointerEvent) {
      const currentDrag = dragState.current

      if (!currentDrag) {
        return
      }

      if ((event.buttons & 1) !== 1) {
        dragState.current = null
        setResizing(false)
        try {
          currentDrag.target?.releasePointerCapture?.(currentDrag.pointerId)
        } catch {
          // Some runtimes throw if capture was already released.
        }
        void persistSidebarWidth(latestSidebarWidthPx.current)
        return
      }

      const widthDelta = currentDrag.startClientX - event.clientX
      setSidebarWidthPx(
        clampAssistantSidebarWidthPx(currentDrag.startWidth + widthDelta, window.innerWidth)
      )
    }

    window.addEventListener('pointermove', moveDrag)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)

    return () => {
      window.removeEventListener('pointermove', moveDrag)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
    }
  }, [])

  function beginSidebarResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    const startWidth =
      latestSidebarWidthPx.current ?? clampAssistantSidebarWidthPx(ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX, window.innerWidth)

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
    setSidebarWidthPx(startWidth)
    setResizing(true)
  }

  const sidebarStyle =
    sidebarWidthPx === null
      ? undefined
      : ({
          '--assistant-sidebar-width': `${sidebarWidthPx}px`
        } as CSSProperties)

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
      style={sidebarStyle}
    >
      <div
        className="assistant-sidebar__resize-handle"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        onPointerDown={beginSidebarResize}
        onDoubleClick={() => {
          dragState.current = null
          setSidebarWidthPx(null)
          void persistSidebarWidth(null)
        }}
      />
      {resizing ? <div className="assistant-sidebar__resize-shield" aria-hidden="true" /> : null}
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
      <div className="assistant-sidebar__workspace" hidden={collapsed}>
        <FloatingAssistantApp
          mode="sidebar"
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onRequestCollapse={collapseSidebar}
          onOpenInTab={onOpenInTab}
          workspaceRequestsEnabled={!collapsed}
        />
      </div>
    </aside>
  )
}
