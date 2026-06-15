import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  FavoriteLedgerStatus,
  VideoNote,
  VideoNoteExtractionResult
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runVisualFavoriteFallback } from './features/actions/visualFavoriteFallback'
import { executeAssistantAction } from './features/actions/actionExecutor'
import { BiliWebview } from './features/browser/BiliWebview'
import {
  buildVideoContentContextScript,
  classifyVideoContent,
  type VideoContentContext
} from './features/recommendation/videoClassifier'
import { createInitialAssistantPreferences } from './features/state/assistantState'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult
} from './features/notes/videoNoteExtractor'
import {
  buildReadCurrentVideoTimeScript,
  buildSeekVideoTimeScript
} from './features/notes/videoNoteTimeAutomation'
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
import { createLocalVideoNoteDraft } from './features/notes/videoNoteSummarizer'
import { parseManualTranscript } from './features/notes/transcriptNormalizer'
import { recordAssistantPreferenceFeedback } from './features/state/assistantState'
import type {
  AssistantRuntimeRequest,
  AssistantSnapshot
} from './features/assistant/assistantRuntimeTypes'
import { AssistantSidebar } from './features/assistant/AssistantSidebar'

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
  const activeTabChangeMounted = useRef(false)
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

      if (!cancelled && next) {
        setPreferences(createInitialAssistantPreferences(next))
      }
    }

    void loadPreferences()

    return () => {
      cancelled = true
    }
  }, [])

  const notifyAssistantSnapshotChanged = useCallback(() => {
    window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
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

  useEffect(() => {
    if (!activeTabChangeMounted.current) {
      activeTabChangeMounted.current = true
      return
    }

    notifyAssistantSnapshotChanged()
  }, [activeTabId, notifyAssistantSnapshotChanged])

  const updateTabUrl = useCallback(
    (tabId: string, url: string) => {
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

      if (tabId === activeTabId) {
        notifyAssistantSnapshotChanged()
      }
    },
    [activeTabId, notifyAssistantSnapshotChanged]
  )

  const updateTabTitle = useCallback(
    (tabId: string, title: string) => {
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

      if (tabId === activeTabId) {
        notifyAssistantSnapshotChanged()
      }
    },
    [activeTabId, notifyAssistantSnapshotChanged]
  )

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

  async function readCurrentVideoTime(): Promise<number> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      throw new Error('浏览框尚未备妥，无法读取时间点。')
    }

    return currentActiveWebview.executeJavaScript(
      buildReadCurrentVideoTimeScript(),
      true
    ) as Promise<number>
  }

  async function seekVideoTime(seconds: number): Promise<boolean> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      throw new Error('浏览框尚未备妥，无法跳转时间点。')
    }

    return currentActiveWebview.executeJavaScript(
      buildSeekVideoTimeScript(seconds),
      true
    ) as Promise<boolean>
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

  async function createAssistantSnapshot(): Promise<AssistantSnapshot> {
    const [videoContentContext, favoriteLedgerStatus] = await Promise.all([
      readVideoContentContext(),
      readFavoriteLedgerStatus().catch(() => null)
    ])

    return {
      preferences,
      favoriteLedgerStatus,
      videoContentContext,
      videoTitle: videoContentContext.title ?? activeTab?.title ?? '早八生存实录'
    }
  }

  async function runAssistantRuntimeAction(
    action: AssistantAction,
    options?: {
      coinCount?: 1 | 2
      commentDraft?: string
      pageClickOnly?: boolean
    }
  ): Promise<AssistantAutomationResult> {
    const videoContentContext = await readVideoContentContext()
    const targetLedgerId = classifyVideoContent(
      videoContentContext,
      preferences.favoriteLedgers
    ).ledgerId
    const result = await executeAssistantAction({
      action,
      favoritesFolderName: preferences.favoritesFolderName,
      runScript,
      runVisualFallback,
      favoriteApiFallbackEnabled: options?.pageClickOnly !== true,
      coinCount: options?.coinCount,
      commentDraft: options?.commentDraft,
      favoriteLedgers: preferences.favoriteLedgers,
      targetLedgerId
    })

    if (result.ok && action !== '阅') {
      const nextPreferences = recordAssistantPreferenceFeedback(preferences, targetLedgerId, action)
      setPreferences(nextPreferences)
      if (window.bilimiDesktop?.savePreferences) {
        const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
        setPreferences(createInitialAssistantPreferences(saved))
      }
    }

    return result
  }

  async function generateRuntimeVideoNote(manualTranscript?: string): Promise<VideoNote | null> {
    const hasManualTranscript = Boolean(manualTranscript?.trim())
    const extraction = await readVideoNoteSource()

    if (!extraction && !hasManualTranscript) {
      return null
    }

    const transcript = hasManualTranscript
      ? parseManualTranscript(manualTranscript ?? '')
      : extraction?.transcript ?? []
    const source = extraction?.source ?? {
      title: activeTab?.title ?? '早八生存实录',
      tags: [],
      url: activeTab?.url ?? 'about:blank'
    }

    return createLocalVideoNoteDraft({
      now: new Date().toISOString(),
      source,
      transcript,
      transcriptSource: hasManualTranscript ? 'manual' : extraction?.transcriptSource ?? 'manual'
    })
  }

  async function generateRuntimeVideoNoteFromAudio(): Promise<VideoNote | null> {
    const extraction = await readVideoNoteSource()

    if (!extraction?.source.url || !window.bilimiDesktop?.transcribeCurrentVideoAudio) {
      return null
    }

    const result = await window.bilimiDesktop.transcribeCurrentVideoAudio({
      url: extraction.source.url,
      title: extraction.source.title,
      bvid: extraction.source.bvid
    })

    return createLocalVideoNoteDraft({
      now: new Date().toISOString(),
      source: extraction.source,
      transcript: result.transcript,
      transcriptSource: 'audio'
    })
  }

  useEffect(() => {
    if (!window.bilimiDesktop?.registerAssistantRuntime) {
      return
    }

    return window.bilimiDesktop.registerAssistantRuntime(async (request: AssistantRuntimeRequest) => {
      switch (request.type) {
        case 'snapshot':
          return createAssistantSnapshot()
        case 'run-action':
          return runAssistantRuntimeAction(request.action, request.options)
        case 'generate-video-note':
          return generateRuntimeVideoNote(request.manualTranscript)
        case 'generate-video-note-from-audio':
          return generateRuntimeVideoNoteFromAudio()
        case 'save-video-note':
          await saveVideoNote(request.note)
          return request.note
        case 'get-current-video-time':
          return readCurrentVideoTime()
        case 'seek-video-time':
          return seekVideoTime(request.seconds)
        case 'ensure-ledgers':
          return ensureFavoriteLedgers()
        case 'scan-old-favorites':
          return scanOldFavorites()
        case 'execute-old-favorite-plan':
          return executeOldFavoritePlan(request.items)
        default:
          throw new Error('Unknown assistant runtime request.')
      }
    })
  }, [
    activeTab?.title,
    activeTab?.url,
    executeOldFavoritePlan,
    generateRuntimeVideoNote,
    generateRuntimeVideoNoteFromAudio,
    preferences,
    readFavoriteLedgerStatus,
    readCurrentVideoTime,
    readVideoContentContext,
    readVideoNoteSource,
    runAssistantRuntimeAction,
    saveVideoNote,
    scanOldFavorites,
    seekVideoTime
  ])

  return (
    <div className="app-shell" data-tabs-visible="true">
      <div className="app-main">
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
      </div>
      <AssistantSidebar />
    </div>
  )
}
