import { useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'
import { buildOpenLinksInAppScript } from './linkCaptureScript'
import { createBrowserCrashRecoveryTracker } from '../../../../../electron/main/browserCrashRecovery'

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
}

type WebviewUrlEvent = Event & {
  url?: string
  title?: string
  detail?: {
    url?: string
    title?: string
  }
}

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

      const existingTimers = Array.isArray(window[marker]) ? window[marker] : [];
      for (const timer of existingTimers) {
        window.clearTimeout(timer);
      }

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
            '.bilibili-player-video-danmaku'
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

      const delays = [0, 250, 800, 1600, 3200];
      window[marker] = delays.map((delay) =>
        window.setTimeout(() => {
          window.requestAnimationFrame(wakeTargets);
        }, delay)
      );

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
  onTitleChange
}: BiliWebviewProps) {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const initialUrl = useRef(url)
  const latestUrl = useRef(url)
  const model = useMemo(() => createBrowserSurfaceModel(initialUrl.current), [])
  const crashRecovery = useMemo(() => createBrowserCrashRecoveryTracker(), [])
  const [crashMessage, setCrashMessage] = useState('')

  useEffect(() => {
    const webview = ref.current

    if (!webview) {
      return
    }

    onReady?.(tabId, webview)

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

    const handleEnterHtmlFullscreen = () => {
      onHtmlFullscreenChange?.(tabId, true)
    }

    const handleLeaveHtmlFullscreen = () => {
      onHtmlFullscreenChange?.(tabId, false)
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

    const handleGuestFailure = (event: Event) => {
      const loadFailure = event as Event & {
        errorCode?: number
        errorDescription?: string
        isMainFrame?: boolean
      }
      const processFailure = event as Event & {
        details?: {
          reason?: string
          exitCode?: number
        }
      }
      if (
        event.type === 'did-fail-load' &&
        (loadFailure.errorCode === -3 || loadFailure.isMainFrame === false)
      ) {
        return
      }
      console.error('bilimi webview failure', {
        url: latestUrl.current,
        reason: processFailure.details?.reason ?? loadFailure.errorDescription ?? event.type,
        exitCode: processFailure.details?.exitCode
      })
      const recovery = crashRecovery.recordCrash(tabId)
      if (recovery.action === 'reload') {
        webview.reload?.()
        return
      }
      setCrashMessage('网页连续崩溃，已停止自动重载。')
    }

    webview.addEventListener('new-window', handleNewWindow)
    webview.addEventListener('dom-ready', installLinkCapture)
    webview.addEventListener('did-finish-load', installLinkCapture)
    webview.addEventListener('did-finish-load', scheduleDanmakuWake)
    webview.addEventListener('did-navigate', handleLocationChange)
    webview.addEventListener('did-navigate-in-page', handleLocationChange)
    webview.addEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
    webview.addEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
    webview.addEventListener('page-title-updated', handleTitleChange)
    webview.addEventListener('render-process-gone', handleGuestFailure)
    webview.addEventListener('did-fail-load', handleGuestFailure)

    return () => {
      window.clearTimeout(danmakuWakeTimeout)
      webview.removeEventListener('new-window', handleNewWindow)
      webview.removeEventListener('dom-ready', installLinkCapture)
      webview.removeEventListener('did-finish-load', installLinkCapture)
      webview.removeEventListener('did-finish-load', scheduleDanmakuWake)
      webview.removeEventListener('did-navigate', handleLocationChange)
      webview.removeEventListener('did-navigate-in-page', handleLocationChange)
      webview.removeEventListener('enter-html-full-screen', handleEnterHtmlFullscreen)
      webview.removeEventListener('leave-html-full-screen', handleLeaveHtmlFullscreen)
      webview.removeEventListener('page-title-updated', handleTitleChange)
      webview.removeEventListener('render-process-gone', handleGuestFailure)
      webview.removeEventListener('did-fail-load', handleGuestFailure)
    }
  }, [onHtmlFullscreenChange, onLocationChange, onOpenInTab, onPageInteractionHint, onReady, onTitleChange, tabId])

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

  return (
    <div className={`browser-surface-host${active ? '' : ' browser-surface--hidden'}`}>
      <webview
        ref={(node) => {
          ref.current = node as Electron.WebviewTag | null
          node?.setAttribute('allowpopups', model.allowpopups)
        }}
        id={tabId === 'home' ? 'bilimi-webview' : `bilimi-webview-${tabId}`}
        className="browser-surface"
        data-active={active ? 'true' : 'false'}
        data-tab-id={tabId}
        src={model.src}
        partition={model.partition}
      />
      {crashMessage ? (
        <div className="browser-surface__error" role="alert">
          <p>{crashMessage}</p>
          <button
            type="button"
            onClick={() => {
              crashRecovery.reset(tabId)
              setCrashMessage('')
              ref.current?.reload?.()
            }}
          >
            重新加载网页
          </button>
        </div>
      ) : null}
    </div>
  )
}
