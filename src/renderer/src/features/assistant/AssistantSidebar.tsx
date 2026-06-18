import { useState } from 'react'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import { FloatingAssistantApp } from './FloatingAssistantApp'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger' | 'settings'

export function AssistantSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')

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
        onClick={() => setCollapsed((current) => !current)}
      >
        <img
          className="assistant-sidebar__collapse-pet"
          src={idlePetUrl}
          alt={collapsed ? '小mi展开侧栏' : '小mi收起侧栏'}
        />
        <span className="assistant-sidebar__collapse-label" aria-hidden="true">
          {collapsed ? '展开' : '折叠'}
        </span>
      </button>
      {collapsed ? null : (
        <FloatingAssistantApp
          mode="sidebar"
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onRequestCollapse={() => setCollapsed(true)}
        />
      )}
    </aside>
  )
}
