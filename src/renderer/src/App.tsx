import { BILIBILI_HOME_URL } from '@shared/constants'
import type { AssistantAutomationResult, AssistantPreferences, BrowserTabModel } from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AssistantOverlay } from './features/assistant/AssistantOverlay'
import { BiliWebview } from './features/browser/BiliWebview'
import { createInitialAssistantPreferences } from './features/state/assistantState'

const HOME_TAB_ID = 'home'

function createTabTitle(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const lastSegment = parsedUrl.pathname.split('/').filter(Boolean).at(-1)

    return lastSegment || parsedUrl.hostname
  } catch {
    return url
  }
}

function createTabId(url: string): string {
  return `tab-${Math.abs(
    Array.from(url).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7)
  )}`
}

export default function App() {
  const [tabs, setTabs] = useState<BrowserTabModel[]>([
    {
      id: HOME_TAB_ID,
      title: '首页',
      url: BILIBILI_HOME_URL
    }
  ])
  const [activeTabId, setActiveTabId] = useState(HOME_TAB_ID)
  const [webviews, setWebviews] = useState<Record<string, Electron.WebviewTag>>({})
  const webviewRefs = useRef<Record<string, Electron.WebviewTag>>({})
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const activeWebview = useMemo(() => webviews[activeTabId] ?? null, [activeTabId, webviews])

  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      if (!window.bilimiDesktop?.loadPreferences) {
        return
      }

      const next = await window.bilimiDesktop.loadPreferences()

      if (!cancelled) {
        setPreferences(createInitialAssistantPreferences(next))
      }
    }

    void loadPreferences()

    return () => {
      cancelled = true
    }
  }, [])

  const handleWebviewReady = useCallback((tabId: string, webview: Electron.WebviewTag) => {
    webviewRefs.current[tabId] = webview

    setWebviews((current) => {
      if (current[tabId] === webview) {
        return current
      }

      return {
        ...current,
        [tabId]: webview
      }
    })
  }, [])

  const openInternalTab = useCallback((url: string) => {
    const nextUrl = url.trim()

    if (!nextUrl) {
      return
    }

    setTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.url === nextUrl)

      if (existingTab) {
        setActiveTabId(existingTab.id)
        return currentTabs
      }

      const nextTab = {
        id: createTabId(nextUrl),
        title: createTabTitle(nextUrl),
        url: nextUrl
      }

      setActiveTabId(nextTab.id)
      return [...currentTabs, nextTab]
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onOpenInTab?.(openInternalTab)
  }, [openInternalTab])

  const updateTabUrl = useCallback((tabId: string, url: string) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              title: tab.title === '首页' || tab.title === createTabTitle(tab.url) ? createTabTitle(url) : tab.title,
              url
            }
          : tab
      )
    )
  }, [])

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              title
            }
          : tab
      )
    )
  }, [])

  async function runScript(script: string): Promise<AssistantAutomationResult> {
    const currentActiveWebview =
      activeWebview ??
      webviewRefs.current[activeTabId] ??
      (document.querySelector('webview[data-active="true"]') as Electron.WebviewTag | null)

    if (!currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览案台尚未备妥。'
      }
    }

    return currentActiveWebview.executeJavaScript(script) as Promise<AssistantAutomationResult>
  }

  return (
    <div className="app-shell">
      <div className="browser-tabs" role="tablist" aria-label="网页标签">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className="browser-tabs__tab"
            onClick={() => setActiveTabId(tab.id)}
          >
            {tab.title}
          </button>
        ))}
      </div>
      <div className="browser-stack">
        {tabs.map((tab) => (
          <BiliWebview
            key={tab.id}
            active={tab.id === activeTabId}
            tabId={tab.id}
            url={tab.url}
            onLocationChange={updateTabUrl}
            onOpenInTab={openInternalTab}
            onReady={handleWebviewReady}
            onTitleChange={updateTabTitle}
          />
        ))}
      </div>
      <AssistantOverlay
        favoritesFolderName={preferences.favoritesFolderName}
        runScript={runScript}
        storedPreferences={preferences}
      />
    </div>
  )
}
