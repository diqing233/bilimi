import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteExtractionResult
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AssistantOverlay } from './features/assistant/AssistantOverlay'
import { runVisualFavoriteFallback } from './features/actions/visualFavoriteFallback'
import { BiliWebview } from './features/browser/BiliWebview'
import {
  buildVideoContentContextScript,
  type VideoContentContext
} from './features/recommendation/videoClassifier'
import { createInitialAssistantPreferences } from './features/state/assistantState'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult
} from './features/notes/videoNoteExtractor'
import {
  buildEnsureFavoriteLedgersScript,
  buildExecuteFavoriteLedgerPlanScript,
  buildFavoriteLedgerStatusScript,
  buildScanOldFavoritesScript
} from './features/favorites/favoriteLedgerApi'
import {
  createFavoriteLedgerPreview,
  type FavoriteLedgerPreview,
  type FavoriteLedgerPreviewItem,
  type FavoriteSourceFolder
} from './features/favorites/favoriteLedgerPreview'

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
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  )

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

  const closeInternalTab = useCallback(
    (tabIdToClose: string) => {
      if (tabIdToClose === HOME_TAB_ID) {
        return
      }

      delete webviewRefs.current[tabIdToClose]

      setWebviews((currentWebviews) => {
        const { [tabIdToClose]: _closedWebview, ...remainingWebviews } = currentWebviews

        return remainingWebviews
      })

      setTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((tab) => tab.id === tabIdToClose)

        if (tabIndex === -1) {
          return currentTabs
        }

        const nextTabs = currentTabs.filter((tab) => tab.id !== tabIdToClose)

        if (activeTabId === tabIdToClose) {
          const fallbackTab = currentTabs[tabIndex - 1] ?? nextTabs[0]

          setActiveTabId(fallbackTab?.id ?? HOME_TAB_ID)
        }

        return nextTabs
      })
    },
    [activeTabId]
  )

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

  function getCurrentActiveWebview() {
    return (
      activeWebview ??
      webviewRefs.current[activeTabId] ??
      (document.querySelector('webview[data-active="true"]') as Electron.WebviewTag | null)
    )
  }

  async function readVideoContentContext(): Promise<VideoContentContext> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return { title: activeTab?.title }
    }

    try {
      return (await currentActiveWebview.executeJavaScript(
        buildVideoContentContextScript(),
        true
      )) as VideoContentContext
    } catch {
      return { title: activeTab?.title }
    }
  }

  async function readVideoNoteSource(): Promise<VideoNoteExtractionResult | null> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return null
    }

    try {
      const raw = await currentActiveWebview.executeJavaScript(
        buildVideoNoteExtractionScript(),
        true
      )

      return normalizeExtractedVideoNoteResult(
        raw as Parameters<typeof normalizeExtractedVideoNoteResult>[0]
      )
    } catch {
      return null
    }
  }

  async function runScript(script: string): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

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

  async function readFavoriteLedgerStatus(): Promise<FavoriteLedgerStatus> {
    const status = await runScript(
      buildFavoriteLedgerStatusScript(preferences.favoriteLedgers)
    ) as unknown as Partial<FavoriteLedgerStatus> & AssistantAutomationResult

    if (Array.isArray(status.ledgers) && Array.isArray(status.missingLedgerIds)) {
      setPreferences((currentPreferences) =>
        createInitialAssistantPreferences({
          ...currentPreferences,
          favoriteLedgers: status.ledgers ?? currentPreferences.favoriteLedgers
        })
      )

      return status as FavoriteLedgerStatus
    }

    return {
      ok: false,
      ledgers: preferences.favoriteLedgers,
      missingLedgerIds: [],
      message: status.message
    }
  }

  async function ensureFavoriteLedgers(): Promise<AssistantAutomationResult> {
    const result = await runScript(
      buildEnsureFavoriteLedgersScript(preferences.favoriteLedgers)
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      setPreferences((currentPreferences) =>
        createInitialAssistantPreferences({
          ...currentPreferences,
          favoriteLedgers: result.ledgers ?? currentPreferences.favoriteLedgers
        })
      )
    }

    return result
  }

  async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
    const scanResult = await runScript(
      buildScanOldFavoritesScript(preferences.favoriteLedgers)
    ) as AssistantAutomationResult & {
      sourceFolders?: FavoriteSourceFolder[]
      targetMembership?: Record<string, number[]>
    }

    if (!scanResult.ok || !Array.isArray(scanResult.sourceFolders) || !scanResult.targetMembership) {
      return {
        items: [],
        skippedSourceFolderTitles: []
      }
    }

    return createFavoriteLedgerPreview({
      ledgers: preferences.favoriteLedgers,
      sourceFolders: scanResult.sourceFolders,
      targetMembership: scanResult.targetMembership
    })
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    return runScript(buildExecuteFavoriteLedgerPlanScript(items))
  }

  async function runVisualFallback(
    context: Parameters<typeof runVisualFavoriteFallback>[1]
  ): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览框台尚未备妥。'
      }
    }

    return runVisualFavoriteFallback(currentActiveWebview, context)
  }

  async function saveVideoNote(note: VideoNote): Promise<void> {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  return (
    <div className="app-shell">
      <div className="browser-tabs" role="tablist" aria-label="网页标签">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="browser-tabs__item"
            data-selected={tab.id === activeTabId ? 'true' : 'false'}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className="browser-tabs__tab"
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.title}
            </button>
            {tab.id !== HOME_TAB_ID ? (
              <button
                type="button"
                className="browser-tabs__close"
                aria-label={`关闭 ${tab.title}`}
                title={`关闭 ${tab.title}`}
                onClick={() => closeInternalTab(tab.id)}
              >
                ×
              </button>
            ) : null}
          </div>
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
        readVideoContentContext={readVideoContentContext}
        readVideoNoteSource={readVideoNoteSource}
        runVisualFallback={runVisualFallback}
        runScript={runScript}
        readFavoriteLedgerStatus={readFavoriteLedgerStatus}
        ensureFavoriteLedgers={ensureFavoriteLedgers}
        scanOldFavorites={scanOldFavorites}
        executeOldFavoritePlan={executeOldFavoritePlan}
        saveVideoNote={saveVideoNote}
        storedPreferences={preferences}
        videoTitle={activeTab?.title}
      />
    </div>
  )
}
