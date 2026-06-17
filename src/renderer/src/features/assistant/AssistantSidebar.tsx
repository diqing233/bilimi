import { useState } from 'react'
import { FloatingAssistantApp } from './FloatingAssistantApp'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger'

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
        aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span aria-hidden="true">{collapsed ? '展' : '收'}</span>
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
