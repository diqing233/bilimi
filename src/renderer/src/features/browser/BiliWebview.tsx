import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'
import { buildOpenLinksInAppScript } from './linkCaptureScript'

const OPEN_IN_TAB_TITLE_PREFIX = '__BILIMI_OPEN_IN_TAB__:'
const PET_HINT_TITLE_PREFIX = '__BILIMI_PET_HINT__:'
const VIDEO_REPAINT_AFTER_HOST_RESIZE_DELAY_MS = 80
const DANMAKU_WAKE_AFTER_VIDEO_LOAD_DELAY_MS = 120

type BiliWebviewProps = {
  active: boolean
  tabId: string
  url: string
  onLocationChange?: (tabId: string, url: string) => void
  onOpenInTab?: (url: string) => void
  onReady?: (tabId: string, webview: Electron.WebviewTag) => void
  onPageInteractionHint?: (message: string) => void
  onHtmlFullscreenChange?: (tabId: string, fullscreen: boolean) => void
  onTitleChange?: (tabId: string, title: string) => void
  onTargetState?: (tabId: string, state: {
    webview: Electron.WebviewTag
    webContentsId: number
    instanceId: string
    navigationEpoch: number
  }) => void
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

function isBilibiliVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url)

    return /(^|\.)bilibili\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/video/')
  } catch {
    return false
  }
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

function buildWakeBilibiliDanmakuAfterVideoLoadScript(): string {
  return `
    (() => {
      const marker = '__bilimiWakeBilibiliDanmakuAfterVideoLoad';
      void marker;

      if (!/\\/video\\//i.test(window.location.pathname)) {
        return false;
      }

      const existingWake = window[marker];
      existingWake?.observer?.disconnect?.();
      if (existingWake?.timeout) window.clearTimeout(existingWake.timeout);

      const wakeTargets = () => {
        window.dispatchEvent(new Event('resize'));

        const targets = [
          ...document.querySelectorAll('video'),
          ...document.querySelectorAll([
            '.bpx-player-container',
            '.bpx-player-primary-area',
            '.bpx-player-video-area',
            '.bpx-player-video-wrap',
            '.bpx-player-video-perch',
            '.bpx-player-row-dm-wrap',
            '.bpx-player-dm-wrap',
            '.bilibili-player',
            '.bilibili-player-video-wrap',
            '.bilibili-player-video-danmaku',
            '.bpx-player-dm-wrap canvas',
            '.bpx-player-dm-wrap svg',
            '.bpx-player-dm-wrap .b-danmaku',
            '.bilibili-player-video-danmaku .b-danmaku'
          ].join(','))
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

        return targets.length;
      };

      const hasDanmakuLayer = () => Boolean(document.querySelector([
        '.bpx-player-dm-wrap canvas',
        '.bpx-player-dm-wrap svg',
        '.bpx-player-dm-wrap .b-danmaku',
        '.bilibili-player-video-danmaku .b-danmaku'
      ].join(',')));
      const wakeWhenReady = () => {
        if (!hasDanmakuLayer()) return false;
        window.requestAnimationFrame(wakeTargets);
        return true;
      };

      if (wakeWhenReady()) {
        window[marker] = null;
        return true;
      }

      const root = document.querySelector('.bpx-player-container,.bilibili-player') || document.body;
      const observer = new MutationObserver(() => {
        if (!wakeWhenReady()) return;
        observer.disconnect();
        if (window[marker]?.timeout) window.clearTimeout(window[marker].timeout);
        window[marker] = null;
      });
      observer.observe(root, { childList: true, subtree: true });
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        window.requestAnimationFrame(wakeTargets);
        window[marker] = null;
      }, 10000);
      window[marker] = { observer, timeout };

      return true;
    })()
  `
}

