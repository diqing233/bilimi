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
const LONG_PRESS_SUPPRESSION_MS = 350
const DEEPSEEK_CHAT_DISABLED_MESSAGE =
  '主人，想要跟小咪交流的话去设置开启DeepSeek支持吧'

type DragState = {
  startClientX: number
  startClientY: number
  startScreenX: number
  startScreenY: number
  moved: boolean
  started: boolean
  longPress: boolean
}

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const longPressTimeout = useRef<number | null>(null)
  const resizeControlsHideTimeout = useRef<number | null>(null)
  const suppressNextClick = useRef(false)
  const [pressed, setPressed] = useState(false)
  const [resizeControlsVisible, setResizeControlsVisible] = useState(false)
  const [petState, setPetState] = useState<AssistantPetState>('idle')
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const [clickReactionSignal, setClickReactionSignal] = useState(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [chatMessages, setChatMessages] = useState<DeepSeekChatMessage[]>([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  const [closePromptVisible, setClosePromptVisible] = useState(false)
  const stateView = createPetStateView(petState)
  const deepSeekChatEnabled = preferences.deepseekEnabled && preferences.deepseekApiKeyStored

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetStateChanged?.((state) => {
      setPetState(normalizePetState(state))
    })
  }, [])

  useEffect(() => {
    let disposed = false

    async function loadPreferences() {
      const preferences = await window.bilimiDesktop?.loadPreferences?.()

      if (!disposed) {
        setPreferences(createInitialAssistantPreferences(preferences))
      }
    }

    void loadPreferences()

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPreferencesChanged?.((preferences) => {
      setPreferences(createInitialAssistantPreferences(preferences))
    })
  }, [])

  useEffect(() => {
    function hideClosePrompt() {
      setClosePromptVisible(false)
      setChatOpen(false)
    }

    window.addEventListener('blur', hideClosePrompt)

    return () => {
      if (longPressTimeout.current !== null) {
        window.clearTimeout(longPressTimeout.current)
      }
      if (resizeControlsHideTimeout.current !== null) {
        window.clearTimeout(resizeControlsHideTimeout.current)
      }
      window.removeEventListener('blur', hideClosePrompt)
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

  function startDragCandidate(clientX: number, clientY: number, screenX: number, screenY: number) {
    if (longPressTimeout.current !== null) {
      window.clearTimeout(longPressTimeout.current)
    }

    dragState.current = {
      startClientX: clientX,
      startClientY: clientY,
      startScreenX: screenX,
      startScreenY: screenY,
      started: false,
      longPress: false,
      moved: false
    }

    longPressTimeout.current = window.setTimeout(() => {
      if (dragState.current && !dragState.current.moved && !dragState.current.started) {
        dragState.current = {
          ...dragState.current,
          longPress: true
        }
      }
      longPressTimeout.current = null
    }, LONG_PRESS_SUPPRESSION_MS)
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

    if (moved) {
      if (longPressTimeout.current !== null) {
        window.clearTimeout(longPressTimeout.current)
        longPressTimeout.current = null
      }

      if (!currentDrag.started) {
        window.bilimiDesktop?.startFloatingSealDrag?.(
          currentDrag.startScreenX,
          currentDrag.startScreenY
        )
      }

      dragState.current = {
        ...currentDrag,
        moved: true,
        started: true
      }
      return
    }

    dragState.current = {
      ...currentDrag,
      moved
    }
  }

  function finishDrag() {
    const currentDrag = dragState.current

    if (longPressTimeout.current !== null) {
      window.clearTimeout(longPressTimeout.current)
      longPressTimeout.current = null
    }

    if (!currentDrag) {
      setPressed(false)
      return false
    }

    dragState.current = null
    setPressed(false)

    if (currentDrag.started) {
      window.bilimiDesktop?.finishFloatingSealDrag?.()
    }

    if (currentDrag.moved || currentDrag.longPress) {
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
    setClosePromptVisible(false)
    setClickReactionSignal((signal) => signal + 1)
    setPetState('hint')
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }

  function showClosePrompt() {
    dragState.current = null
    if (longPressTimeout.current !== null) {
      window.clearTimeout(longPressTimeout.current)
      longPressTimeout.current = null
    }
    setPressed(false)
    setClosePromptVisible(true)
  }

  function openPetChat() {
    setClosePromptVisible(false)
    setChatOpen(true)
  }

  function closePetFromPrompt() {
    setClosePromptVisible(false)
    window.bilimiDesktop?.closeAssistantPet?.()
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
        throw new Error('小咪现在还答不上来。')
      }

      const nextMessages = [
        ...messages,
        { role: 'assistant' as const, content: result.message }
      ].slice(-6)
      setChatMessages(nextMessages)
    } catch (error) {
      setChatError(error instanceof Error ? error.message : '小咪现在还答不上来。')
    } finally {
      setChatBusy(false)
    }
  }

  return (
    <main className="palace-maid-pet-shell" aria-label="Bilimi 小咪">
      <button
        className="palace-maid-pet"
        type="button"
        aria-label="打开 Bilimi，小咪在这里"
        title="打开 Bilimi，小咪在这里"
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
          showClosePrompt()
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          setPressed(true)
          startDragCandidate(event.clientX, event.clientY, event.screenX, event.screenY)
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
          if (longPressTimeout.current !== null) {
            window.clearTimeout(longPressTimeout.current)
            longPressTimeout.current = null
          }
          setPressed(false)
        }}
        onPointerLeave={() => {
          const currentDrag = dragState.current

          if (currentDrag && !currentDrag.started) {
            dragState.current = {
              ...currentDrag,
              longPress: true
            }
          }
          scheduleHideResizeControls()
        }}
        onPointerEnter={() => {
          showResizeControls()
        }}
      >
        <span className="palace-maid-pet__halo" aria-hidden="true" />
        <LayeredPetRenderer
          petState={petState}
          clickReactionSignal={clickReactionSignal}
          petStyle={preferences.petStyle}
        />
      </button>
      {closePromptVisible ? (
        <span className="palace-maid-pet__quick-actions" role="group" aria-label="小咪快捷操作">
          <button
            className="palace-maid-pet__quick-action"
            type="button"
            onClick={openPetChat}
          >
            对话宠物
          </button>
          <button
            className="palace-maid-pet__quick-action"
            type="button"
            onClick={closePetFromPrompt}
          >
            关闭宠物
          </button>
        </span>
      ) : null}
      <span className="palace-maid-pet__bubble" data-chat-open={chatOpen ? 'true' : 'false'}>
        <button
          className="palace-maid-pet__bubble-toggle"
          type="button"
          aria-label="打开小咪对话"
          onClick={openPetChat}
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
            {deepSeekChatEnabled ? (
              <>
                <label className="palace-maid-pet__chat-field">
                  <span>和小咪说话</span>
                  <input
                    value={chatDraft}
                    onChange={(event) => {
                      setChatDraft(event.target.value)
                    }}
                    disabled={chatBusy}
                  />
                </label>
                <button type="submit" disabled={chatBusy || !chatDraft.trim()}>
                  发送
                </button>
              </>
            ) : (
              <span className="palace-maid-pet__chat-disabled" role="status">
                {DEEPSEEK_CHAT_DISABLED_MESSAGE}
              </span>
            )}
          </form>
        ) : null}
      </span>
      <div
        className="palace-maid-pet__resize-controls"
        role="group"
        aria-label="调整小咪大小"
        data-visible={resizeControlsVisible ? 'true' : 'false'}
        onPointerEnter={showResizeControls}
        onPointerLeave={scheduleHideResizeControls}
      >
        <button
          className="palace-maid-pet__resize-step"
          type="button"
          aria-label="缩小小咪"
          title="缩小小咪"
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
          aria-label="放大小咪"
          title="放大小咪"
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
