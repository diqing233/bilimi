import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'
import { buildDanmakuSeekRepaintScript } from './danmakuSeekRepaint'
import { buildOpenLinksInAppScript } from './linkCaptureScript'
import { buildSeekVideoTimeScript } from '../notes/videoNoteTimeAutomation'
import {
  buildSelectArchivedVideoPartScript,
  hasArchivedVideoPartIdentity,
  type ArchivedVideoPartSelectionResult
} from './archivedVideoPartNavigation'

const OPEN_IN_TAB_TITLE_PREFIX = '__BILIMI_OPEN_IN_TAB__:'
const PET_HINT_TITLE_PREFIX = '__BILIMI_PET_HINT__:'
const FAVORITE_SPACE_MUTATION_TITLE_PREFIX = '__BILIMI_FAVORITE_SPACE_MUTATION__:'
const VIDEO_REPAINT_AFTER_HOST_RESIZE_DELAY_MS = 80

type BiliWebviewProps = {
  active: boolean
  tabId: string
  url: string
  onLocationChange?: (tabId: string, url: string) => void
  onOpenInTab?: (url: string) => void
  onReady?: (tabId: string, webview: Electron.WebviewTag) => void
  onInitialLoadSettled?: (tabId: string, outcome: 'success' | 'failure') => void
  onPageInteractionHint?: (message: string) => void
  onFavoriteSpaceMutationConfirmed?: (tabId: string, mutation: { accountMid: string; kind: 'create' | 'rename' | 'delete' }) => void
  hostResizePaused?: boolean
  onHtmlFullscreenChange?: (tabId: string, fullscreen: boolean) => void
  onTitleChange?: (tabId: string, title: string) => void
  onTargetState?: (tabId: string, state: {
    webview: Electron.WebviewTag
    webContentsId: number
    instanceId: string
    navigationEpoch: number
  }) => void
  /** A one-shot timestamp supplied when an archived video opens in a new tab. */
  seekSeconds?: number
  /** The archived source identity used to select the correct multi-part video before seeking. */
  seekAid?: number
  seekCid?: number
}

type WebviewUrlEvent = Event & {
  url?: string
  title?: string
  detail?: {
    url?: string
    title?: string
  }
}

type WebviewLoadFailureEvent = Event & {
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

type WebviewNavigationEvent = Event & { isMainFrame?: boolean; detail?: { isMainFrame?: boolean } }

function readEventUrl(event: WebviewUrlEvent): string | undefined {
  return event.detail?.url ?? event.url
}

function readEventTitle(event: WebviewUrlEvent): string | undefined {
  return event.detail?.title ?? event.title
}

function readOpenInTabTitleSignal(title: string): string | undefined {
  if (!title.startsWith(OPEN_IN_TAB_TITLE_PREFIX)) {
    return undefined
  }

  try {
    return decodeURIComponent(title.slice(OPEN_IN_TAB_TITLE_PREFIX.length))
  } catch {
    return undefined
  }
}

function readPetHintTitleSignal(title: string): string | undefined {
  if (!title.startsWith(PET_HINT_TITLE_PREFIX)) {
    return undefined
  }

  try {
    return decodeURIComponent(title.slice(PET_HINT_TITLE_PREFIX.length))
  } catch {
    return undefined
  }
}

function readFavoriteSpaceMutationTitleSignal(title: string): { accountMid: string; kind: 'create' | 'rename' | 'delete' } | undefined {
  if (!title.startsWith(FAVORITE_SPACE_MUTATION_TITLE_PREFIX)) return undefined
  try {
    const parsed = JSON.parse(decodeURIComponent(title.slice(FAVORITE_SPACE_MUTATION_TITLE_PREFIX.length))) as Record<string, unknown>
    const accountMid = typeof parsed.accountMid === 'string' ? parsed.accountMid.trim() : ''
    const kind = parsed.kind
    if (!/^\d+$/.test(accountMid) || !['create', 'rename', 'delete'].includes(String(kind))) return undefined
    return { accountMid, kind: kind as 'create' | 'rename' | 'delete' }
  } catch {
    return undefined
  }
}

function favoriteSpaceAccountMid(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'space.bilibili.com') return undefined
    return parsed.pathname.match(/^\/(\d+)\/favlist(?:$|\/)/u)?.[1]
  } catch {
    return undefined
  }
}

