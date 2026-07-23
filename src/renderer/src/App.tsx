import { BILIBILI_HOME_URL } from '@shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  BrowserTabModel,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteLedger,
  FavoriteLedgerClassificationDiagnostic,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  FavoriteKeywordSuggestion,
  PendingFavoriteQueueItem,
  VideoNote,
  VideoNoteExtractionResult,
  VideoAudioTranscriptionQueueSnapshot
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runVisualFavoriteFallback } from './features/actions/visualFavoriteFallback'
import { executeAssistantAction } from './features/actions/actionExecutor'
import { buildFavoriteApiAdjustmentScript } from './features/actions/favoriteApiAutomation'
import { BiliWebview } from './features/browser/BiliWebview'
import {
  buildVideoContentContextScript,
  classifyVideoContent,
  type VideoContentContext
} from './features/recommendation/videoClassifier'
import { planFavoriteArchiveTargets } from './features/recommendation/archivePlanning'
import {
  createInitialAssistantPreferences,
  effectiveFavoriteLedgersForAccount,
  favoriteLedgersForAccount,
  withFavoriteLedgersForAccount
} from './features/state/assistantState'
import { parseFavoriteLedgerRules } from '@shared/favoriteLedgerConstraints'
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
  buildFavoriteLedgerStatusScript,
  buildSaveFavoriteLedgersScript,
} from './features/favorites/favoriteLedgerApi'
import { createFavoriteRepositoryPageTarget } from './features/favorites/favoriteRepositoryPageTarget'
import {
  createOldFavoriteWorkspacePageBridge,
  type OldFavoriteWorkspacePageCommand
} from './features/favorites/oldFavoriteWorkspacePageBridge'
import { createLocalVideoNoteDraft } from './features/notes/videoNoteSummarizer'
import { parseManualTranscript } from './features/notes/transcriptNormalizer'
import { recordAssistantPreferenceFeedback } from './features/state/assistantState'
import type {
  AssistantRuntimeRequest,
  AssistantSnapshot,
  OldFavoriteBatchCommitResult,
  FavoriteRepositoryPageTarget
} from './features/assistant/assistantRuntimeTypes'
import { AssistantSidebar } from './features/assistant/AssistantSidebar'
import { FavoriteLibraryDrawer } from './features/favorites/FavoriteLibraryDrawer'
import { PET_VIDEO_OPENING_LINES, pickPetLine } from './features/assistant/petInteractionLines'
import { publishDeepSeekTask } from './features/assistant/deepSeekTaskSignal'
import { composeMemorialComments } from './features/comments/commentComposer'
import { createCorrectionDraft } from './features/recommendation/correctionLearning'

