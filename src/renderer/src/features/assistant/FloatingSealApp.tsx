import { useRef, useState } from 'react'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function FloatingSealApp() {
  const dragState = useRef<DragState | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [opening, setOpening] = useState(false)

  function toggleMenu() {
    setOpening(true)
    const toggleRequest = window.bilimiDesktop?.toggleFloatingMenu?.()

    void Promise.resolve(toggleRequest).finally(() => {
      window.setTimeout(() => setOpening(false), 160)
    })
  }

  function startDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    setPressed(true)
    dragState.current = {
      startClientX: clientX,
      startClientY: clientY,
      moved: false
    }
    window.bilimiDesktop?.startFloatingSealDrag?.(screenX, screenY)
  }

  function moveDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    const currentDrag = dragState.current

    if (!currentDrag) {
      return
    }

    const totalDeltaX = clientX - currentDrag.startClientX
    const totalDeltaY = clientY - currentDrag.startClientY
    const moved =
      currentDrag.moved || Math.hypot(totalDeltaX, totalDeltaY) >= DRAG_THRESHOLD_PX

    dragState.current = {
      ...currentDrag,
      moved
    }

    if (moved) {
      setPressed(false)
      window.bilimiDesktop?.moveFloatingSealTo?.(screenX, screenY)
    }
  }

  function finishDrag() {
    const currentDrag = dragState.current

    if (!currentDrag) {
      setPressed(false)
      return false
    }

    dragState.current = null
    setPressed(false)
    window.bilimiDesktop?.finishFloatingSealDrag?.()

    if (currentDrag?.moved) {
      suppressNextClick.current = true
      return true
    }

    return false
  }

  return (
    <main className="floating-seal-shell" aria-label="Bilimi 悬浮球">
      <button
        className="floating-seal-button"
        type="button"
        aria-label="打开 Bilimi 助手"
        data-opening={opening ? 'true' : 'false'}
        data-pressed={pressed ? 'true' : 'false'}
        onClick={(event) => {
          const finishedDrag = finishDrag()

          if (finishedDrag || suppressNextClick.current) {
            suppressNextClick.current = false
            event.preventDefault()
            return
          }

          toggleMenu()
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          startDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerMove={(event) => {
          moveDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          finishDrag()
        }}
        onPointerCancel={() => {
          dragState.current = null
          setPressed(false)
        }}
        onMouseDown={(event) => {
          if (window.PointerEvent) {
            return
          }

          startDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onMouseMove={(event) => {
          if (window.PointerEvent) {
            return
          }

          moveDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onMouseUp={() => {
          if (window.PointerEvent) {
            return
          }

          finishDrag()
        }}
      >
        <span className="floating-seal-button__glow" aria-hidden="true" />
        <span className="floating-seal-button__mark" aria-hidden="true">
          玺
        </span>
      </button>
    </main>
  )
}
