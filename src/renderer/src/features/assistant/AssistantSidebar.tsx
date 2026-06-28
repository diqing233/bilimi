import { useEffect, useState } from 'react'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { FloatingAssistantApp } from './FloatingAssistantApp'
import {
  PET_COLLAPSE_FAREWELL_LINES,
  PET_EXPAND_GREETING_LINE,
  pickPetLine
} from './petInteractionLines'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger' | 'settings'
const COLLAPSED_NUDGE_DELAY_MS = 60_000

type AssistantSidebarProps = {
  onOpenInTab?: (url: string) => void
}

export function AssistantSidebar({ onOpenInTab }: AssistantSidebarProps = {}) {
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
    if (!collapsed) {
      return
    }

    const timeout = window.setTimeout(() => {
      window.bilimiDesktop?.setAssistantPetHint?.({
        tone: 'hint',
        message: '主人，小咪被折叠好久啦，回来点点我嘛。'
      })
    }, COLLAPSED_NUDGE_DELAY_MS)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [collapsed])

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
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
        />
      </div>
    </aside>
  )
}
