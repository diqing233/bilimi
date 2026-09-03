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

type StartupInputActivity = 'pointer-move' | 'foreground'

let lastStartupInputNoticeAt = Number.NEGATIVE_INFINITY
let startupInputNoticeTimer: number | undefined
let deferredStartupInputActivity: StartupInputActivity | undefined
const notifyStartupInputActivity = (activity: StartupInputActivity) => {
  const now = performance.now()
  const elapsed = now - lastStartupInputNoticeAt
  if (elapsed >= 50) {
    lastStartupInputNoticeAt = now
    window.bilimiDesktop?.notifyStartupInputActivity?.(activity)
    return
  }
  if (activity === 'foreground') deferredStartupInputActivity = 'foreground'
  else deferredStartupInputActivity ??= 'pointer-move'
  if (startupInputNoticeTimer !== undefined) return
  startupInputNoticeTimer = window.setTimeout(() => {
    startupInputNoticeTimer = undefined
    lastStartupInputNoticeAt = performance.now()
    const deferredActivity = deferredStartupInputActivity ?? 'foreground'
    deferredStartupInputActivity = undefined
    window.bilimiDesktop?.notifyStartupInputActivity?.(deferredActivity)
  }, Math.max(0, 50 - elapsed))
}
window.addEventListener('pointermove', (event) => {
  notifyStartupInputActivity(event.buttons === 0 ? 'pointer-move' : 'foreground')
}, { passive: true })
for (const eventName of ['pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup']) {
  window.addEventListener(eventName, () => notifyStartupInputActivity('foreground'), { passive: true })
}
window.addEventListener('resize', () => notifyStartupInputActivity('foreground'), { passive: true })

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