function buildFavoriteSpaceMutationObserverScript(): string {
  return `
    (() => {
      if (window.__bilimiFavoriteSpaceMutationObserverInstalled) return true;
      window.__bilimiFavoriteSpaceMutationObserverInstalled = true;
      const prefix = ${JSON.stringify(FAVORITE_SPACE_MUTATION_TITLE_PREFIX)};
      const normalizeMid = (value) => { const raw = String(value || '').trim(); return /^\\d+$/.test(raw) && raw !== '0' ? raw.replace(/^0+(?=\\d)/, '') : ''; };
      const emit = (kind) => {
        const accountMid = normalizeMid(String(document.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('DedeUserID='))?.slice('DedeUserID='.length) || '');
        const pathMatch = String(location.pathname || '').match(/^\\/(\\d+)\\/favlist(?:$|\\/)/);
        const pageAccountMid = normalizeMid(pathMatch?.[1] || '');
        if (!accountMid || !pageAccountMid || accountMid !== pageAccountMid) return;
        const previousTitle = document.title;
        const signal = prefix + encodeURIComponent(JSON.stringify({ accountMid, kind, nonce: Date.now() }));
        document.title = signal;
        setTimeout(() => { if (document.title === signal) document.title = previousTitle; }, 0);
      };
      const classify = (url) => {
        const raw = String(url || '');
        if (raw.includes('/x/v3/fav/folder/add')) return 'create';
        if (raw.includes('/x/v3/fav/folder/edit')) return 'rename';
        if (raw.includes('/x/v3/fav/folder/del')) return 'delete';
        return undefined;
      };
      const originalFetch = window.fetch;
      window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const kind = classify(args[0]?.url || args[0]);
        if (kind && response.ok) {
          try { const clone = response.clone(); const json = await clone.json(); if (json?.code === 0) emit(kind); } catch {}
        }
        return response;
      };
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) { this.__bilimiFavoriteMutationUrl = url; return originalOpen.call(this, method, url, ...rest); };
      XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', () => {
          const kind = classify(this.__bilimiFavoriteMutationUrl);
          if (!kind || this.status < 200 || this.status >= 300) return;
          try { const json = JSON.parse(String(this.responseText || '')); if (json?.code === 0) emit(kind); } catch {}
        }, { once: true });
        return originalSend.apply(this, args);
      };
      return true;
    })()
  `
}

function buildVideoRepaintAfterHostResizeScript(): string {
  return `
    (() => {
      const __bilimiRepaintVideoAfterHostResize = true;
      void __bilimiRepaintVideoAfterHostResize;
      window.dispatchEvent(new Event('resize'));

      const targets = [
        ...document.querySelectorAll('video'),
        ...document.querySelectorAll('.bpx-player-video-wrap,.bpx-player-container,.bpx-player-primary-area,.bilibili-player-video-wrap')
      ];

      for (const target of targets) {
        const style = target.style;
        if (!style) {
          continue;
        }

        const previousTransform = style.transform;
        const previousWillChange = style.willChange;
        style.willChange = 'transform';
        style.transform = previousTransform
          ? previousTransform + ' translateZ(0)'
          : 'translateZ(0)';
        void target.getBoundingClientRect?.();
        window.requestAnimationFrame(() => {
          style.transform = previousTransform;
          style.willChange = previousWillChange;
        });
      }

      return true;
    })()
  `
}

