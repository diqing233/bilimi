import { createBrowserSurfaceModel } from './browserSurfaceModel'

export function BiliWebview() {
  const model = createBrowserSurfaceModel()

  return (
    <webview
      id="bilimi-webview"
      className="browser-surface"
      src={model.src}
      partition={model.partition}
      allowpopups={model.allowpopups}
    />
  )
}
