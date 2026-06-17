import { useState } from 'react'
import { FloatingAssistantApp } from './FloatingAssistantApp'

type AssistantSidebarTab = 'review' | 'notes' | 'ledger'

const RAIL_TABS: Array<{
  id: AssistantSidebarTab
  label: string
  icon: string
  openLabel: string
}> = [
  { id: 'review', label: '批阅', icon: '批', openLabel: '打开批阅' },
  { id: 'notes', label: '札记', icon: '记', openLabel: '打开札记' },
  { id: 'ledger', label: '掌库', icon: '库', openLabel: '打开掌库' }
]

export function AssistantSidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<AssistantSidebarTab>('review')

  function openTab(tab: AssistantSidebarTab) {
    setActiveTab(tab)
    setCollapsed(false)
  }

  return (
    <aside
      className="assistant-sidebar"
      aria-label="Bilimi 侧边栏"
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <nav className="assistant-sidebar__rail" aria-label="侧边栏图标栏">
        <button
          type="button"
          className="assistant-sidebar__rail-button"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? '展' : '收'}
        </button>
        {RAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="assistant-sidebar__rail-button"
            aria-label={tab.openLabel}
            aria-pressed={activeTab === tab.id && !collapsed}
            onClick={() => openTab(tab.id)}
          >
            <strong>{tab.icon}</strong>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
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
