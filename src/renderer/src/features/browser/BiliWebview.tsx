import { useMemo, useRef } from 'react'
import { createBrowserSurfaceModel } from './browserSurfaceModel'

export function BiliWebview() {
  const ref = useRef<Electron.WebviewTag | null>(null)
  const model = useMemo(() => createBrowserSurfaceModel(), [])

  return (
    <webview
      ref={(node) => {
        ref.current = node
      }}
      id="bilimi-webview"
      className="browser-surface"
      src={model.src}
      partition={model.partition}
      allowpopups={model.allowpopups}
    />
  )
}
