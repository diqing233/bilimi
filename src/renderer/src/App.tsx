import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  DeepSeekGenerateRequest,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  PendingFavoriteQueueItem,
  VideoNote,
  VideoNoteExtractionResult,
  VideoAudioTranscriptionQueueSnapshot
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runVisualFavoriteFallback } from './features/actions/visualFavoriteFallback'
import { executeAssistantAction } from './features/actions/actionExecutor'
import {
  buildDanmakuDraftPresenceScript,
  buildDanmakuFieldFocusScript,
  buildDanmakuSubmitConfirmationScript
} from './features/actions/pageAutomation'
import { BiliWebview } from './features/browser/BiliWebview'
import {
  buildVideoContentContextScript,
  classifyVideoContent,
  type VideoContentContext
} from './features/recommendation/videoClassifier'
import { planFavoriteArchiveTargets } from './features/recommendation/archivePlanning'
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
  buildScanOldFavoriteVideoScript,
  buildScanOldFavoritesScript
} from './features/favorites/favoriteLedgerApi'
import {
  createFavoriteLedgerPreview,
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
import { PET_VIDEO_OPENING_LINES, pickPetLine } from './features/assistant/petInteractionLines'

const HOME_TAB_ID = 'home'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/([^/?#]+)/i
export const VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS = 900
const NO_CURRENT_VIDEO_RESULT: AssistantAutomationResult = {
  ok: false,
  steps: [],
  missingTargets: ['current-video'],
  message: '暂无视频，请先打开一个视频。'
}
const LOGIN_REQUIRED_RESULT: AssistantAutomationResult = {
  ok: false,
  steps: ['auth:check'],
  missingTargets: ['bilibili-login'],
  message: '请先登录 Bilibili 后再操作。'
}

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

function readBilibiliVideoKey(url: string): string | undefined {
  return url.match(BILIBILI_VIDEO_URL_PATTERN)?.[1]
}

function isBilibiliVideoUrl(url?: string): boolean {
  return Boolean(url && BILIBILI_VIDEO_URL_PATTERN.test(url))
}

type TrustedPlayerActivationResult = AssistantAutomationResult & {
  clickPoint?: { x: number; y: number } | null
  danmakuEnabled?: boolean | null
  paused?: boolean | null
}

function buildTrustedPlayerActivationScript(): string {
  return `
    (() => {
      const __bilimiTrustedPlayerActivation = true;
      void __bilimiTrustedPlayerActivation;
      const result = {
        ok: false,
        steps: [],
        missingTargets: [],
        message: '',
        clickPoint: null,
        danmakuEnabled: null,
        paused: null
      };
      const isLikelyHidden = (node) => {
        const style = window.getComputedStyle?.(node);
        return style?.display === 'none' || style?.visibility === 'hidden' || style?.opacity === '0';
      };
      const hasVisibleRect = (node) => {
        if (!node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return Boolean(rect && rect.width > 20 && rect.height > 20);
      };
      const centerOf = (node) => {
        const rect = node?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return null;
        }

        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2)
        };
      };
      const textOf = (node) =>
        String([
          node?.getAttribute?.('aria-label'),
          node?.getAttribute?.('aria-checked'),
          node?.getAttribute?.('aria-pressed'),
          node?.getAttribute?.('title'),
          node?.getAttribute?.('class'),
          node?.textContent
        ].filter(Boolean).join(' ')).replace(/\\s+/g, '').toLowerCase();
      const isClearlyDanmakuOff = (node) => {
        const text = textOf(node);

        return (
          node?.getAttribute?.('aria-checked') === 'false' ||
          node?.getAttribute?.('aria-pressed') === 'false' ||
          text.includes('开启弹幕') ||
          text.includes('打开弹幕') ||
          text.includes('danmakuoff') ||
          text.includes('dmoff') ||
          /(^|[-_\\s])(off|close|closed|disabled|disable)([-_\\s]|$)/.test(text)
        );
      };
      const video = Array.from(document.querySelectorAll('video')).find(hasVisibleRect) || null;
      const player =
        video?.closest?.('.bpx-player-container,.bpx-player,.bilibili-player,#bilibili-player,[class*="player"]') ||
        Array.from(document.querySelectorAll('.bpx-player-container,.bpx-player,.bilibili-player,#bilibili-player,[class*="player"]')).find(hasVisibleRect) ||
        video;
      const clickPoint = centerOf(video) || centerOf(player);

      if (!clickPoint) {
        result.missingTargets.push('player-click-target');
        result.message = '尚有 player-click-target 未能寻见。';
        return result;
      }

      const switchSelectors = [
        '.bpx-player-dm-switch',
        '.bpx-player-dm-switch-btn',
        '.bilibili-player-video-danmaku-switch',
        '[class*="dm-switch"]',
        '[class*="danmaku"][class*="switch"]',
        '[aria-label*="弹幕"]',
        '[title*="弹幕"]'
      ].join(',');
      const switchButton = Array.from(document.querySelectorAll(switchSelectors)).find((node) => {
        if (node === video || !node || isLikelyHidden(node)) {
          return false;
        }

        const rect = node.getBoundingClientRect?.();
        return !rect || rect.width > 0 || rect.height > 0 || Boolean(textOf(node));
      }) || null;

      result.clickPoint = clickPoint;
      result.danmakuEnabled = switchButton ? !isClearlyDanmakuOff(switchButton) : null;
      result.paused = typeof video?.paused === 'boolean' ? video.paused : null;
      result.steps.push('player:locate');
      result.ok = true;
      result.message = '播放器已定位。';
      return result;
    })()
  `
}

function buildRestorePlayerPlaybackStateScript(paused?: boolean | null): string {
  const payload = JSON.stringify({ paused })

  return `
    (() => {
      const __bilimiRestorePlayerPlaybackState = true;
      void __bilimiRestorePlayerPlaybackState;
      const payload = ${payload};
      const video = document.querySelector('video');

      if (!video || typeof payload.paused !== 'boolean') {
        return {
          ok: true,
          steps: ['player:playback:unchecked'],
          missingTargets: [],
          message: '播放状态无需恢复。'
        };
      }

      if (Boolean(video.paused) === payload.paused) {
        return {
          ok: true,
          steps: ['player:playback:stable'],
          missingTargets: [],
          message: '播放状态未改变。'
        };
      }

      if (payload.paused) {
        video.pause?.();
      } else {
        const playResult = video.play?.();
        if (playResult?.catch) {
          playResult.catch(() => undefined);
        }
      }

      return {
        ok: true,
        steps: ['player:playback:restore'],
        missingTargets: [],
        message: '播放状态已恢复。'
      };
    })()
  `
}

function pendingQueueItemFromCurrentVideo(
  context: VideoContentContext,
  targetLedgerId: string,
  now = new Date().toISOString()
): PendingFavoriteQueueItem | null {
  const aid = Number(context.aid)

  if (!Number.isFinite(aid)) {
    return null
  }

  return {
    aid,
    title: context.title || '未命名视频',
    source: 'new-favorite',
    originalTargetLedgerId: targetLedgerId,
    suggestedLedgerIds: [],
    candidateLedgerNames: [],
    reason: '新收藏暂时没有明确分类',
    createdAt: now,
    updatedAt: now,
    status: 'pending'
  }
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
  const lastPetVideoKey = useRef<string | undefined>(undefined)
  const petHiddenForVideoFullscreen = useRef(false)
  const videoFullscreenPetCloseTimer = useRef<number | null>(null)
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

  const clearVideoFullscreenPetCloseTimer = useCallback(() => {
    if (videoFullscreenPetCloseTimer.current === null) {
      return
    }

    window.clearTimeout(videoFullscreenPetCloseTimer.current)
    videoFullscreenPetCloseTimer.current = null
  }, [])

  const restorePetAfterVideoFullscreen = useCallback(() => {
    petHiddenForVideoFullscreen.current = false
    clearVideoFullscreenPetCloseTimer()

    void Promise.resolve(window.bilimiDesktop?.wakeAssistantPet?.()).finally(() => {
      window.bilimiDesktop?.setAssistantPetHint?.({
        tone: 'hint',
        message: '全屏看完感觉怎么样？要不要和小咪互动一下？'
      })
    })
  }, [clearVideoFullscreenPetCloseTimer])

  const handleHtmlFullscreenChange = useCallback(
    (tabId: string, fullscreen: boolean) => {
      if (tabId !== activeTabIdRef.current || !preferences.hidePetDuringVideoFullscreen) {
        return
      }

      if (fullscreen) {
        if (petHiddenForVideoFullscreen.current) {
          return
        }

        petHiddenForVideoFullscreen.current = true
        window.bilimiDesktop?.setAssistantPetHint?.({
          tone: 'sleepy',
          message: '主人先安心全屏看，小咪不挡画面，待会儿回来找你～'
        })
        clearVideoFullscreenPetCloseTimer()
        videoFullscreenPetCloseTimer.current = window.setTimeout(() => {
          videoFullscreenPetCloseTimer.current = null
          window.bilimiDesktop?.closeAssistantPet?.()
        }, VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS)
        return
      }

      if (petHiddenForVideoFullscreen.current) {
        restorePetAfterVideoFullscreen()
      }
    },
    [
      clearVideoFullscreenPetCloseTimer,
      preferences.hidePetDuringVideoFullscreen,
      restorePetAfterVideoFullscreen
    ]
  )

  useEffect(() => {
    if (!preferences.hidePetDuringVideoFullscreen && petHiddenForVideoFullscreen.current) {
      restorePetAfterVideoFullscreen()
    }
  }, [preferences.hidePetDuringVideoFullscreen, restorePetAfterVideoFullscreen])

  useEffect(() => clearVideoFullscreenPetCloseTimer, [clearVideoFullscreenPetCloseTimer])

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
        const videoKey = readBilibiliVideoKey(url)

        if (videoKey && videoKey !== lastPetVideoKey.current) {
          lastPetVideoKey.current = videoKey
          window.bilimiDesktop?.setAssistantPetHint?.({
            tone: 'hint',
            message: pickPetLine(PET_VIDEO_OPENING_LINES)
          })
        }

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

  async function isBilibiliLoggedIn(): Promise<boolean> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return false
    }

    try {
      const loginState = await currentActiveWebview.executeJavaScript(
        `(() => {
          const cookie = String(document.cookie || '')
          const hasUserId = /(?:^|;\\s*)DedeUserID=\\d+/.test(cookie)
          const hasCsrf = /(?:^|;\\s*)bili_jct=[^;]+/.test(cookie)
          return { hasUserId, hasCsrf }
        })()`,
        true
      )

      if (loginState && typeof loginState === 'object') {
        if ('hasUserId' in loginState || 'hasCsrf' in loginState) {
          return Boolean(loginState.hasUserId && loginState.hasCsrf)
        }

        return true
      }

      return Boolean(String(loginState ?? '').trim())
    } catch {
      return false
    }
  }

  async function requireBilibiliLogin(): Promise<AssistantAutomationResult | null> {
    return (await isBilibiliLoggedIn()) ? null : LOGIN_REQUIRED_RESULT
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
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

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

  async function saveFavoriteLedgers(
    nextLedgers: FavoriteLedger[],
    options?: FavoriteLedgerSaveOptions
  ): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const result = await runScript(
      buildSaveFavoriteLedgersScript(nextLedgers, preferences.favoriteLedgers, options)
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

  async function scanOldFavorites(
    options: { multiArchiveMode?: AssistantPreferences['favoriteArchiveMultiMode'] } = {}
  ): Promise<FavoriteLedgerPreview> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return {
        ok: false,
        message: loginFailure.message,
        items: [],
        skippedSourceFolderTitles: []
      }
    }

    const scanResult = await runScript(
      buildScanOldFavoritesScript(preferences.favoriteLedgers)
    ) as AssistantAutomationResult & {
      sourceFolders?: FavoriteSourceFolder[]
      targetMembership?: Record<string, number[]>
      skippedSourceFolderTitles?: string[]
      scanDiagnostics?: FavoriteLedgerPreview['scanDiagnostics']
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
      targetMembership: scanResult.targetMembership,
      skippedSourceFolderTitles: scanResult.skippedSourceFolderTitles,
      scanDiagnostics: scanResult.scanDiagnostics,
      multiArchiveMode: options.multiArchiveMode ?? preferences.favoriteArchiveMultiMode
    })

    return preview
  }

  async function rejudgeOldFavorite(item: FavoriteLedgerPreviewItem): Promise<FavoriteLedgerPreviewItem> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return item
    }

    const scanResult = await runScript(
      buildScanOldFavoriteVideoScript(preferences.favoriteLedgers, item.aid)
    ) as AssistantAutomationResult & {
      sourceFolders?: FavoriteSourceFolder[]
      targetMembership?: Record<string, number[]>
      skippedSourceFolderTitles?: string[]
    }

    if (!scanResult.ok || !Array.isArray(scanResult.sourceFolders) || !scanResult.targetMembership) {
      return item
    }

    const preview = createFavoriteLedgerPreview({
      ledgers: preferences.favoriteLedgers,
      sourceFolders: scanResult.sourceFolders,
      targetMembership: scanResult.targetMembership,
      skippedSourceFolderTitles: scanResult.skippedSourceFolderTitles,
      multiArchiveMode: preferences.favoriteArchiveMultiMode
    })

    return preview.items.find((candidate) => candidate.aid === item.aid) ?? item
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    return runScript(buildExecuteFavoriteLedgerPlanScript(items))
  }

  async function openBilibiliFavorites(): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['webview'],
        message: '浏览框台尚未备妥，无法打开 B 站收藏夹。'
      }
    }

    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    try {
      const rawMid = await currentActiveWebview.executeJavaScript(
        `(() => {
          const match = String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=([^;]+)/)
          return match ? decodeURIComponent(match[1]) : ''
        })()`,
        true
      )
      const mid = String(rawMid ?? '').trim()

      if (!/^\d+$/.test(mid)) {
        return {
          ok: false,
          steps: ['favorite-page:read-user'],
          missingTargets: ['bilibili-user'],
          message: '未能读取 B 站用户 ID，无法打开收藏夹。'
        }
      }

      const favoriteUrl = `https://space.bilibili.com/${mid}/favlist`

      openInternalTab(favoriteUrl)

      return {
        ok: true,
        steps: ['favorite-page:read-user', 'favorite-page:open'],
        missingTargets: [],
        message: '已打开 B 站收藏夹。'
      }
    } catch (error) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['favorite-page'],
        message: `打开 B 站收藏夹未完成：${error instanceof Error ? error.message : String(error)}`
      }
    }
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

  async function runTrustedDanmakuSubmitFallback(
    commentDraft: string
  ): Promise<AssistantAutomationResult> {
    const currentActiveWebview = getCurrentActiveWebview()

    if (!currentActiveWebview?.sendInputEvent || !currentActiveWebview?.executeJavaScript) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-input'],
        message: '浏览框尚未准备好真实键盘输入。'
      }
    }

    type DanmakuFocusResult = AssistantAutomationResult & {
      sendButtonPoint?: { x: number; y: number }
    }

    const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay))
    currentActiveWebview.focus?.()

    const sendKey = (keyCode: string, modifiers?: string[]) => {
      const keyDown = modifiers
        ? { keyCode, modifiers, type: 'keyDown' }
        : { keyCode, type: 'keyDown' }
      const keyUp = modifiers
        ? { keyCode, modifiers, type: 'keyUp' }
        : { keyCode, type: 'keyUp' }
      currentActiveWebview.sendInputEvent?.(keyDown)
      currentActiveWebview.sendInputEvent?.(keyUp)
    }

    const clickAt = (point: { x: number; y: number }) => {
      currentActiveWebview.sendInputEvent?.({ type: 'mouseMove', x: point.x, y: point.y })
      currentActiveWebview.sendInputEvent?.({
        button: 'left',
        clickCount: 1,
        type: 'mouseDown',
        x: point.x,
        y: point.y
      })
      currentActiveWebview.sendInputEvent?.({
        button: 'left',
        clickCount: 1,
        type: 'mouseUp',
        x: point.x,
        y: point.y
      })
    }

    if (!navigator.clipboard?.writeText) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-clipboard'],
        message: '尚有 trusted-danmaku-clipboard 未能寻见。'
      }
    }

    try {
      await navigator.clipboard.writeText(commentDraft)
    } catch {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-clipboard'],
        message: '弹幕文案写入剪贴板失败，请重新点击表再试。'
      }
    }

    const activationSteps: string[] = []
    try {
      const activation = (await currentActiveWebview.executeJavaScript(
        buildTrustedPlayerActivationScript(),
        true
      )) as TrustedPlayerActivationResult

      if (activation?.ok && activation.clickPoint) {
        activationSteps.push(...activation.steps, 'player:activate-click')
        clickAt(activation.clickPoint)
        await wait(120)

        const playbackRestore = (await currentActiveWebview.executeJavaScript(
          buildRestorePlayerPlaybackStateScript(activation.paused),
          true
        )) as AssistantAutomationResult
        activationSteps.push(...(playbackRestore?.steps ?? []))
      }
    } catch {
      activationSteps.push('player:activate:skipped')
    }

    currentActiveWebview.focus?.()
    sendKey('Enter')
    activationSteps.push('danmaku:trusted-enter-open')
    await wait(160)

    const focusResult = (await currentActiveWebview.executeJavaScript(
      buildDanmakuFieldFocusScript()
    )) as DanmakuFocusResult | boolean
    const prepared =
      typeof focusResult === 'boolean'
        ? ({
            ok: focusResult,
            steps: focusResult ? ['danmaku:focus'] : [],
            missingTargets: focusResult ? [] : ['danmaku-focus'],
            message: focusResult ? '弹幕栏已聚焦。' : '尚有 danmaku-focus 未能寻见。'
          } satisfies DanmakuFocusResult)
        : focusResult

    if (!prepared?.ok) {
      return {
        ...prepared,
        ok: false,
        steps: [...activationSteps, ...(prepared?.steps ?? [])],
        missingTargets: prepared?.missingTargets?.length ? prepared.missingTargets : ['danmaku-focus'],
        message: prepared?.message ?? '尚有 danmaku-focus 未能寻见。'
      }
    }

    await wait(80)
    currentActiveWebview.focus?.()
    sendKey('v', ['control'])
    await wait(120)

    const pasteConfirmation = (await currentActiveWebview.executeJavaScript(
      buildDanmakuDraftPresenceScript(commentDraft),
      true
    )) as AssistantAutomationResult
    const pasteSteps = ['danmaku:trusted-paste', ...pasteConfirmation.steps]

    if (!pasteConfirmation.ok) {
      return {
        ...pasteConfirmation,
        ok: false,
        steps: [...activationSteps, ...prepared.steps, ...pasteSteps],
        missingTargets: pasteConfirmation.missingTargets.length
          ? pasteConfirmation.missingTargets
          : ['danmaku-paste-confirm'],
        message: pasteConfirmation.message || '弹幕文案没有写入输入框。'
      }
    }

    const submitSteps = ['danmaku:trusted-enter']
    sendKey('Enter')
    await wait(120)

    let confirmation = (await currentActiveWebview.executeJavaScript(
      buildDanmakuSubmitConfirmationScript(commentDraft)
    )) as AssistantAutomationResult

    return {
      ...confirmation,
      steps: [
        ...activationSteps,
        ...prepared.steps,
        ...pasteSteps,
        ...submitSteps,
        ...confirmation.steps
      ]
    }
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
      activeTabUrl: activeTabSnapshot?.url,
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
      submitComment?: boolean
      pageClickOnly?: boolean
    }
  ): Promise<AssistantAutomationResult> {
    if (!isBilibiliVideoUrl(getActiveTabSnapshot()?.url)) {
      return NO_CURRENT_VIDEO_RESULT
    }

    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const videoContentContext = await readVideoContentContext()
    const archiveTargets = planFavoriteArchiveTargets({
      context: videoContentContext,
      ledgers: preferences.favoriteLedgers,
      multiArchiveMode: preferences.favoriteArchiveMultiMode
    })
    const targetLedgerId =
      archiveTargets[0]?.ledgerId ??
      classifyVideoContent(videoContentContext, preferences.favoriteLedgers).ledgerId
    const result = await executeAssistantAction({
      action,
      favoritesFolderName: preferences.favoritesFolderName,
      runScript,
      runVisualFallback,
      runTrustedDanmakuSubmitFallback,
      favoriteApiFallbackEnabled: options?.pageClickOnly !== true,
      coinCount: options?.coinCount ?? (action === '赐' ? preferences.defaultCoinCount : undefined),
      commentDraft: options?.commentDraft,
      submitComment:
        options?.submitComment ??
        (action === '表' ? preferences.commentSubmitMode === 'auto' : undefined),
      favoriteLedgers: preferences.favoriteLedgers,
      targetLedgerId,
      targetLedgerIds: archiveTargets.map((target) => target.ledgerId)
    })

    if (result.ok && action !== '阅') {
      if (targetLedgerId === 'inbox' && action === '藏') {
        const queueItem = pendingQueueItemFromCurrentVideo(videoContentContext, targetLedgerId)

        if (queueItem) {
          await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.([queueItem])
        }
      }

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
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      window.bilimiDesktop?.setAssistantPetHint?.({
        tone: 'error',
        message: loginFailure.message
      })
      return null
    }

    const extraction = await readVideoNoteSource()

    if (!extraction?.source.url || !window.bilimiDesktop?.transcribeCurrentVideoAudio) {
      return null
    }

    const result = await window.bilimiDesktop.transcribeCurrentVideoAudio({
      url: extraction.source.url,
      title: extraction.source.title,
      author: extraction.source.author,
      bvid: extraction.source.bvid
    })

    return createLocalVideoNoteDraft({
      now: new Date().toISOString(),
      source: extraction.source,
      transcript: result.transcript,
      transcriptSource: 'audio'
    })
  }

  async function enqueueRuntimeVideoAudioTranscription(options?: {
    summarizeWithDeepSeek?: boolean
  }): Promise<VideoAudioTranscriptionQueueSnapshot | null> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      window.bilimiDesktop?.setAssistantPetHint?.({
        tone: 'error',
        message: loginFailure.message
      })
      return null
    }

    const extraction = await readVideoNoteSource()

    if (!extraction?.source.url || !window.bilimiDesktop?.enqueueVideoAudioTranscription) {
      return null
    }

    return window.bilimiDesktop.enqueueVideoAudioTranscription({
      url: extraction.source.url,
      title: extraction.source.title,
      author: extraction.source.author,
      bvid: extraction.source.bvid,
      summarizeWithDeepSeek: Boolean(options?.summarizeWithDeepSeek)
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
        case 'enqueue-current-video-audio':
          return enqueueRuntimeVideoAudioTranscription({
            summarizeWithDeepSeek: request.summarizeWithDeepSeek
          })
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
          return saveFavoriteLedgers(request.ledgers, request.options)
        case 'open-bilibili-favorites':
          return openBilibiliFavorites()
        case 'scan-old-favorites':
          return scanOldFavorites({
            multiArchiveMode: request.multiArchiveMode
          })
        case 'rejudge-old-favorite':
          return rejudgeOldFavorite(request.item)
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
    openBilibiliFavorites,
    preferences,
    readFavoriteLedgerStatus,
    readCurrentVideoTime,
    readVideoContentContext,
    readVideoNoteSource,
    rejudgeOldFavorite,
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
              onHtmlFullscreenChange={handleHtmlFullscreenChange}
              onPageInteractionHint={(message) => {
                window.bilimiDesktop?.setAssistantPetHint?.({ tone: 'hint', message })
              }}
              onReady={handleWebviewReady}
              onTitleChange={updateTabTitle}
            />
          ))}
        </div>
      </div>
      <AssistantSidebar onOpenInTab={openInternalTab} />
    </div>
  )
}
