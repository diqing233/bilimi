import { useEffect, useRef, useState } from 'react'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetState
} from './petState'
import { createInitialAssistantPreferences } from '../state/assistantState'
import type { AssistantPreferences } from '@shared/types'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

type ResizeState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const resizeState = useRef<ResizeState | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [petState, setPetState] = useState<AssistantPetState>('idle')
  const [petStyle, setPetStyle] = useState<AssistantPreferences['petStyle']>('big-head')
  const [clickReactionSignal, setClickReactionSignal] = useState(0)
  const stateView = createPetStateView(petState)

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetStateChanged?.((state) => {
      setPetState(normalizePetState(state))
    })
  }, [])

  useEffect(() => {
    let disposed = false

    async function loadPreferences() {
      const preferences = await window.bilimiDesktop?.loadPreferences?.()

      if (!disposed && preferences) {
        setPetStyle(createInitialAssistantPreferences(preferences).petStyle)
      }
    }

    void loadPreferences()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencesChanged?.((preferences) => {
      setPetStyle(createInitialAssistantPreferences(preferences).petStyle)
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

  function startResize(clientX: number, clientY: number, screenX: number, screenY: number) {
    dragState.current = null
    resizeState.current = {
      startClientX: clientX,
      startClientY: clientY,
      moved: false
    }
    setPressed(false)
    window.bilimiDesktop?.startFloatingSealResize?.(screenX, screenY)
  }

  function moveResize(clientX: number, clientY: number, screenX: number, screenY: number) {
    const currentResize = resizeState.current

    if (!currentResize) {
      return
    }

    const moved =
      currentResize.moved ||
      Math.hypot(clientX - currentResize.startClientX, clientY - currentResize.startClientY) >=
        DRAG_THRESHOLD_PX

    resizeState.current = {
      ...currentResize,
      moved
    }

    if (moved) {
      window.bilimiDesktop?.resizeFloatingSeal?.(screenX, screenY)
    }
  }

  function finishResize() {
    const currentResize = resizeState.current

    if (!currentResize) {
      return false
    }

    resizeState.current = null
    window.bilimiDesktop?.finishFloatingSealDrag?.()

    if (currentResize.moved) {
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
    <main className="palace-maid-pet-shell" aria-label="Bilimi 小mi">
      <button
        className="palace-maid-pet"
        type="button"
        aria-label="打开 Bilimi，小mi在这里"
        title="打开 Bilimi，小mi在这里"
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
        <LayeredPetRenderer
          petState={petState}
          clickReactionSignal={clickReactionSignal}
          petStyle={petStyle}
        />
        <span className="palace-maid-pet__bubble">
          <strong>{stateView.label}</strong>
          <span>{stateView.bubble}</span>
        </span>
      </button>
      <button
        className="palace-maid-pet__resize-handle"
        type="button"
        aria-label="调整小mi大小"
        title="调整小mi大小"
        onClick={(event) => {
          if (finishResize() || suppressNextClick.current) {
            suppressNextClick.current = false
            event.preventDefault()
          }
        }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          startResize(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerMove={(event) => {
          event.stopPropagation()
          moveResize(event.clientX, event.clientY, event.screenX, event.screenY)
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          finishResize()
        }}
        onPointerCancel={() => {
          resizeState.current = null
          window.bilimiDesktop?.finishFloatingSealDrag?.()
        }}
      >
        <span aria-hidden="true" />
      </button>
    </main>
  )
}
