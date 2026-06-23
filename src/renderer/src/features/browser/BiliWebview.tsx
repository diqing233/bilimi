import { useEffect, useMemo, useRef } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'
import { buildOpenLinksInAppScript } from './linkCaptureScript'

const OPEN_IN_TAB_TITLE_PREFIX = '__BILIMI_OPEN_IN_TAB__:'
const PET_HINT_TITLE_PREFIX = '__BILIMI_PET_HINT__:'

type BiliWebviewProps = {
  active: boolean
  tabId: string
  url: string
  onLocationChange?: (tabId: string, url: string) => void
  onOpenInTab?: (url: string) => void
  onReady?: (tabId: string, webview: Electron.WebviewTag) => void
  onPageInteractionHint?: (message: string) => void
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

export function BiliWebview({
  active,
  tabId,
  url,
  onLocationChange,
  onOpenInTab,
  onPageInteractionHint,
  onReady,
  onTitleChange
}: BiliWebviewProps) {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const initialUrl = useRef(url)
  const model = useMemo(() => createBrowserSurfaceModel(initialUrl.current), [])

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
        onLocationChange?.(tabId, nextUrl)
      }
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

    webview.addEventListener('new-window', handleNewWindow)
    webview.addEventListener('dom-ready', installLinkCapture)
    webview.addEventListener('did-finish-load', installLinkCapture)
    webview.addEventListener('did-navigate', handleLocationChange)
    webview.addEventListener('did-navigate-in-page', handleLocationChange)
    webview.addEventListener('page-title-updated', handleTitleChange)

    return () => {
      webview.removeEventListener('new-window', handleNewWindow)
      webview.removeEventListener('dom-ready', installLinkCapture)
      webview.removeEventListener('did-finish-load', installLinkCapture)
      webview.removeEventListener('did-navigate', handleLocationChange)
      webview.removeEventListener('did-navigate-in-page', handleLocationChange)
      webview.removeEventListener('page-title-updated', handleTitleChange)
    }
  }, [onLocationChange, onOpenInTab, onPageInteractionHint, onReady, onTitleChange, tabId])

  return (
    <webview
      ref={(node) => {
        ref.current = node
      }}
      id={tabId === 'home' ? 'bilimi-webview' : `bilimi-webview-${tabId}`}
      className={`browser-surface${active ? '' : ' browser-surface--hidden'}`}
      data-active={active ? 'true' : 'false'}
      data-tab-id={tabId}
      src={model.src}
      partition={model.partition}
      allowpopups={model.allowpopups}
    />
  )
}
