import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetState
} from './petState'
import { createInitialAssistantPreferences } from '../state/assistantState'
import type { AssistantPreferences, DeepSeekChatMessage } from '@shared/types'

const DRAG_THRESHOLD_PX = 5

type DragState = {
  startClientX: number
  startClientY: number
  moved: boolean
}

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const resizeControlsHideTimeout = useRef<number | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [resizeControlsVisible, setResizeControlsVisible] = useState(false)
  const [petState, setPetState] = useState<AssistantPetState>('idle')
  const [petStyle, setPetStyle] = useState<AssistantPreferences['petStyle']>('big-head')
  const [clickReactionSignal, setClickReactionSignal] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatMessages, setChatMessages] = useState<DeepSeekChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
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

  useEffect(() => {
    return () => {
      if (resizeControlsHideTimeout.current !== null) {
        window.clearTimeout(resizeControlsHideTimeout.current)
      }
    }
  }, [])

  function showResizeControls() {
    if (resizeControlsHideTimeout.current !== null) {
      window.clearTimeout(resizeControlsHideTimeout.current)
      resizeControlsHideTimeout.current = null
    }

    setResizeControlsVisible(true)
  }

  function scheduleHideResizeControls() {
    if (resizeControlsHideTimeout.current !== null) {
      window.clearTimeout(resizeControlsHideTimeout.current)
    }

    resizeControlsHideTimeout.current = window.setTimeout(() => {
      setResizeControlsVisible(false)
      resizeControlsHideTimeout.current = null
    }, 350)
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

  function resizePetByStep(step: number) {
    dragState.current = null
    setPressed(false)
    window.bilimiDesktop?.resizeFloatingSealByStep?.(step)
  }

  function restoreMainWindow() {
    setClickReactionSignal((signal) => signal + 1)
    setPetState('hint')
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }

  async function submitChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const content = chatDraft.trim()

    if (!content || chatBusy) {
      return
    }

    const messages = [...chatMessages, { role: 'user' as const, content }].slice(-6)
    setChatMessages(messages)
    setChatDraft('')
    setChatBusy(true)
    setChatError('')

    try {
      const result = await window.bilimiDesktop?.generateDeepSeek?.({
        kind: 'pet-chat',
        messages
      })

      if (!result || result.kind !== 'pet-chat') {
        throw new Error('Xiao Mi could not answer right now.')
      }

      const nextMessages = [
        ...messages,
        { role: 'assistant' as const, content: result.message }
      ].slice(-6)
      setChatMessages(nextMessages)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Xiao Mi could not answer right now.')
    } finally {
      setChatBusy(false)
    }
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
        onContextMenu={(event) => {
          event.preventDefault()
          dragState.current = null
          setPressed(false)
          window.bilimiDesktop?.closeAssistantPet?.()
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
        onPointerEnter={() => {
          showResizeControls()
        }}
        onPointerLeave={() => {
          scheduleHideResizeControls()
        }}
      >
        <span className="palace-maid-pet__halo" aria-hidden="true" />
        <LayeredPetRenderer
          petState={petState}
          clickReactionSignal={clickReactionSignal}
          petStyle={petStyle}
        />
      </button>
      <span className="palace-maid-pet__bubble" data-chat-open={chatOpen ? 'true' : 'false'}>
        <button
          className="palace-maid-pet__bubble-toggle"
          type="button"
          aria-label="Open Xiao Mi chat"
          onClick={() => {
            setChatOpen((open) => !open)
          }}
        >
          <strong>{stateView.label}</strong>
          <span>{stateView.bubble}</span>
        </button>
        {chatOpen ? (
          <form className="palace-maid-pet__chat" onSubmit={submitChatMessage}>
            {chatMessages.length > 0 ? (
              <span className="palace-maid-pet__chat-log" aria-live="polite">
                {chatMessages.map((message, index) => (
                  <span
                    className="palace-maid-pet__chat-message"
                    data-role={message.role}
                    key={`${message.role}-${index}-${message.content}`}
                  >
                    {message.content}
                  </span>
                ))}
              </span>
            ) : null}
            {chatError ? <span role="alert">{chatError}</span> : null}
            <label className="palace-maid-pet__chat-field">
              <span>Talk to Xiao Mi</span>
              <input
                value={chatDraft}
                onChange={(event) => {
                  setChatDraft(event.target.value)
                }}
                disabled={chatBusy}
              />
            </label>
            <button type="submit" disabled={chatBusy || !chatDraft.trim()}>
              Send
            </button>
          </form>
        ) : null}
      </span>
      <div
        className="palace-maid-pet__resize-controls"
        role="group"
        aria-label="调整小mi大小"
        data-visible={resizeControlsVisible ? 'true' : 'false'}
        onPointerEnter={showResizeControls}
        onPointerLeave={scheduleHideResizeControls}
      >
        <button
          className="palace-maid-pet__resize-step"
          type="button"
          aria-label="缩小小mi"
          title="缩小小mi"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            resizePetByStep(-1)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            setPressed(false)
          }}
        >
          -
        </button>
        <button
          className="palace-maid-pet__resize-step"
          type="button"
          aria-label="放大小mi"
          title="放大小mi"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            resizePetByStep(1)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            setPressed(false)
          }}
        >
          +
        </button>
      </div>
    </main>
  )
}
