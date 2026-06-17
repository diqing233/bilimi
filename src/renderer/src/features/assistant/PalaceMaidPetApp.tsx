import { useEffect, useRef, useState } from 'react'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetState
} from './petState'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [petState, setPetState] = useState<AssistantPetState>('idle')
  const [clickReactionSignal, setClickReactionSignal] = useState(0)
  const stateView = createPetStateView(petState)

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetStateChanged?.((state) => {
      setPetState(normalizePetState(state))
    })
  }, [])

  function startDrag(clientX: number, clientY: number, screenX: number, screenY: number) {
    setPressed(true)
    dragState.current = {
      startClientX: clientX,
      startClientY: clientY,
      moved: false
    }
    window.bilimiDesktop?.startFloatingSealDrag?.(screenX, screenY)
  }

  function moveDrag(clientX: number, clientY: number) {
    const currentDrag = dragState.current

    if (!currentDrag) {
      return
    }

    const moved =
      currentDrag.moved ||
      Math.hypot(clientX - currentDrag.startClientX, clientY - currentDrag.startClientY) >=
        DRAG_THRESHOLD_PX

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

    if (currentDrag.moved) {
      suppressNextClick.current = true
      return true
    }

    return false
  }

  function restoreMainWindow() {
    setClickReactionSignal((signal) => signal + 1)
    setPetState('hint')
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }

  return (
    <main className="palace-maid-pet-shell" aria-label="Bilimi 小宫女">
      <button
        className="palace-maid-pet"
        type="button"
        aria-label="打开 Bilimi"
        title="打开 Bilimi"
        data-pet-state={stateView.state}
        data-pressed={pressed ? 'true' : 'false'}
        onClick={(event) => {
          const finishedDrag = finishDrag()

          if (finishedDrag || suppressNextClick.current) {
            suppressNextClick.current = false
            event.preventDefault()
            return
          }

          restoreMainWindow()
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          startDrag(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerMove={(event) => {
          moveDrag(event.clientX, event.clientY)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          finishDrag()
        }}
        onPointerCancel={() => {
          dragState.current = null
          setPressed(false)
        }}
      >
        <span className="palace-maid-pet__halo" aria-hidden="true" />
        <LayeredPetRenderer petState={petState} clickReactionSignal={clickReactionSignal} />
        <span className="palace-maid-pet__bubble">
          <strong>{stateView.label}</strong>
          <span>{stateView.bubble}</span>
        </span>
      </button>
    </main>
  )
}
