import { useEffect, useState } from 'react'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import {
  PET_COLLAPSE_FAREWELL_LINES,
  PET_EXPAND_GREETING_LINE,
  pickPetLine
} from './petInteractionLines'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger' | 'settings'

type AssistantSidebarProps = {
  onOpenInTab?: (url: string) => void
  onRefreshActiveTab?: () => void
}

export function AssistantSidebar({ onOpenInTab, onRefreshActiveTab }: AssistantSidebarProps = {}) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')

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
    return window.bilimiDesktop?.onOpenFloatingAssistantWorkspace?.(() => {
      setCollapsed(false)
    })
  }, [])

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <div
        className="assistant-sidebar__browser-toolbar"
        role="toolbar"
        aria-label="浏览器工具"
      >
        <button
          type="button"
          className="assistant-sidebar__tool-button assistant-sidebar__refresh-button"
          aria-label="刷新当前页"
          title="刷新当前页"
          onClick={() => onRefreshActiveTab?.()}
        >
          <span className="assistant-sidebar__refresh-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="assistant-sidebar__tool-button assistant-sidebar__collapse-button"
          aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          data-expanded={collapsed ? 'false' : 'true'}
          onClick={() => {
            if (collapsed) {
              expandSidebar()
              return
            }

            collapseSidebar()
          }}
        >
          <span className="assistant-sidebar__sidebar-icon" aria-hidden="true" />
        </button>
      </div>
      <div className="assistant-sidebar__workspace" hidden={collapsed}>
        <FloatingAssistantApp
          mode="sidebar"
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onRequestCollapse={collapseSidebar}
          onOpenInTab={onOpenInTab}
        />
      </div>
    </aside>
  )
}
