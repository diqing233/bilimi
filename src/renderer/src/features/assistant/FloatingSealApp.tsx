import { useEffect, useRef, useState } from 'react'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function FloatingSealApp() {
  const dragState = useRef<DragState | null>(null)
  const suppressNextClick = useRef(false)
  const isMounted = useRef(true)
  const openingResetTimeout = useRef<number | null>(null)
  const [pressed, setPressed] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    return () => {
      isMounted.current = false

      if (openingResetTimeout.current !== null) {
        window.clearTimeout(openingResetTimeout.current)
      }
    }
  }, [])

  function toggleAssistant() {
    setOpening(true)
    const toggleAssistantBridge =
      window.bilimiDesktop?.toggleFloatingAssistant ?? window.bilimiDesktop?.toggleFloatingMenu
    const toggleRequest = toggleAssistantBridge?.()

    void Promise.resolve(toggleRequest).finally(() => {
      if (!isMounted.current) {
        return
      }

      openingResetTimeout.current = window.setTimeout(() => {
        openingResetTimeout.current = null

        if (isMounted.current) {
          setOpening(false)
        }
      }, 160)
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
    <main className="floating-seal-shell" aria-label="bilimi 小咪入口">
      <button
        className="floating-seal-button"
        type="button"
        aria-label="打开小咪助手"
        title="打开小咪助手"
        data-opening={opening ? 'true' : 'false'}
        data-pressed={pressed ? 'true' : 'false'}
        onClick={(event) => {
          const finishedDrag = finishDrag()

          if (finishedDrag || suppressNextClick.current) {
            suppressNextClick.current = false
            event.preventDefault()
            return
          }

          toggleAssistant()
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
        onPointerCancel={finishDrag}
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
        <img className="floating-seal-button__pet" src={idlePetUrl} alt="小咪待机" />
      </button>
    </main>
  )
}