export const BiliWebview = memo(function BiliWebview({
  active,
  tabId,
  url,
  onLocationChange,
  onOpenInTab,
  onHtmlFullscreenChange,
  hostResizePaused = false,
  onPageInteractionHint,
  onFavoriteSpaceMutationConfirmed,
  onReady,
  onInitialLoadSettled,
  onTitleChange,
  onTargetState,
  seekSeconds,
  seekAid,
  seekCid
}: BiliWebviewProps) {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const instanceId = useRef(`bili-webview-${crypto.randomUUID()}`)
  const navigationEpoch = useRef(0)
  const initialUrl = useRef(url)
  const latestUrl = useRef(url)
  const hasFinishedInitialLoad = useRef(false)
  const completedArchiveSeek = useRef<string | undefined>(undefined)
  const archiveSeekKey = `${seekAid ?? ''}:${seekCid ?? ''}:${seekSeconds ?? ''}`
  const latestArchiveSeekKey = useRef(archiveSeekKey)
  latestArchiveSeekKey.current = archiveSeekKey
  const hostResizePausedRef = useRef(hostResizePaused)
  hostResizePausedRef.current = hostResizePaused
  const hostCallbacks = useRef({
    onHtmlFullscreenChange,
    onLocationChange,
    onOpenInTab,
    onPageInteractionHint,
    onFavoriteSpaceMutationConfirmed,
    onReady,
    onInitialLoadSettled,
    onTargetState,
    onTitleChange
  })
  hostCallbacks.current = {
    onHtmlFullscreenChange,
    onLocationChange,
    onOpenInTab,
    onPageInteractionHint,
    onFavoriteSpaceMutationConfirmed,
    onReady,
    onInitialLoadSettled,
    onTargetState,
    onTitleChange
  }
  const model = useMemo(() => createBrowserSurfaceModel(initialUrl.current), [])
  const [proxyConnectionFailed, setProxyConnectionFailed] = useState(false)
  const [loadFailure, setLoadFailure] = useState<{ errorCode?: number; errorDescription?: string } | null>(null)
  const [directRetrying, setDirectRetrying] = useState(false)
  const [directRetryError, setDirectRetryError] = useState('')

  const seekArchivedTimestamp = useCallback(() => {
    const webview = ref.current
    if (!Number.isFinite(seekSeconds) || seekSeconds === undefined || !webview?.executeJavaScript) return
    const seekKey = archiveSeekKey
    if (completedArchiveSeek.current === seekKey) return
    completedArchiveSeek.current = seekKey

    void (async () => {
      if (hasArchivedVideoPartIdentity(seekAid, seekCid)) {
        const result = await webview.executeJavaScript(
          buildSelectArchivedVideoPartScript(seekAid, seekCid),
          true
        ) as ArchivedVideoPartSelectionResult
        if (result?.status !== 'ready') {
          completedArchiveSeek.current = undefined
          return
        }
      }

      if (latestArchiveSeekKey.current !== seekKey) return
      await webview.executeJavaScript(buildSeekVideoTimeScript(seekSeconds), true)
    })().catch(() => {
      completedArchiveSeek.current = undefined
    })
  }, [archiveSeekKey, seekAid, seekCid, seekSeconds])
  const seekArchivedTimestampRef = useRef(seekArchivedTimestamp)
  seekArchivedTimestampRef.current = seekArchivedTimestamp

  useEffect(() => {
    completedArchiveSeek.current = undefined
    if (hasFinishedInitialLoad.current) seekArchivedTimestamp()
  }, [seekArchivedTimestamp])

  useEffect(() => {
    const webview = ref.current

    if (!webview) {
      return
    }

    hostCallbacks.current.onReady?.(tabId, webview)

    const reportTargetState = () => {
      const webContentsId = webview.getWebContentsId?.()
      if (typeof webContentsId !== 'number') return
      hostCallbacks.current.onTargetState?.(tabId, {
        webview,
        webContentsId,
        instanceId: instanceId.current,
        navigationEpoch: navigationEpoch.current
      })
    }
    const installLinkCapture = () => {
      if (!webview.executeJavaScript) {
        return
      }

      void webview.executeJavaScript(buildOpenLinksInAppScript(), true).catch(() => undefined)
    }

    const installDanmakuSeekRepaint = () => {
      if (!webview.executeJavaScript) return
      void webview.executeJavaScript(buildDanmakuSeekRepaintScript(), true).catch(() => undefined)
    }

    const installFavoriteSpaceMutationObserver = () => {
      if (!webview.executeJavaScript || !favoriteSpaceAccountMid(latestUrl.current)) return
      void webview.executeJavaScript(buildFavoriteSpaceMutationObserverScript(), true).catch(() => undefined)
    }

    const handleNewWindow = (event: Event) => {
      const urlToOpen = readEventUrl(event as WebviewUrlEvent)

      if (!urlToOpen) {
        return
      }

      event.preventDefault()
      hostCallbacks.current.onOpenInTab?.(urlToOpen)
    }

    const handleLocationChange = (event: Event) => {
      const nextUrl = readEventUrl(event as WebviewUrlEvent)

      if (nextUrl) {
        latestUrl.current = nextUrl
        hostCallbacks.current.onLocationChange?.(tabId, nextUrl)
        installFavoriteSpaceMutationObserver()
      }
    }

    const handleNavigationStart = (event: Event) => {
      const navigation = event as WebviewNavigationEvent
      if (navigation.isMainFrame === false || navigation.detail?.isMainFrame === false) return
      navigationEpoch.current += 1
      setProxyConnectionFailed(false)
      setLoadFailure(null)
      reportTargetState()
    }

    const handleEnterHtmlFullscreen = () => {
      hostCallbacks.current.onHtmlFullscreenChange?.(tabId, true)
    }

    const handleLeaveHtmlFullscreen = () => {
      hostCallbacks.current.onHtmlFullscreenChange?.(tabId, false)
    }

    const handleTitleChange = (event: Event) => {
      const nextTitle = readEventTitle(event as WebviewUrlEvent)

      if (!nextTitle) {
        return
      }

      const urlToOpen = readOpenInTabTitleSignal(nextTitle)

      if (urlToOpen) {
        hostCallbacks.current.onOpenInTab?.(urlToOpen)
        return
      }

      const petHint = readPetHintTitleSignal(nextTitle)

      if (petHint) {
        hostCallbacks.current.onPageInteractionHint?.(petHint)
        return
      }

      const favoriteMutation = readFavoriteSpaceMutationTitleSignal(nextTitle)
      if (favoriteMutation && favoriteSpaceAccountMid(latestUrl.current) === favoriteMutation.accountMid) {
        hostCallbacks.current.onFavoriteSpaceMutationConfirmed?.(tabId, favoriteMutation)
        return
      }

      hostCallbacks.current.onTitleChange?.(tabId, nextTitle)
    }

    const handleLoadFailure = (event: Event) => {
      const failure = event as WebviewLoadFailureEvent
      if (failure.isMainFrame === false) return
      hostCallbacks.current.onInitialLoadSettled?.(tabId, 'failure')
      if (failure.errorCode === -130) {
        setProxyConnectionFailed(true)
        setLoadFailure(null)
        setDirectRetryError('')
        return
      }
      setProxyConnectionFailed(false)
      setLoadFailure({ errorCode: failure.errorCode, errorDescription: failure.errorDescription })
    }

    const handleLoadSuccess = () => {
      hostCallbacks.current.onInitialLoadSettled?.(tabId, 'success')
      hasFinishedInitialLoad.current = true
      setProxyConnectionFailed(false)
      setLoadFailure(null)
      setDirectRetryError('')
    }

    const handleDomReady = () => {
      reportTargetState()
      handleLoadSuccess()
    }

    const settleInitialLoadIfReady = () => {
      let webContentsId: number | undefined
      try {
        webContentsId = webview.getWebContentsId?.()
      } catch {
        return
      }
      if (typeof webContentsId !== 'number') return
      const guestLoading = (webview as Electron.WebviewTag & { isLoading?: () => boolean }).isLoading?.()
      if (guestLoading === false) handleLoadSuccess()
    }

    webview.addEventListener('new-window', handleNewWindow)
    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-finish-load', reportTargetState)
    webview.addEventListener('dom-ready', installLinkCapture)
    webview.addEventListener('did-finish-load', installLinkCapture)
    webview.addEventListener('dom-ready', installDanmakuSeekRepaint)
    webview.addEventListener('did-finish-load', installDanmakuSeekRepaint)
    webview.addEventListener('dom-ready', installFavoriteSpaceMutationObserver)
    webview.addEventListener('did-finish-load', installFavoriteSpaceMutationObserver)
    webview.addEventListener('did-finish-load', handleLoadSuccess)
    webview.addEventListener('did-stop-loading', handleLoadSuccess)
    const handleArchivedTimestamp = () => seekArchivedTimestampRef.current()
    webview.addEventListener('did-finish-load', handleArchivedTimestamp)
    webview.addEventListener('did-fail-load', handleLoadFailure)
    webview.addEventListener('did-start-navigation', handleNavigationStart)
    webview.addEventListener('did-navigate', handleLocationChange)
    webview.addEventListener('did-navigate-in-page', handleLocationChange)
    webview.addEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
    webview.addEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
    webview.addEventListener('page-title-updated', handleTitleChange)

    // A restored WebView may finish loading before React attaches event listeners.
    // Probe on the next turn so an already-ready guest cannot retain its loading veil.
    const targetStateFallbackTimer = window.setTimeout(() => {
      try {
        reportTargetState()
        settleInitialLoadIfReady()
      } catch {
        // The normal dom-ready event remains the authoritative path while the guest initializes.
      }
    }, 0)

    return () => {
      window.clearTimeout(targetStateFallbackTimer)
      webview.removeEventListener('new-window', handleNewWindow)
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-finish-load', reportTargetState)
      webview.removeEventListener('dom-ready', installLinkCapture)
      webview.removeEventListener('did-finish-load', installLinkCapture)
      webview.removeEventListener('dom-ready', installDanmakuSeekRepaint)
      webview.removeEventListener('did-finish-load', installDanmakuSeekRepaint)
      webview.removeEventListener('dom-ready', installFavoriteSpaceMutationObserver)
      webview.removeEventListener('did-finish-load', installFavoriteSpaceMutationObserver)
      webview.removeEventListener('did-finish-load', handleLoadSuccess)
      webview.removeEventListener('did-stop-loading', handleLoadSuccess)
      webview.removeEventListener('did-finish-load', handleArchivedTimestamp)
      webview.removeEventListener('did-fail-load', handleLoadFailure)
      webview.removeEventListener('did-start-navigation', handleNavigationStart)
      webview.removeEventListener('did-navigate', handleLocationChange)
      webview.removeEventListener('did-navigate-in-page', handleLocationChange)
      webview.removeEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
      webview.removeEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
      webview.removeEventListener('page-title-updated', handleTitleChange)
    }
  }, [tabId])

  useEffect(() => {
    const webview = ref.current

    if (!webview || !active || hostResizePaused) {
      return
    }

    let repaintTimeout: number | undefined

    const scheduleVideoRepaint = () => {
      if (hostResizePausedRef.current) return
      window.clearTimeout(repaintTimeout)
      repaintTimeout = window.setTimeout(() => {
        if (hostResizePausedRef.current || !webview.executeJavaScript || webview.getAttribute('data-active') !== 'true') {
          return
        }

        void webview
          .executeJavaScript(buildVideoRepaintAfterHostResizeScript(), true)
          .catch(() => undefined)
      }, VIDEO_REPAINT_AFTER_HOST_RESIZE_DELAY_MS)
    }

    scheduleVideoRepaint()

    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', scheduleVideoRepaint)

      return () => {
        window.clearTimeout(repaintTimeout)
        window.removeEventListener('resize', scheduleVideoRepaint)
      }
    }

    const observer = new ResizeObserver(scheduleVideoRepaint)
    observer.observe(webview)
    if (webview.parentElement) {
      observer.observe(webview.parentElement)
    }

    return () => {
      window.clearTimeout(repaintTimeout)
      observer.disconnect()
    }
  }, [active, hostResizePaused])

  async function retryWithoutProxy() {
    if (!window.bilimiDesktop?.retryBilibiliSessionDirect) {
      setDirectRetryError('当前版本无法切换 B 站连接方式，请重启 bilimi 后重试。')
      return
    }
    setDirectRetrying(true)
    setDirectRetryError('')
    try {
      await window.bilimiDesktop.retryBilibiliSessionDirect()
    } catch (error) {
      setDirectRetryError(`直连重试未能启动：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDirectRetrying(false)
    }
  }

  return (<>
    <webview
      ref={(node) => {
        ref.current = node as Electron.WebviewTag | null
        node?.setAttribute('allowpopups', model.allowpopups)
      }}
      id={tabId === 'home' ? 'bilimi-webview' : `bilimi-webview-${tabId}`}
      className={`browser-surface${active ? '' : ' browser-surface--hidden'}`}
      data-active={active ? 'true' : 'false'}
      data-favorite-repository-instance-id={instanceId.current}
      data-tab-id={tabId}
      src={model.src}
      partition={model.partition}
    />
    {active && proxyConnectionFailed ? (
      <section className="browser-proxy-error" role="alert" aria-label="B 站网络连接错误">
        <div className="browser-proxy-error__card">
          <h2>系统代理连接失败</h2>
          <p>bilimi 默认跟随 Windows 系统网络设置，本身不要求代理。</p>
          <p>请先检查系统代理是否正在运行；也可以重新加载，或只在本次 bilimi 运行期间让 B 站标签直连重试。</p>
          <p>本次直连不会修改系统代理，重启 bilimi 后会恢复跟随系统。</p>
          {directRetryError ? <p className="browser-proxy-error__failure">{directRetryError}</p> : null}
          <div className="browser-proxy-error__actions">
            <button type="button" disabled={directRetrying} onClick={() => ref.current?.reload?.()}>重新加载</button>
            <button type="button" disabled={directRetrying} onClick={() => void retryWithoutProxy()}>
              {directRetrying ? '正在切换…' : '本次直连重试'}
            </button>
          </div>
        </div>
      </section>
    ) : null}
    {active && loadFailure ? (
      <section className="browser-proxy-error" role="alert" aria-label="B 站页面加载失败">
        <div className="browser-proxy-error__card">
          <h2>B 站页面加载失败</h2>
          <p>{loadFailure.errorDescription || `错误码：${loadFailure.errorCode ?? '未知'}`}</p>
          <div className="browser-proxy-error__actions">
            <button type="button" onClick={() => ref.current?.reload?.()}>重新加载 B 站页面</button>
          </div>
        </div>
      </section>
    ) : null}
  </>)
})
