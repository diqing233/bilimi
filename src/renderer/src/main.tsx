import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { markFloatingWindowDocument } from './features/assistant/floatingWindowDocument'
import './styles.css'

const App = lazy(() => import('./App').then((module) => ({ default: module.default })))
const FloatingAssistantApp = lazy(() => import('./features/assistant/FloatingAssistantApp').then((module) => ({ default: module.FloatingAssistantApp })))
const FloatingMenuApp = lazy(() => import('./features/assistant/FloatingMenuApp').then((module) => ({ default: module.FloatingMenuApp })))
const PalaceMaidPetApp = lazy(() => import('./features/assistant/PalaceMaidPetApp').then((module) => ({ default: module.PalaceMaidPetApp })))

markFloatingWindowDocument(window.location.search)

const route = new URLSearchParams(window.location.search)
const isFloatingAssistantWindow = route.get('window') === 'floating-assistant'
const isFloatingSealWindow = route.get('window') === 'floating-seal'
const isFloatingMenuWindow = route.get('window') === 'floating-menu'

let lastStartupInputNoticeAt = Number.NEGATIVE_INFINITY
let startupInputNoticeTimer: number | undefined
const notifyStartupInputActivity = () => {
  const now = performance.now()
  const elapsed = now - lastStartupInputNoticeAt
  if (elapsed >= 50) {
    lastStartupInputNoticeAt = now
    window.bilimiDesktop?.notifyStartupInputActivity?.()
    return
  }
  if (startupInputNoticeTimer !== undefined) return
  startupInputNoticeTimer = window.setTimeout(() => {
    startupInputNoticeTimer = undefined
    lastStartupInputNoticeAt = performance.now()
    window.bilimiDesktop?.notifyStartupInputActivity?.()
  }, Math.max(0, 50 - elapsed))
}
for (const eventName of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup']) {
  window.addEventListener(eventName, notifyStartupInputActivity, { passive: true })
}
window.addEventListener('resize', notifyStartupInputActivity, { passive: true })

function StartupRouteFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0
      }}
    >
      正在准备窗口…
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<StartupRouteFallback />}>
      {isFloatingAssistantWindow ? (
        <FloatingAssistantApp />
      ) : isFloatingMenuWindow ? (
        <FloatingMenuApp />
      ) : isFloatingSealWindow ? (
        <PalaceMaidPetApp />
      ) : (
        <App />
      )}
    </Suspense>
  </React.StrictMode>
)