export function BiliWebview({
  active,
  tabId,
  url,
  onLocationChange,
  onOpenInTab,
  onHtmlFullscreenChange,
  onPageInteractionHint,
  onReady,
  onTitleChange,
  onTargetState
}: BiliWebviewProps) {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const instanceId = useRef(`bili-webview-${crypto.randomUUID()}`)
  const navigationEpoch = useRef(0)
  const initialUrl = useRef(url)
  const latestUrl = useRef(url)
  const model = useMemo(() => createBrowserSurfaceModel(initialUrl.current), [])
  const [proxyConnectionFailed, setProxyConnectionFailed] = useState(false)
  const [directRetrying, setDirectRetrying] = useState(false)
  const [directRetryError, setDirectRetryError] = useState('')

  useEffect(() => {
    const webview = ref.current

    if (!webview) {
      return
    }

    onReady?.(tabId, webview)

    const reportTargetState = () => {
      const webContentsId = webview.getWebContentsId?.()
      if (typeof webContentsId !== 'number') return
      onTargetState?.(tabId, {
        webview,
        webContentsId,
        instanceId: instanceId.current,
        navigationEpoch: navigationEpoch.current
      })
    }
    // A restored WebView may finish loading before React attaches event listeners.
    // Probe on the next turn so Electron can expose its guest id without rebinding another tab.
    const targetStateFallbackTimer = window.setTimeout(() => {
      try {
        reportTargetState()
      } catch {
        // The normal dom-ready event remains the authoritative path while the guest initializes.
      }
    }, 0)
    const installLinkCapture = () => {
      if (!webview.executeJavaScript) {
        return
      }

      void webview.executeJavaScript(buildOpenLinksInAppScript(), true).catch(() => undefined)
    }

    let danmakuWakeTimeout: number | undefined

    const scheduleDanmakuWake = () => {
      window.clearTimeout(danmakuWakeTimeout)

      if (!webview.executeJavaScript || !isBilibiliVideoUrl(latestUrl.current)) {
        return
      }

      danmakuWakeTimeout = window.setTimeout(() => {
        if (!webview.executeJavaScript || !isBilibiliVideoUrl(latestUrl.current)) {
          return
        }

        void webview
          .executeJavaScript(buildWakeBilibiliDanmakuAfterVideoLoadScript(), true)
          .catch(() => undefined)
      }, DANMAKU_WAKE_AFTER_VIDEO_LOAD_DELAY_MS)
    }

    const handleNewWindow = (event: Event) => {
      const urlToOpen = readEventUrl(event as WebviewUrlEvent)

      if (!urlToOpen) {
        return
      }

      event.preventDefault()
      onOpenInTab?.(urlToOpen)
    }

    const handleLocationChange = (event: Event) => {
      const nextUrl = readEventUrl(event as WebviewUrlEvent)

      if (nextUrl) {
        latestUrl.current = nextUrl
        onLocationChange?.(tabId, nextUrl)
        scheduleDanmakuWake()
      }
    }

    const handleNavigationStart = (event: Event) => {
      const navigation = event as WebviewNavigationEvent
      if (navigation.isMainFrame === false || navigation.detail?.isMainFrame === false) return
      navigationEpoch.current += 1
      reportTargetState()
    }

    const handleEnterHtmlFullscreen = () => {
      onHtmlFullscreenChange?.(tabId, true)
    }

    const handleLeaveHtmlFullscreen = () => {
      onHtmlFullscreenChange?.(tabId, false)
      scheduleDanmakuWake()
    }

    const handleTitleChange = (event: Event) => {
      const nextTitle = readEventTitle(event as WebviewUrlEvent)

      if (!nextTitle) {
        return
      }

      const urlToOpen = readOpenInTabTitleSignal(nextTitle)

      if (urlToOpen) {
        onOpenInTab?.(urlToOpen)
        return
      }

      const petHint = readPetHintTitleSignal(nextTitle)

      if (petHint) {
        onPageInteractionHint?.(petHint)
        return
      }

      onTitleChange?.(tabId, nextTitle)
    }

    const handleLoadFailure = (event: Event) => {
      const failure = event as WebviewLoadFailureEvent
      if (failure.isMainFrame !== false && failure.errorCode === -130) {
        setProxyConnectionFailed(true)
        setDirectRetryError('')
      }
    }

    const handleLoadSuccess = () => {
      setProxyConnectionFailed(false)
      setDirectRetryError('')
    }

    webview.addEventListener('new-window', handleNewWindow)
    webview.addEventListener('dom-ready', reportTargetState)
    webview.addEventListener('did-finish-load', reportTargetState)
    webview.addEventListener('dom-ready', installLinkCapture)
    webview.addEventListener('did-finish-load', installLinkCapture)
    webview.addEventListener('did-finish-load', scheduleDanmakuWake)
    webview.addEventListener('did-finish-load', handleLoadSuccess)
    webview.addEventListener('did-fail-load', handleLoadFailure)
    webview.addEventListener('did-start-navigation', handleNavigationStart)
    webview.addEventListener('did-navigate', handleLocationChange)
    webview.addEventListener('did-navigate-in-page', handleLocationChange)
    webview.addEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
    webview.addEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
    webview.addEventListener('page-title-updated', handleTitleChange)

    return () => {
      window.clearTimeout(targetStateFallbackTimer)
      window.clearTimeout(danmakuWakeTimeout)
      webview.removeEventListener('new-window', handleNewWindow)
      webview.removeEventListener('dom-ready', reportTargetState)
      webview.removeEventListener('did-finish-load', reportTargetState)
      webview.removeEventListener('dom-ready', installLinkCapture)
      webview.removeEventListener('did-finish-load', installLinkCapture)
      webview.removeEventListener('did-finish-load', scheduleDanmakuWake)
      webview.removeEventListener('did-finish-load', handleLoadSuccess)
      webview.removeEventListener('did-fail-load', handleLoadFailure)
      webview.removeEventListener('did-start-navigation', handleNavigationStart)
      webview.removeEventListener('did-navigate', handleLocationChange)
      webview.removeEventListener('did-navigate-in-page', handleLocationChange)
      webview.removeEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
      webview.removeEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
      webview.removeEventListener('page-title-updated', handleTitleChange)
    }
  }, [onHtmlFullscreenChange, onLocationChange, onOpenInTab, onPageInteractionHint, onReady, onTargetState, onTitleChange, tabId])

  useEffect(() => {
    const webview = ref.current

    if (!webview || !active) {
      return
    }

    let repaintTimeout: number | undefined

    const scheduleVideoRepaint = () => {
      window.clearTimeout(repaintTimeout)
      repaintTimeout = window.setTimeout(() => {
        if (!webview.executeJavaScript || webview.getAttribute('data-active') !== 'true') {
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
  }, [active])

  async function retryWithoutProxy() {
    if (!window.bilimiDesktop?.retryBilibiliSessionDirect) {
      setDirectRetryError('当前版本无法切换 B 站连接方式，请重启 bilimi 后重试。')
      return
    }
    setDirectRetrying(true)
    setDirectRetryError('')
    try {
      await window.bilimiDesktop.retryBilibiliSessionDirect()
      ref.current?.reload?.()
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
  </>)
}
