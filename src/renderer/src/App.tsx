import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  DeepSeekGenerateRequest,
  FavoriteLedger,
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
  buildSaveFavoriteLedgersScript,
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
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i

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

function normalizeVideoTitle(title?: string): string | undefined {
  const normalized = title?.replace(BILIBILI_TITLE_SUFFIX, '').trim()
  return normalized || undefined
}

function normalizeActiveTabVideoTitle(tab?: BrowserTabModel): string | undefined {
  if (!tab || tab.title === '首页' || tab.title === createTabTitle(tab.url)) {
    return undefined
  }

  return normalizeVideoTitle(tab.title)
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
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
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

  const commitTabs = useCallback(
    (updater: (currentTabs: BrowserTabModel[]) => BrowserTabModel[]) => {
      const nextTabs = updater(tabsRef.current)
      tabsRef.current = nextTabs
      setTabs(nextTabs)
    },
    []
  )

  const selectActiveTab = useCallback((nextActiveTabId: string) => {
    activeTabIdRef.current = nextActiveTabId
    setActiveTabId(nextActiveTabId)
  }, [])

  function getActiveTabSnapshot(): BrowserTabModel | undefined {
    return tabsRef.current.find((tab) => tab.id === activeTabIdRef.current) ?? tabsRef.current[0]
  }
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

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencesChanged?.((nextPreferences) => {
      setPreferences(createInitialAssistantPreferences(nextPreferences))
    })
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

    commitTabs((currentTabs) => {
      const existingTab = currentTabs.find((tab) => tab.url === nextUrl)

      if (existingTab) {
        selectActiveTab(existingTab.id)
        return currentTabs
      }

      const nextTab = {
        id: createTabId(nextUrl),
        title: createTabTitle(nextUrl),
        url: nextUrl
      }

      selectActiveTab(nextTab.id)
      return [...currentTabs, nextTab]
    })
  }, [commitTabs, selectActiveTab])

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

      commitTabs((currentTabs) => {
        const tabIndex = currentTabs.findIndex((tab) => tab.id === tabIdToClose)

        if (tabIndex === -1) {
          return currentTabs
        }

        const nextTabs = currentTabs.filter((tab) => tab.id !== tabIdToClose)

        if (activeTabIdRef.current === tabIdToClose) {
          const fallbackTab = currentTabs[tabIndex - 1] ?? nextTabs[0]

          selectActiveTab(fallbackTab?.id ?? HOME_TAB_ID)
        }

        return nextTabs
      })
    },
    [commitTabs, selectActiveTab]
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
      commitTabs((currentTabs) =>
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

      if (tabId === activeTabIdRef.current) {
        notifyAssistantSnapshotChanged()
      }
    },
    [commitTabs, notifyAssistantSnapshotChanged]
  )

  const updateTabTitle = useCallback(
    (tabId: string, title: string) => {
      commitTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                title
              }
            : tab
        )
      )

      if (tabId === activeTabIdRef.current) {
        notifyAssistantSnapshotChanged()
      }
    },
    [commitTabs, notifyAssistantSnapshotChanged]
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
    const activeTabSnapshot = getActiveTabSnapshot()
    const activeTabVideoTitle = normalizeActiveTabVideoTitle(activeTabSnapshot)

    if (!currentActiveWebview?.executeJavaScript) {
      return { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
    }

    try {
      const context = (await currentActiveWebview.executeJavaScript(
        buildVideoContentContextScript(),
        true
      )) as VideoContentContext
      return activeTabVideoTitle ? { ...context, title: activeTabVideoTitle } : context
    } catch {
      return { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
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

  function canEnhanceFavoriteLedgerInsights(preview: FavoriteLedgerPreview) {
    return Boolean(
      preferences.deepseekEnabled &&
        preferences.deepseekApiKeyStored &&
        window.bilimiDesktop?.generateDeepSeek &&
        preview.insights?.candidateLedgers.length
    )
  }

  async function enhanceFavoriteLedgerPreview(
    preview: FavoriteLedgerPreview,
    sourceFolders: FavoriteSourceFolder[],
    targetMembership: Record<string, number[]>
  ): Promise<FavoriteLedgerPreview> {
    if (!canEnhanceFavoriteLedgerInsights(preview) || !preview.insights) {
      return preview
    }

    const request: DeepSeekGenerateRequest = {
      kind: 'favorite-ledger-insights',
      totalVideos: preview.insights.totalVideos,
      topAuthors: preview.insights.topAuthors,
      topTags: preview.insights.topTags,
      topCategories: preview.insights.topCategories,
      titleSeries: preview.insights.titleSeries,
      candidates: preview.insights.candidateLedgers
    }

    try {
      const result = await window.bilimiDesktop?.generateDeepSeek?.(request)
      if (!result || result.kind !== 'favorite-ledger-insights') {
        return preview
      }

      return createFavoriteLedgerPreview({
        ledgers: preferences.favoriteLedgers,
        sourceFolders,
        targetMembership,
        aiSuggestions: result.suggestions
      })
    } catch {
      return preview
    }
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

  async function saveFavoriteLedgers(nextLedgers: FavoriteLedger[]): Promise<AssistantAutomationResult> {
    const result = await runScript(
      buildSaveFavoriteLedgersScript(nextLedgers, preferences.favoriteLedgers)
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      const nextPreferences = createInitialAssistantPreferences({
        ...preferences,
        favoriteLedgers: result.ledgers
      })
      setPreferences(nextPreferences)

      if (window.bilimiDesktop?.savePreferences) {
        const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
        setPreferences(createInitialAssistantPreferences(saved))
      }

      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
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
        ok: false,
        message: scanResult.message || '整理旧藏未完成。',
        items: [],
        skippedSourceFolderTitles: []
      }
    }

    const preview = createFavoriteLedgerPreview({
      ledgers: preferences.favoriteLedgers,
      sourceFolders: scanResult.sourceFolders,
      targetMembership: scanResult.targetMembership
    })

    return enhanceFavoriteLedgerPreview(
      preview,
      scanResult.sourceFolders,
      scanResult.targetMembership
    )
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    return runScript(buildExecuteFavoriteLedgerPlanScript(items))
  }

  async function runVisualFallback(
    context: Parameters<typeof runVisualFavoriteFallback>[1],
    options?: Parameters<typeof runVisualFavoriteFallback>[2]
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

    return runVisualFavoriteFallback(currentActiveWebview, context, options)
  }

  async function saveVideoNote(note: VideoNote): Promise<void> {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  async function createAssistantSnapshot(): Promise<AssistantSnapshot> {
    const [videoContentContext, favoriteLedgerStatus] = await Promise.all([
      readVideoContentContext(),
      readFavoriteLedgerStatus().catch(() => null)
    ])
    const activeTabSnapshot = getActiveTabSnapshot()

    return {
      preferences,
      favoriteLedgerStatus,
      videoContentContext,
      videoTitle:
        normalizeActiveTabVideoTitle(activeTabSnapshot) ??
        videoContentContext.title ??
        '早八生存实录'
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
        window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
      }
    }

    return result
  }

  async function generateRuntimeVideoNote(manualTranscript?: string): Promise<VideoNote | null> {
    const hasManualTranscript = Boolean(manualTranscript?.trim())

    if (!hasManualTranscript) {
      return generateRuntimeVideoNoteFromAudio()
    }

    const extraction = await readVideoNoteSource()

    if (!extraction && !hasManualTranscript) {
      return null
    }

    const transcript = hasManualTranscript
      ? parseManualTranscript(manualTranscript ?? '')
      : extraction?.transcript ?? []
    const activeTabSnapshot = getActiveTabSnapshot()
    const source = extraction?.source ?? {
      title: activeTabSnapshot?.title ?? '早八生存实录',
      tags: [],
      url: activeTabSnapshot?.url ?? 'about:blank'
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
        case 'save-ledgers':
          return saveFavoriteLedgers(request.ledgers)
        case 'scan-old-favorites':
          return scanOldFavorites()
        case 'execute-old-favorite-plan':
          return executeOldFavoritePlan(request.items)
        default:
          throw new Error('Unknown assistant runtime request.')
      }
    })
  }, [
    executeOldFavoritePlan,
    generateRuntimeVideoNote,
    generateRuntimeVideoNoteFromAudio,
    preferences,
    readFavoriteLedgerStatus,
    readCurrentVideoTime,
    readVideoContentContext,
    readVideoNoteSource,
    runAssistantRuntimeAction,
    saveFavoriteLedgers,
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
                onClick={() => selectActiveTab(tab.id)}
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