const HOME_TAB_ID = 'home'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/([^/?#]+)/i
export const VIDEO_FULLSCREEN_PET_CLOSE_DELAY_MS = 900
const IS_TEST_RUNTIME = import.meta.env.MODE === 'test'
const DAILY_DEEPSEEK_PRE_ACTION_WAIT_MS = IS_TEST_RUNTIME ? 0 : 1200
const DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS = IS_TEST_RUNTIME ? 50 : 60_000
const AUTOMATED_PAGE_HINT_COOLDOWN_MS = 750
let browserTabIdIndex = 0
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

type StartupPermissionGateProps = {
  onContinue: () => void
}

function StartupPermissionGate({ onContinue }: StartupPermissionGateProps) {
  return (
    <main className="startup-permission" aria-label="启动前权限检查">
      <section className="startup-permission__panel">
        <p className="startup-permission__eyebrow">bilimi</p>
        <h1>启动前权限检查</h1>
        <p className="startup-permission__lead">
          Windows 可能会询问是否允许 bilimi 访问网络。请点击允许，建议至少允许专用网络，
          否则登录、B 站页面操作、音频转写和 AI 功能可能无法正常工作。
        </p>
        <div className="startup-permission__actions">
          <button type="button" onClick={onContinue}>
            打开 bilimi
          </button>
        </div>
      </section>
    </main>
  )
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

function createTabId(): string {
  browserTabIdIndex += 1
  return `tab-${Date.now()}-${browserTabIdIndex}`
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

function pickRandomCommentDraft(drafts: string[]) {
  const index = Math.min(drafts.length - 1, Math.floor(Math.random() * drafts.length))
  return drafts[index] ?? ''
}

type TrustedPlayerActivationResult = AssistantAutomationResult & {
  clickPoint?: { x: number; y: number } | null
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


      result.clickPoint = clickPoint;
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

function ledgerDisplayName(ledgers: FavoriteLedger[], ledgerId: string) {
  return ledgers.find((ledger) => ledger.id === ledgerId)?.displayName ?? ledgerId
}

function uniqueLedgerIds(ledgerIds: string[]) {
  return Array.from(new Set(ledgerIds.filter((ledgerId) => ledgerId.trim()).map((ledgerId) => ledgerId.trim())))
}

function diagnosticsForTargets(
  targets: FavoriteArchiveTarget[],
  fallbackDiagnostic?: FavoriteLedgerClassificationDiagnostic
) {
  const diagnostics = targets.flatMap((target) =>
    target.diagnostic ? [{ ledgerId: target.ledgerId, ...target.diagnostic }] : []
  )

  if (diagnostics.length === 0 && fallbackDiagnostic) {
    return [{ ledgerId: 'inbox', ...fallbackDiagnostic }]
  }

  return diagnostics
}

function shouldReviewDailyClassification(
  mode: AssistantPreferences['deepseekDailyClassificationMode'],
  diagnostics: Array<FavoriteLedgerClassificationDiagnostic & { ledgerId: string }>
) {
  if (mode === 'all') {
    return true
  }

  if (diagnostics.length === 0) {
    return true
  }

  return diagnostics.some(
    (diagnostic) =>
      diagnostic.lowConfidence ||
      diagnostic.confidence === 'low' ||
      diagnostic.scoreGap < 2.5 ||
      diagnostic.negativeRules.length > 0 ||
      (diagnostic.strongSignals.length === 0 && diagnostic.weakSignals.length > 0)
  )
}

function actionUsesFavorite(action: AssistantAction) {
  return action === '赏' || action === '藏' || action === '赐'
}

function mergeKeywordSuggestions(
  existing: FavoriteKeywordSuggestion[],
  incoming: FavoriteKeywordSuggestion[]
) {
  const existingIds = new Set(existing.map((suggestion) => suggestion.id))
  const existingSignatures = new Set(existing.map((suggestion) => [
    suggestion.action,
    suggestion.ledgerId,
    suggestion.keyword?.trim().toLocaleLowerCase() ?? '',
    suggestion.replacement?.trim().toLocaleLowerCase() ?? ''
  ].join('::')))
  const nextIncomingSuggestions: FavoriteKeywordSuggestion[] = []

  for (const suggestion of incoming) {
    const signature = [
      suggestion.action,
      suggestion.ledgerId,
      suggestion.keyword?.trim().toLocaleLowerCase() ?? '',
      suggestion.replacement?.trim().toLocaleLowerCase() ?? ''
    ].join('::')
    if (existingIds.has(suggestion.id) || existingSignatures.has(signature)) {
      continue
    }
    existingIds.add(suggestion.id)
    existingSignatures.add(signature)
    nextIncomingSuggestions.push(suggestion)
  }

  return [...existing, ...nextIncomingSuggestions]
}

type DailyClassificationReviewResult = Extract<
  DeepSeekGenerateResult,
  { kind: 'favorite-daily-classify-review' }
>

type DailyDeepSeekCorrection = {
  originalLedgerId: string
  targetLedgerIds: string[]
  reason: string
  keywordSuggestions: FavoriteKeywordSuggestion[]
}

function sameLedgerSet(left: string[], right: string[]) {
  const leftSet = new Set(uniqueLedgerIds(left))
  const rightSet = new Set(uniqueLedgerIds(right))

  return leftSet.size === rightSet.size && Array.from(leftSet).every((ledgerId) => rightSet.has(ledgerId))
}

function appliedDeepSeekConstraintNames(
  favoriteLedgers: FavoriteLedger[],
  reviewResult?: DailyClassificationReviewResult
) {
  return uniqueLedgerIds(reviewResult?.appliedConstraintLedgerIds ?? [])
    .filter((ledgerId) => favoriteLedgers.some((ledger) => ledger.id === ledgerId && ledger.enabled))
    .map((ledgerId) => ledgerDisplayName(favoriteLedgers, ledgerId))
}

function dailyReviewFeedback(input: {
  favoriteLedgers: FavoriteLedger[]
  localTargetLedgerIds: string[]
  reviewResult?: DailyClassificationReviewResult
}) {
  const localNames = input.localTargetLedgerIds
    .map((ledgerId) => ledgerDisplayName(input.favoriteLedgers, ledgerId))
    .join('、')
  const constraintNames = appliedDeepSeekConstraintNames(input.favoriteLedgers, input.reviewResult)
  const reviewAgreed = Boolean(input.reviewResult && !input.reviewResult.invalid)
  const constraintDetail = constraintNames.length
    ? `DeepSeek 约束生效：「${constraintNames.join('、')}」`
    : '本次未命中收藏夹约束'
  return reviewAgreed
    ? `DeepSeek 二判完成：${constraintDetail}；与本地判断一致，保留在「${localNames}」。`
    : `DeepSeek 二判未完成：${constraintDetail}；本次沿用本地判断「${localNames}」。`
}

function dailyCorrectionFromReview(args: {
  favoriteLedgers: FavoriteLedger[]
  localTargetLedgerId: string
  localTargetLedgerIds: string[]
  reviewResult?: DailyClassificationReviewResult
}): DailyDeepSeekCorrection | undefined {
  if (
    !args.reviewResult?.corrected ||
    args.reviewResult.invalid ||
    args.reviewResult.targetLedgerIds.length === 0
  ) {
    return undefined
  }

  const usableTargetLedgerIds = uniqueLedgerIds(args.reviewResult.targetLedgerIds).filter(
    (ledgerId) =>
      ledgerId === 'inbox' ||
      args.favoriteLedgers.some((ledger) => ledger.id === ledgerId && ledger.enabled)
  )

  if (
    usableTargetLedgerIds.length === 0 ||
    sameLedgerSet(usableTargetLedgerIds, args.localTargetLedgerIds)
  ) {
    return undefined
  }

  return {
    originalLedgerId: args.localTargetLedgerId,
    targetLedgerIds: usableTargetLedgerIds,
    reason: args.reviewResult.reason,
    keywordSuggestions: args.reviewResult.keywordSuggestions
  }
}

function withResultMessagePrefix(
  result: AssistantAutomationResult,
  prefix: string,
  extra?: Pick<AssistantAutomationResult, 'missingTargets' | 'steps'>
): AssistantAutomationResult {
  const normalizedPrefix = prefix.trim()

  return {
    ...result,
    steps: extra?.steps ? [...result.steps, ...extra.steps] : result.steps,
    missingTargets: extra?.missingTargets
      ? [...result.missingTargets, ...extra.missingTargets]
      : result.missingTargets,
    message: result.message ? `${normalizedPrefix}\n${result.message}` : normalizedPrefix
  }
}

async function waitForDelay(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

async function waitForDailyReviewBeforeAction(
  reviewPromise: Promise<DailyClassificationReviewResult | undefined>
): Promise<
  | { status: 'ready'; result?: DailyClassificationReviewResult }
  | { status: 'pending' }
> {
  const pending = 'daily-review-pending' as const
  const result: DailyClassificationReviewResult | undefined | typeof pending = await Promise.race([
    reviewPromise,
    waitForDelay(DAILY_DEEPSEEK_PRE_ACTION_WAIT_MS).then(() => pending)
  ])

  if (result === pending) {
    return { status: 'pending' }
  }

  return { status: 'ready', result }
}

async function withTimeout<T>(
  promise: Promise<T>,
  delayMs: number,
  fallback: T
): Promise<T> {
  return Promise.race([promise, waitForDelay(delayMs).then(() => fallback)])
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
  const [favoriteLibraryOpen, setFavoriteLibraryOpen] = useState(false)
  const [favoriteLibraryCollapsed, setFavoriteLibraryCollapsed] = useState(false)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)
  const [webviews, setWebviews] = useState<Record<string, Electron.WebviewTag>>({})
  const webviewRefs = useRef<Record<string, Electron.WebviewTag>>({})
  const favoriteRepositoryPageTargetRef = useRef<ReturnType<typeof createFavoriteRepositoryPageTarget> | null>(null)
  const favoriteRepositoryTargetStates = useRef(new Map<number, FavoriteRepositoryPageTarget>())
  const activeTabChangeMounted = useRef(false)
  const lastPetVideoKey = useRef<string | undefined>(undefined)
  const assistantRuntimeFeedbackRef = useRef<{ id: number; message: string } | undefined>(undefined)
  const assistantSnapshotCacheRef = useRef<{
    accountMid: string
    favoriteLedgerStatus: FavoriteLedgerStatus | null
    videoContentContext: VideoContentContext
    videoContextUrl?: string
  }>({ accountMid: '', favoriteLedgerStatus: null, videoContentContext: {} })
  const favoriteLedgerEnsurePromisesRef = useRef(new Map<string, Promise<AssistantAutomationResult>>())
  const suppressPageInteractionHintsUntilRef = useRef(0)
  const petHiddenForVideoFullscreen = useRef(false)
  const videoFullscreenPetCloseTimer = useRef<number | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences(
      IS_TEST_RUNTIME ? { permissionOnboardingCompleted: true } : undefined
    )
  )
  const [preferencesLoaded, setPreferencesLoaded] = useState(IS_TEST_RUNTIME)
  const activeWebview = useMemo(() => webviews[activeTabId] ?? null, [activeTabId, webviews])
  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs]
  )

  useEffect(() => {
    return window.bilimiDesktop?.onOpenFavoriteLibraryDrawer?.((command) => {
      if (command === 'toggle' && favoriteLibraryOpen && !favoriteLibraryCollapsed) {
        setFavoriteLibraryOpen(false)
        return
      }
      setFavoriteLibraryCollapsed(false)
      setFavoriteLibraryOpen(true)
    })
  }, [favoriteLibraryCollapsed, favoriteLibraryOpen])

  const commitTabs = useCallback(
    (updater: (currentTabs: BrowserTabModel[]) => BrowserTabModel[]) => {
      const nextTabs = updater(tabsRef.current)
      tabsRef.current = nextTabs
      setTabs(nextTabs)
    },
    []
  )

  const selectActiveTab = useCallback((nextActiveTabId: string) => {
    if (activeTabIdRef.current !== nextActiveTabId) {
      assistantSnapshotCacheRef.current.accountMid = ''
    }
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
        if (!cancelled) {
          setPreferences(
            createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
          )
          setPreferencesLoaded(true)
        }
        return
      }

      try {
        const next = await window.bilimiDesktop.loadPreferences()

        if (!cancelled) {
          if (next) {
            setPreferences(createInitialAssistantPreferences(next))
          } else {
            setPreferences(
              createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
            )
          }
          setPreferencesLoaded(true)
        }
      } catch {
        if (!cancelled) {
          setPreferences(
            createInitialAssistantPreferences({ permissionOnboardingCompleted: true })
          )
          setPreferencesLoaded(true)
        }
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

  async function completeStartupPermissionGate() {
    const nextPreferences = createInitialAssistantPreferences({
      ...preferences,
      permissionOnboardingCompleted: true
    })

    setPreferences(nextPreferences)
    if (window.bilimiDesktop?.savePreferences) {
      const saved = window.bilimiDesktop.patchPreferences
        ? await window.bilimiDesktop.patchPreferences({ permissionOnboardingCompleted: true })
        : await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

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

  const handleFavoriteRepositoryTargetState = useCallback((
    _tabId: string,
    state: FavoriteRepositoryPageTarget & { webview: Electron.WebviewTag }
  ) => {
    favoriteRepositoryTargetStates.current.set(state.webContentsId, {
      webContentsId: state.webContentsId,
      instanceId: state.instanceId,
      navigationEpoch: state.navigationEpoch
    })
  }, [])

  const openInternalTab = useCallback((url: string) => {
    const nextUrl = url.trim()

    if (!nextUrl) {
      return
    }

    commitTabs((currentTabs) => {
      const nextTab = {
        id: createTabId(),
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
        assistantSnapshotCacheRef.current.accountMid = ''
        assistantSnapshotCacheRef.current.videoContextUrl = url
        assistantSnapshotCacheRef.current.videoContentContext = {
          title: normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ?? createTabTitle(url)
        }
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
        assistantSnapshotCacheRef.current.videoContextUrl = getActiveTabSnapshot()?.url
        assistantSnapshotCacheRef.current.videoContentContext = {
          ...assistantSnapshotCacheRef.current.videoContentContext,
          title: normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ?? title
        }
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

  async function runFavoriteRepositoryPageOperation(
    accountMid: string,
    runId: string,
    target: FavoriteRepositoryPageTarget,
    action: 'append' | 'remove' | 'unfavorite' | 'read-members' | 'read-folder-inventory' | 'create-folder' | 'delete-folder',
    input: { accountMid: string; operationKey: string; aid?: number; folderIds?: string[]; title?: string; folderId?: string }
  ) {
    favoriteRepositoryPageTargetRef.current ??= createFavoriteRepositoryPageTarget({
      getActiveWebview: getCurrentActiveWebview,
      findWebviewById: (webContentsId) => Object.values(webviewRefs.current).find(
        (webview) => webview.getWebContentsId?.() === webContentsId
      ),
      getNavigationEpoch: (webContentsId, instanceId) => {
        const current = favoriteRepositoryTargetStates.current.get(webContentsId)
        return current?.instanceId === instanceId ? current.navigationEpoch : undefined
      }
    })
    if (input.accountMid !== accountMid) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'account-mismatch' }
    }
    return favoriteRepositoryPageTargetRef.current.run(target, action, input)
  }

  async function bindFavoriteRepositoryPageTarget(accountMid: string) {
    const webview = getCurrentActiveWebview()
    const webContentsId = webview?.getWebContentsId?.()
    let target = typeof webContentsId === 'number' ? favoriteRepositoryTargetStates.current.get(webContentsId) : undefined
    if (!target && typeof webContentsId === 'number') {
      // A restored guest can finish loading before BiliWebview attaches its
      // listeners. Recreate state for this active guest only, then still
      // verify its account and navigation epoch before returning a target.
      target = {
        webContentsId,
        instanceId: webview.getAttribute('data-favorite-repository-instance-id') || `bili-webview-rehydrated:${webContentsId}`,
        navigationEpoch: 0
      }
      favoriteRepositoryTargetStates.current.set(webContentsId, target)
    }
    if (!target || webview?.isLoading?.() || !webview?.executeJavaScript) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
    try {
      const before = String(await webview.executeJavaScript(
        `(() => String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=(\\d+)/)?.[1] || '')()`, true
      )).trim()
      if (before !== accountMid || favoriteRepositoryTargetStates.current.get(webContentsId)?.navigationEpoch !== target.navigationEpoch) {
        return { status: 'unknown' as const, observedAccountMid: before, reason: 'account-mismatch' }
      }
      return { status: 'ok' as const, observedAccountMid: before, target }
    } catch {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
  }

  async function runOldFavoriteWorkspacePageCommand(
    accountMid: string,
    target: FavoriteRepositoryPageTarget,
    command: OldFavoriteWorkspacePageCommand
  ) {
    const active = getCurrentActiveWebview()
    const activeId = active?.getWebContentsId?.()
    const current = typeof activeId === 'number' ? favoriteRepositoryTargetStates.current.get(activeId) : undefined
    if (!active || !current || active.isLoading?.() || !active.executeJavaScript ||
      current.webContentsId !== target.webContentsId || current.instanceId !== target.instanceId ||
      current.navigationEpoch !== target.navigationEpoch) {
      return { status: 'unknown' as const, observedAccountMid: '', reason: 'target-unavailable' }
    }
    const bridge = createOldFavoriteWorkspacePageBridge({
      execute: (_target, script) => active.executeJavaScript(script, true)
    })
    const result = await bridge.run(target, command)
    const after = favoriteRepositoryTargetStates.current.get(activeId)
    if (!after || after.instanceId !== target.instanceId || after.navigationEpoch !== target.navigationEpoch) {
      return { status: 'unknown' as const, observedAccountMid: result.observedAccountMid, reason: 'target-navigated' }
    }
    return result
  }

  function refreshActiveTab() {
    getCurrentActiveWebview()?.reload?.()
  }

  async function readVideoContentContext(): Promise<VideoContentContext> {
    const currentActiveWebview = getCurrentActiveWebview()
    const activeTabSnapshot = getActiveTabSnapshot()
    const activeTabVideoTitle = normalizeActiveTabVideoTitle(activeTabSnapshot)

    if (!currentActiveWebview?.executeJavaScript) {
      const context = { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = context
      return context
    }

    try {
      const context = (await currentActiveWebview.executeJavaScript(
        buildVideoContentContextScript(),
        true
      )) as VideoContentContext
      const normalizedContext = activeTabVideoTitle ? { ...context, title: activeTabVideoTitle } : context
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = normalizedContext
      return normalizedContext
    } catch {
      const context = { title: activeTabVideoTitle ?? activeTabSnapshot?.title }
      assistantSnapshotCacheRef.current.videoContextUrl = activeTabSnapshot?.url
      assistantSnapshotCacheRef.current.videoContentContext = context
      return context
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

  async function readBilibiliAccountMid(): Promise<string> {
    if (window.bilimiDesktop?.readBilibiliAccountMid) {
      try {
        const accountMid = (await window.bilimiDesktop.readBilibiliAccountMid()).trim()
        assistantSnapshotCacheRef.current.accountMid = accountMid
        return accountMid
      } catch {
        assistantSnapshotCacheRef.current.accountMid = ''
        return ''
      }
    }
    const currentActiveWebview = getCurrentActiveWebview()
    if (!currentActiveWebview?.executeJavaScript) return ''
    try {
      const accountMid = String(await currentActiveWebview.executeJavaScript(
        `(() => String(document.cookie || '').match(/(?:^|;\\s*)DedeUserID=([^;]+)/)?.[1] || '')()`,
        true
      )).trim()
      assistantSnapshotCacheRef.current.accountMid = accountMid
      return accountMid
    } catch {
      return ''
    }
  }

  async function requireBilibiliLogin(): Promise<AssistantAutomationResult | null> {
    return (await isBilibiliLoggedIn()) ? null : LOGIN_REQUIRED_RESULT
  }

  function favoriteLedgersForActiveAccount(accountMid: string): FavoriteLedger[] {
    return accountMid ? favoriteLedgersForAccount(preferences, accountMid) : preferences.favoriteLedgers
  }

  function preferencesWithFavoriteLedgers(
    currentPreferences: AssistantPreferences,
    accountMid: string,
    favoriteLedgers: FavoriteLedger[]
  ): AssistantPreferences {
    return accountMid
      ? withFavoriteLedgersForAccount(currentPreferences, accountMid, favoriteLedgers)
      : { ...currentPreferences, favoriteLedgers }
  }

  async function readFavoriteLedgerStatus(): Promise<FavoriteLedgerStatus> {
    const accountMid = assistantSnapshotCacheRef.current.accountMid || await readBilibiliAccountMid()
    const favoriteLedgers = favoriteLedgersForActiveAccount(accountMid)
    const status = await runScript(
      buildFavoriteLedgerStatusScript(favoriteLedgers)
    ) as unknown as Partial<FavoriteLedgerStatus> & AssistantAutomationResult

    if (Array.isArray(status.ledgers) && Array.isArray(status.missingLedgerIds)) {
      assistantSnapshotCacheRef.current.favoriteLedgerStatus = status as FavoriteLedgerStatus
      setPreferences((currentPreferences) =>
        createInitialAssistantPreferences({
          ...preferencesWithFavoriteLedgers(
            currentPreferences,
            accountMid,
            status.ledgers ?? favoriteLedgers
          )
        })
      )

      return status as FavoriteLedgerStatus
    }

    const fallbackStatus = {
      ok: false,
      ledgers: favoriteLedgers,
      missingLedgerIds: [],
      message: status.message
    }
    assistantSnapshotCacheRef.current.favoriteLedgerStatus = fallbackStatus
    return fallbackStatus
  }

  async function ensureFavoriteLedgersForAccount(accountMid: string): Promise<AssistantAutomationResult> {
    const favoriteLedgers = favoriteLedgersForActiveAccount(accountMid)

    const result = await runScript(
      buildEnsureFavoriteLedgersScript(favoriteLedgers)
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      const nextPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferences, accountMid, result.ledgers)
      })
      setPreferences(nextPreferences)

      if (window.bilimiDesktop?.savePreferences) {
        const saved = window.bilimiDesktop.patchPreferences
          ? await window.bilimiDesktop.patchPreferences(
              accountMid
                ? { favoriteAccountPreferences: nextPreferences.favoriteAccountPreferences }
                : { favoriteLedgers: result.ledgers }
            )
          : await window.bilimiDesktop.savePreferences(nextPreferences)
        setPreferences(createInitialAssistantPreferences(saved))
      }

      assistantSnapshotCacheRef.current.favoriteLedgerStatus = {
        ok: result.ok,
        ledgers: result.ledgers,
        missingLedgerIds: Array.isArray(result.missingTargets) ? result.missingTargets : [],
        backupConflictLedgerIds: Array.isArray(result.backupConflictLedgerIds)
          ? result.backupConflictLedgerIds
          : [],
        message: result.message
      }
      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
    }

    return result
  }

  async function ensureFavoriteLedgers(): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const accountMid = await readBilibiliAccountMid()
    if (accountMid && preferences.favoriteAccountPreferences?.[accountMid]?.defaultFavoriteSystemEnabled === false) {
      return {
        ok: false,
        steps: [],
        missingTargets: [],
        message: '默认收藏夹体系已关闭，备册不会创建远端收藏夹。'
      }
    }
    const accountKey = accountMid || '__active-account__'
    const existing = favoriteLedgerEnsurePromisesRef.current.get(accountKey)
    if (existing) return existing

    const operation = ensureFavoriteLedgersForAccount(accountMid)
    favoriteLedgerEnsurePromisesRef.current.set(accountKey, operation)
    try {
      return await operation
    } finally {
      if (favoriteLedgerEnsurePromisesRef.current.get(accountKey) === operation) {
        favoriteLedgerEnsurePromisesRef.current.delete(accountKey)
      }
    }
  }

  async function saveFavoriteLedgers(
    nextLedgers: FavoriteLedger[],
    options?: FavoriteLedgerSaveOptions
  ): Promise<AssistantAutomationResult> {
    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const accountMid = await readBilibiliAccountMid()
    const previousLedgers = favoriteLedgersForActiveAccount(accountMid)

    const result = await runScript(
      buildSaveFavoriteLedgersScript(nextLedgers, previousLedgers, options)
    ) as AssistantAutomationResult & Partial<FavoriteLedgerStatus>

    if (Array.isArray(result.ledgers)) {
      const nextPreferences = createInitialAssistantPreferences({
        ...preferencesWithFavoriteLedgers(preferences, accountMid, result.ledgers)
      })
      setPreferences(nextPreferences)

      if (window.bilimiDesktop?.savePreferences) {
        const saved = window.bilimiDesktop.patchPreferences
          ? await window.bilimiDesktop.patchPreferences(
              accountMid
                ? { favoriteAccountPreferences: nextPreferences.favoriteAccountPreferences }
                : { favoriteLedgers: result.ledgers }
            )
          : await window.bilimiDesktop.savePreferences(nextPreferences)
        setPreferences(createInitialAssistantPreferences(saved))
      }

      window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
    }

    return result
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

    const wait = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay))
    currentActiveWebview.focus?.()

    const sendKey = (
      keyCode: string,
      modifiers?: Electron.KeyboardInputEvent['modifiers']
    ) => {
      const keyDown: Electron.KeyboardInputEvent = modifiers
        ? { keyCode, modifiers, type: 'keyDown' }
        : { keyCode, type: 'keyDown' }
      const keyUp: Electron.KeyboardInputEvent = modifiers
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

    const writeDanmakuDraftToClipboard = async () => {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(commentDraft)
          return true
        } catch {
          // Electron's Web Clipboard API can reject when the window is not focused.
        }
      }

      if (window.bilimiDesktop?.writeClipboardText) {
        try {
          await window.bilimiDesktop.writeClipboardText(commentDraft)
          return true
        } catch {
          return false
        }
      }

      return false
    }

    if (!(await writeDanmakuDraftToClipboard())) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['trusted-danmaku-clipboard'],
        message: '弹幕文案写入剪贴板失败，请重新点击表再试。'
      }
    }

    const activationSteps: string[] = []
    let playbackPausedBeforeActivation: boolean | null = null
    try {
      const activation = (await currentActiveWebview.executeJavaScript(
        buildTrustedPlayerActivationScript(),
        true
      )) as TrustedPlayerActivationResult

      if (activation?.ok && activation.clickPoint) {
        playbackPausedBeforeActivation = activation.paused ?? null
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

    currentActiveWebview.focus?.()
    sendKey('v', ['control'])
    const pasteSteps = ['danmaku:trusted-paste']
    await wait(120)

    const submitSteps = ['danmaku:trusted-enter']
    sendKey('Enter')
    await wait(120)
    if (playbackPausedBeforeActivation !== null) {
      try {
        const playbackRestore = (await currentActiveWebview.executeJavaScript(
          buildRestorePlayerPlaybackStateScript(playbackPausedBeforeActivation),
          true
        )) as AssistantAutomationResult
        submitSteps.push(...(playbackRestore?.steps ?? []))
      } catch {
        submitSteps.push('player:playback:restore-after-submit-skipped')
      }
    }

    return {
      ok: true,
      steps: [...activationSteps, ...pasteSteps, ...submitSteps],
      missingTargets: [],
      message: '弹幕已发送，没有看到请检查弹幕开关是否开启'
    }
  }

  async function saveVideoNote(note: VideoNote): Promise<void> {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  function createAssistantSnapshot(): AssistantSnapshot {
    const activeTabSnapshot = getActiveTabSnapshot()
    const activeTabVideoTitle = normalizeActiveTabVideoTitle(activeTabSnapshot)
    const cachedContext = assistantSnapshotCacheRef.current.videoContextUrl === activeTabSnapshot?.url
      ? assistantSnapshotCacheRef.current.videoContentContext
      : {}
    const videoContentContext = activeTabVideoTitle
      ? { ...cachedContext, title: activeTabVideoTitle }
      : cachedContext

    return {
      accountMid: assistantSnapshotCacheRef.current.accountMid,
      preferences,
      favoriteLedgerStatus: assistantSnapshotCacheRef.current.favoriteLedgerStatus,
      videoContentContext,
      activeTabUrl: activeTabSnapshot?.url,
      runtimeFeedback: assistantRuntimeFeedbackRef.current?.message,
      runtimeFeedbackId: assistantRuntimeFeedbackRef.current?.id,
      videoTitle:
        activeTabVideoTitle ??
        videoContentContext.title ??
        '等待视频加载'
    }
  }

  function ledgerNames(ledgerIds: string[]): string {
    return ledgerIds
      .map((ledgerId) => ledgerDisplayName(preferences.favoriteLedgers, ledgerId))
      .join('、')
  }

  function publishRuntimeFeedback(message: string) {
    assistantRuntimeFeedbackRef.current = {
      id: (assistantRuntimeFeedbackRef.current?.id ?? 0) + 1,
      message
    }
    window.bilimiDesktop?.notifyAssistantSnapshotChanged?.()
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
    const actionTabSnapshot = getActiveTabSnapshot()
    if (!isBilibiliVideoUrl(actionTabSnapshot?.url)) {
      return NO_CURRENT_VIDEO_RESULT
    }

    const loginFailure = await requireBilibiliLogin()
    if (loginFailure) {
      return loginFailure
    }

    const actionAccountMid = assistantSnapshotCacheRef.current.accountMid || await readBilibiliAccountMid()
    const actionFavoriteLedgers = actionAccountMid
      ? effectiveFavoriteLedgersForAccount(preferences, actionAccountMid)
      : preferences.favoriteLedgers
    const videoContentContext = await readVideoContentContext()
    const archiveTargets = planFavoriteArchiveTargets({
      context: videoContentContext,
      ledgers: actionFavoriteLedgers,
      multiArchiveMode: preferences.favoriteArchiveMultiMode
    })
    const localClassification = classifyVideoContent(videoContentContext, actionFavoriteLedgers)
    const localTargetLedgerId =
      archiveTargets[0]?.ledgerId ??
      localClassification.ledgerId
    const localTargetLedgerIds =
      archiveTargets.length > 0
        ? archiveTargets.map((target) => target.ledgerId)
        : [localTargetLedgerId]
    const localDiagnostics = diagnosticsForTargets(archiveTargets, localClassification.diagnostic)
    let targetLedgerId = localTargetLedgerId
    let targetLedgerIds = localTargetLedgerIds
    let resultMessagePrefix: string | undefined
    let preActionCorrectionTargets: string[] | undefined
    let deepSeekCorrection: DailyDeepSeekCorrection | undefined
    let postActionDailyReviewPromise: Promise<DailyClassificationReviewResult | undefined> | undefined

    if (
      actionUsesFavorite(action) &&
      preferences.deepseekEnabled &&
      preferences.deepseekApiKeyStored &&
      preferences.deepseekDailyClassificationEnabled &&
      window.bilimiDesktop?.generateDeepSeek &&
      shouldReviewDailyClassification(preferences.deepseekDailyClassificationMode, localDiagnostics)
    ) {
      const reviewRequest: DeepSeekGenerateRequest = {
        kind: 'favorite-daily-classify-review',
        video: videoContentContext,
        localClassification: {
          targetLedgerIds: localTargetLedgerIds,
          primaryLedgerId: localTargetLedgerId,
          displayNames: localTargetLedgerIds.map((ledgerId) =>
            ledgerDisplayName(actionFavoriteLedgers, ledgerId)
          ),
          reason: localClassification.matchedKeywords.length
            ? `本地命中：${localClassification.matchedKeywords.join('、')}`
            : undefined,
          diagnostics: localDiagnostics
        },
        ledgers: actionFavoriteLedgers.map((ledger) => {
          const parsedRules = parseFavoriteLedgerRules(ledger)
          return {
            id: ledger.id,
            displayName: ledger.displayName,
            keywords: parsedRules.localKeywords,
            deepSeekConstraint: parsedRules.deepSeekConstraint,
            ruleType: ledger.ruleType,
            enabled: ledger.enabled
          }
        })
      }
      const finishDeepSeekTask = publishDeepSeekTask({
        id: `classification:${videoContentContext.bvid ?? videoContentContext.aid ?? 'video'}:${Date.now()}:${Math.random()}`,
        kind: 'classification',
        detail: `分类二判：${videoContentContext.title || '当前视频'}`
      })
      const reviewPromise = window.bilimiDesktop
        .generateDeepSeek(reviewRequest)
        .then((reviewResult): DailyClassificationReviewResult | undefined =>
          reviewResult?.kind === 'favorite-daily-classify-review' ? reviewResult : undefined
        )
        .catch(() => undefined)
        .finally(finishDeepSeekTask)
      const reviewBeforeAction = await waitForDailyReviewBeforeAction(reviewPromise)

      if (reviewBeforeAction.status === 'pending') {
        postActionDailyReviewPromise = reviewPromise
      } else {
        const correction = dailyCorrectionFromReview({
          favoriteLedgers: actionFavoriteLedgers,
          localTargetLedgerId,
          localTargetLedgerIds,
          reviewResult: reviewBeforeAction.result
        })

        if (correction) {
          targetLedgerIds = correction.targetLedgerIds
          targetLedgerId = correction.targetLedgerIds[0]
          preActionCorrectionTargets = correction.targetLedgerIds
          deepSeekCorrection = correction
        } else {
          resultMessagePrefix = dailyReviewFeedback({
            favoriteLedgers: actionFavoriteLedgers,
            localTargetLedgerIds,
            reviewResult: reviewBeforeAction.result
          })
          if (reviewBeforeAction.result && !reviewBeforeAction.result.invalid) {
            const localNames = ledgerNames(localTargetLedgerIds)
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'happy',
              message: `主人，DeepSeek复核过啦～与原建议一致，存入「${localNames}」。`
            })
          }
        }
      }
    }
    const commentDraft =
      action === '表' &&
      (options?.submitComment ?? preferences.commentSubmitMode === 'random') &&
      !options?.commentDraft?.trim()
        ? pickRandomCommentDraft(
            composeMemorialComments(
              targetLedgerId,
              normalizeActiveTabVideoTitle(getActiveTabSnapshot()) ??
                videoContentContext.title ??
                '等待视频加载',
              videoContentContext.author
            )
          )
        : options?.commentDraft
    const currentTabSnapshot = getActiveTabSnapshot()
    if (
      currentTabSnapshot?.id !== actionTabSnapshot?.id ||
      readBilibiliVideoKey(currentTabSnapshot?.url ?? '') !==
        readBilibiliVideoKey(actionTabSnapshot?.url ?? '')
    ) {
      return {
        ok: false,
        steps: [],
        missingTargets: ['active-video-changed'],
        message: '页面已切换，本次操作未执行。'
      }
    }
    let result: AssistantAutomationResult
    suppressPageInteractionHintsUntilRef.current = Number.POSITIVE_INFINITY
    try {
      result = await executeAssistantAction({
        action,
        favoritesFolderName: preferences.favoritesFolderName,
        runScript,
        runVisualFallback,
        runTrustedDanmakuSubmitFallback,
        favoriteApiFallbackEnabled: options?.pageClickOnly !== true,
        coinCount: options?.coinCount ?? (action === '赐' ? preferences.defaultCoinCount : undefined),
        commentDraft,
        submitComment:
          options?.submitComment ??
          (action === '表' ? preferences.commentSubmitMode === 'random' : undefined),
        favoriteLedgers: actionFavoriteLedgers,
        targetLedgerId,
        targetLedgerIds,
        resultMessagePrefix: undefined
      })
    } finally {
      suppressPageInteractionHintsUntilRef.current = Date.now() + AUTOMATED_PAGE_HINT_COOLDOWN_MS
    }

    if (preActionCorrectionTargets) {
      resultMessagePrefix = result.ok
        ? `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${ledgerNames(preActionCorrectionTargets)}」，已按二判结果执行。`
        : `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${ledgerNames(preActionCorrectionTargets)}」，但本次操作未完成。`
    }
    if (resultMessagePrefix?.startsWith('DeepSeek 二判')) {
      result = withResultMessagePrefix(result, resultMessagePrefix)
      publishRuntimeFeedback(resultMessagePrefix)
    }

    if (result.ok && action !== '阅') {
      if (targetLedgerId === 'inbox' && action === '藏') {
        const queueItem = pendingQueueItemFromCurrentVideo(videoContentContext, targetLedgerId)

        if (queueItem) {
          await window.bilimiDesktop?.upsertPendingFavoriteQueueItems?.([queueItem])
        }
      }

      const applyDailyCorrectionLearning = (
        basePreferences: AssistantPreferences,
        correction: DailyDeepSeekCorrection | undefined
      ) => {
        if (
          !correction ||
          !preferences.favoriteCorrectionLearningEnabled ||
          !Number.isFinite(Number(videoContentContext.aid))
        ) {
          return basePreferences
        }

        const diagnostic = localDiagnostics.find(
          (candidate) => candidate.ledgerId === correction.originalLedgerId
        )

        return createInitialAssistantPreferences({
          ...basePreferences,
          favoriteCorrectionRecords: [
            ...basePreferences.favoriteCorrectionRecords,
            createCorrectionDraft({
              aid: Number(videoContentContext.aid),
              title: videoContentContext.title || '未命名视频',
              originalLedgerId: correction.originalLedgerId,
              userLedgerIds: correction.targetLedgerIds,
              source: 'user-confirmed-deepseek',
              sourceScene: 'daily-favorite',
              author: videoContentContext.author,
              tags: videoContentContext.tags ?? [],
              matchedKeywords: diagnostic?.matchedKeywords ?? localClassification.matchedKeywords,
              score: diagnostic?.score,
              confidence: diagnostic?.confidence,
              scoreGap: diagnostic?.scoreGap
            })
          ],
          favoriteKeywordSuggestions: mergeKeywordSuggestions(
            basePreferences.favoriteKeywordSuggestions,
            correction.keywordSuggestions
          )
        })
      }

      let nextPreferences = applyDailyCorrectionLearning(
        recordAssistantPreferenceFeedback(preferences, targetLedgerId, action),
        deepSeekCorrection
      )
      setPreferences(nextPreferences)
      if (window.bilimiDesktop?.savePreferences) {
        const saved = window.bilimiDesktop.patchPreferences
          ? await window.bilimiDesktop.patchPreferences({
              preferenceCounts: nextPreferences.preferenceCounts,
              favoriteCorrectionRecords: nextPreferences.favoriteCorrectionRecords,
              favoriteKeywordSuggestions: nextPreferences.favoriteKeywordSuggestions
            })
          : await window.bilimiDesktop.savePreferences(nextPreferences)
        nextPreferences = createInitialAssistantPreferences(saved)
        setPreferences(nextPreferences)
        window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
      }

      if (postActionDailyReviewPromise) {
        void (async () => {
          const reviewResult = await withTimeout(
            postActionDailyReviewPromise,
            DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
            undefined
          )
          const correction = dailyCorrectionFromReview({
            favoriteLedgers: actionFavoriteLedgers,
            localTargetLedgerId,
            localTargetLedgerIds,
            reviewResult
          })

          if (!correction) {
            publishRuntimeFeedback(dailyReviewFeedback({
              favoriteLedgers: actionFavoriteLedgers,
              localTargetLedgerIds,
              reviewResult
            }))
            if (reviewResult && !reviewResult.invalid) {
              const localNames = ledgerNames(localTargetLedgerIds)
              window.bilimiDesktop?.setAssistantPetHint?.({
                tone: 'happy',
                message: `主人，DeepSeek复核过啦～与原建议一致，存入「${localNames}」。`
              })
            }
            return
          }

          const currentTabSnapshot = getActiveTabSnapshot()
          if (
            currentTabSnapshot?.id !== actionTabSnapshot?.id ||
            readBilibiliVideoKey(currentTabSnapshot?.url ?? '') !==
              readBilibiliVideoKey(actionTabSnapshot?.url ?? '')
          ) {
            publishRuntimeFeedback(
              `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${ledgerNames(correction.targetLedgerIds)}」，但页面已切换，本次未调整。`
            )
            return
          }

          const removeLedgerIds = localTargetLedgerIds.filter(
            (ledgerId) => ledgerId !== 'inbox' && !correction.targetLedgerIds.includes(ledgerId)
          )
          let adjustmentResult: AssistantAutomationResult
          try {
            adjustmentResult = await withTimeout(
              runScript(
                buildFavoriteApiAdjustmentScript(actionFavoriteLedgers, {
                  addLedgerIds: correction.targetLedgerIds,
                  removeLedgerIds
                })
              ),
              DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
              {
                ok: false,
                steps: ['api:favorite:adjust-timeout'],
                missingTargets: ['favorite-api-adjust-timeout'],
                message: 'DeepSeek 后台归类调整超时。'
              }
            )
          } catch (error) {
            adjustmentResult = {
              ok: false,
              steps: ['api:favorite:adjust-error'],
              missingTargets: ['favorite-api-adjust'],
              message:
                'DeepSeek 后台归类调整未能完成：' +
                (error instanceof Error ? error.message : String(error || '未知错误'))
            }
          }
          const targetNames = correction.targetLedgerIds
            .map((ledgerId) => ledgerDisplayName(actionFavoriteLedgers, ledgerId))
            .join('、')

          if (!adjustmentResult.ok) {
            publishRuntimeFeedback(
              `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${targetNames}」，但后台调整失败。`
            )
            window.bilimiDesktop?.setAssistantPetHint?.({
              tone: 'error',
              message: `主人，DeepSeek重新判断建议改存到「${targetNames}」，但调整没有成功，目前仍在「${ledgerNames(localTargetLedgerIds)}」。`
            })
            return
          }

          const correctedPreferences = applyDailyCorrectionLearning(nextPreferences, correction)
          setPreferences(correctedPreferences)
          if (window.bilimiDesktop?.savePreferences) {
            const saved = window.bilimiDesktop.patchPreferences
              ? await window.bilimiDesktop.patchPreferences({
                  favoriteCorrectionRecords: correctedPreferences.favoriteCorrectionRecords,
                  favoriteKeywordSuggestions: correctedPreferences.favoriteKeywordSuggestions
                })
              : await window.bilimiDesktop.savePreferences(correctedPreferences)
            setPreferences(createInitialAssistantPreferences(saved))
            window.bilimiDesktop.notifyAssistantSnapshotChanged?.()
          }
          publishRuntimeFeedback(
            `DeepSeek 二判完成：建议从「${ledgerNames(localTargetLedgerIds)}」改归「${targetNames}」，已完成调整。`
          )
          window.bilimiDesktop?.setAssistantPetHint?.({
            tone: 'happy',
            message: `主人，DeepSeek重新判断有调整哦～已从「${ledgerNames(localTargetLedgerIds)}」改存到「${targetNames}」。`
          })
        })()
      }
    }

    if (!result.ok && postActionDailyReviewPromise) {
      void (async () => {
        const reviewResult = await withTimeout(
          postActionDailyReviewPromise,
          DAILY_DEEPSEEK_BACKGROUND_TIMEOUT_MS,
          undefined
        )
        const correction = dailyCorrectionFromReview({
          favoriteLedgers: actionFavoriteLedgers,
          localTargetLedgerId,
          localTargetLedgerIds,
          reviewResult
        })
        const localNames = ledgerNames(localTargetLedgerIds)
        publishRuntimeFeedback(
          correction
            ? `DeepSeek 二判完成：建议从「${localNames}」改归「${ledgerNames(correction.targetLedgerIds)}」，但主操作未完成，本次未调整。`
            : reviewResult && !reviewResult.invalid
              ? `DeepSeek 二判完成：与本地判断一致，保留在「${localNames}」，但主操作未完成。`
              : `DeepSeek 二判未完成，本次沿用本地判断「${localNames}」，但主操作未完成。`
        )
      })()
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
      title: activeTabSnapshot?.title ?? '等待视频加载',
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
          if (window.bilimiDesktop?.readBilibiliAccountMid) await readBilibiliAccountMid()
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
        case 'favorite-repository-bind-page-target':
          return bindFavoriteRepositoryPageTarget(request.accountMid)
        case 'favorite-repository-page-operation':
          return runFavoriteRepositoryPageOperation(
            request.accountMid, request.runId, request.target, request.action, request.input
          )
        case 'old-favorite-workspace-bind-scan-target':
          return bindFavoriteRepositoryPageTarget(request.accountMid)
        case 'old-favorite-workspace-inventory':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'inventory', accountMid: request.accountMid
          })
        case 'old-favorite-workspace-read-source-page':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-source-page', accountMid: request.accountMid, folderId: request.folderId,
            page: request.page, pageSize: request.pageSize
          })
        case 'old-favorite-workspace-read-video-tags':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-video-tags', accountMid: request.accountMid, aid: request.aid
          })
        case 'old-favorite-workspace-read-managed-members':
          return runOldFavoriteWorkspacePageCommand(request.accountMid, request.target, {
            type: 'read-managed-members', accountMid: request.accountMid, folderIds: request.folderIds
          })
        default:
          throw new Error('Unknown assistant runtime request.')
      }
    })
  }, [
    generateRuntimeVideoNote,
    generateRuntimeVideoNoteFromAudio,
    openBilibiliFavorites,
    preferences,
    readFavoriteLedgerStatus,
    readCurrentVideoTime,
    readVideoContentContext,
    readVideoNoteSource,
    runAssistantRuntimeAction,
    saveFavoriteLedgers,
    saveVideoNote,
    seekVideoTime
  ])

  if (!preferencesLoaded) {
    return (
      <main className="startup-permission" aria-label="启动中">
        <section className="startup-permission__panel startup-permission__panel--compact">
          <p className="startup-permission__eyebrow">bilimi</p>
          <h1>启动中</h1>
        </section>
      </main>
    )
  }

  if (!preferences.permissionOnboardingCompleted) {
    return (
      <StartupPermissionGate
        onContinue={() => void completeStartupPermissionGate()}
      />
    )
  }

  return (
    <div className="app-shell" data-tabs-visible="true">
      <div className="app-main">
        <div className="browser-workspace">
        <div className="browser-tabs">
          <div className="browser-tabs__list" role="tablist" aria-label="网页标签">
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
                  <span className="browser-tabs__title">{tab.title}</span>
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
          <div className="browser-tabs__controls" aria-label="网页工具">
            <button
              type="button"
              className="browser-tabs__refresh"
              aria-label="刷新当前网页"
              title="刷新当前网页"
              onClick={refreshActiveTab}
            >
              <span aria-hidden="true">↻</span>
            </button>
            <span className="browser-tabs__collapse-slot" aria-hidden="true" />
          </div>
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
                if (Date.now() < suppressPageInteractionHintsUntilRef.current) {
                  return
                }
                window.bilimiDesktop?.setAssistantPetHint?.({ tone: 'hint', message })
              }}
              onReady={handleWebviewReady}
              onTargetState={handleFavoriteRepositoryTargetState}
              onTitleChange={updateTabTitle}
            />
          ))}
        </div>
        <FavoriteLibraryDrawer
          open={favoriteLibraryOpen}
          collapsed={favoriteLibraryCollapsed}
          onClose={() => setFavoriteLibraryOpen(false)}
          onCollapsedChange={setFavoriteLibraryCollapsed}
        />
        </div>
      </div>
      <AssistantSidebar onOpenInTab={openInternalTab} />
    </div>
  )
}
