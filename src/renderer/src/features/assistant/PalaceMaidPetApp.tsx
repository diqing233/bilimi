import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { resolvePetHoverShortcuts, type PetHoverShortcut } from '@shared/petHoverShortcuts'
import { LayeredPetRenderer } from './LayeredPetRenderer'
import {
  createPetStateView,
  normalizePetState,
  type AssistantPetHint,
  type AssistantPetState
} from './petState'
import { createInitialAssistantPreferences } from '../state/assistantState'
import type { AssistantPreferences, DeepSeekChatMessage } from '@shared/types'
import { PET_IDLE_GREETINGS, PET_WELCOME_HOME_LINES, pickPetLine } from './petInteractionLines'

const DRAG_THRESHOLD_PX = 5
const LONG_PRESS_SUPPRESSION_MS = 350
const IDLE_GREETING_DELAY_MS = 45_000
const PET_SIZE_STEP_PX = 16
const PET_SIZE_MIN_PX = 116
const PET_SIZE_MAX_PX = 164
const PET_SIZE_DEFAULT_PX = 148
const DEEPSEEK_CHAT_DISABLED_MESSAGE =
  '主人，想要跟小咪交流的话去设置开启DeepSeek支持吧'
const DEEPSEEK_PET_CHAT_DISABLED_MESSAGE =
  '主人，想要跟小咪交流的话去设置开启DeepSeek宠物对话功能吧'
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/[^/?#]+/i

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
  const idleGreetingTimeout = useRef<number | null>(null)
  const resizeControlsHideTimeout = useRef<number | null>(null)
  const hoverShortcutsHideTimeout = useRef<number | null>(null)
  const interactiveHoverCount = useRef(0)
  const suppressNextClick = useRef(false)
  const chatTailRef = useRef<HTMLSpanElement | null>(null)
  const [pressed, setPressed] = useState(false)
  const [resizeControlsVisible, setResizeControlsVisible] = useState(false)
  const [hoverShortcutsVisible, setHoverShortcutsVisible] = useState(false)
  const [petSize, setPetSize] = useState(PET_SIZE_DEFAULT_PX)
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
  const [petHint, setPetHint] = useState<AssistantPetHint | null>(null)
  const [closePromptVisible, setClosePromptVisible] = useState(false)
  const visiblePetState = petHint?.tone ?? petState
  const stateView = createPetStateView(visiblePetState)
  const bubbleMessage = petHint?.message ?? stateView.bubble
  const deepSeekChatEnabled =
    preferences.deepseekEnabled &&
    preferences.deepseekApiKeyStored &&
    preferences.deepseekPetChatEnabled
  const hoverShortcuts = resolvePetHoverShortcuts(preferences.petHoverShortcuts)

  function showLocalPetHint(tone: AssistantPetHint['tone'], message: string) {
    setPetHint({ tone, message })
  }

  function scheduleIdleGreeting() {
    if (idleGreetingTimeout.current !== null) {
      window.clearTimeout(idleGreetingTimeout.current)
    }

    idleGreetingTimeout.current = window.setTimeout(() => {
      showLocalPetHint('hint', pickPetLine(PET_IDLE_GREETINGS))
      idleGreetingTimeout.current = null
      scheduleIdleGreeting()
    }, IDLE_GREETING_DELAY_MS)
  }

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetStateChanged?.((state) => {
      setPetState(normalizePetState(state))
      scheduleIdleGreeting()
    })
  }, [])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantPetHintChanged?.((hint) => {
      const message = hint.message.trim()

      if (!message) {
        return
      }

      showLocalPetHint(hint.tone === 'working' || hint.tone === 'error' ? hint.tone : 'hint', message)
      scheduleIdleGreeting()
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
    window.bilimiDesktop?.setFloatingSealMouseTransparent?.(true)

    function hideClosePrompt() {
      setClosePromptVisible(false)
      setChatOpen(false)
    }

    window.addEventListener('blur', hideClosePrompt)

    return () => {
      if (longPressTimeout.current !== null) {
        window.clearTimeout(longPressTimeout.current)
      }
      if (idleGreetingTimeout.current !== null) {
        window.clearTimeout(idleGreetingTimeout.current)
      }
      if (resizeControlsHideTimeout.current !== null) {
        window.clearTimeout(resizeControlsHideTimeout.current)
      }
      if (hoverShortcutsHideTimeout.current !== null) {
        window.clearTimeout(hoverShortcutsHideTimeout.current)
      }
      window.bilimiDesktop?.setFloatingSealMouseTransparent?.(true)
      window.removeEventListener('blur', hideClosePrompt)
    }
  }, [])

  useEffect(() => {
    scheduleIdleGreeting()

    return () => {
      if (idleGreetingTimeout.current !== null) {
        window.clearTimeout(idleGreetingTimeout.current)
        idleGreetingTimeout.current = null
      }
    }
  }, [])

  function enterInteractiveRegion() {
    interactiveHoverCount.current += 1
    scheduleIdleGreeting()
    window.bilimiDesktop?.setFloatingSealMouseTransparent?.(false)
  }

  function leaveInteractiveRegion() {
    interactiveHoverCount.current = Math.max(0, interactiveHoverCount.current - 1)

    if (interactiveHoverCount.current === 0) {
      window.bilimiDesktop?.setFloatingSealMouseTransparent?.(true)
    }
  }

  useEffect(() => {
    if (!chatOpen || chatMessages.length === 0) {
      return
    }

    chatTailRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' })
  }, [chatMessages.length, chatOpen])

  function showResizeControls() {
    if (resizeControlsHideTimeout.current !== null) {
      window.clearTimeout(resizeControlsHideTimeout.current)
      resizeControlsHideTimeout.current = null
    }

    setResizeControlsVisible(true)
  }

  function showHoverShortcuts() {
    if (hoverShortcutsHideTimeout.current !== null) {
      window.clearTimeout(hoverShortcutsHideTimeout.current)
      hoverShortcutsHideTimeout.current = null
    }

    setHoverShortcutsVisible(true)
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

  function scheduleHideHoverShortcuts() {
    if (hoverShortcutsHideTimeout.current !== null) {
      window.clearTimeout(hoverShortcutsHideTimeout.current)
    }

    hoverShortcutsHideTimeout.current = window.setTimeout(() => {
      setHoverShortcutsVisible(false)
      hoverShortcutsHideTimeout.current = null
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
    setPetSize((currentSize) =>
      Math.min(
        Math.max(currentSize + Math.sign(step) * PET_SIZE_STEP_PX, PET_SIZE_MIN_PX),
        PET_SIZE_MAX_PX
      )
    )
  }

  function restoreMainWindow() {
    setClosePromptVisible(false)
    setClickReactionSignal((signal) => signal + 1)
    showLocalPetHint('shy', pickPetLine(PET_WELCOME_HOME_LINES))
    void window.bilimiDesktop?.restoreMainWindowFromPet?.()
  }

  async function hasCurrentVideo() {
    try {
      const snapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()
      return Boolean(snapshot?.activeTabUrl && BILIBILI_VIDEO_URL_PATTERN.test(snapshot.activeTabUrl))
    } catch {
      return false
    }
  }

  function requiresCurrentVideo(shortcut: PetHoverShortcut) {
    return shortcut.intent === 'video-action' || shortcut.id === 'transcribe'
  }

  async function runShortcutWithPetResult(
    workingMessage: string,
    action: () => Promise<{ ok?: boolean; message?: string } | null | undefined>,
    fallbackMessage: string
  ) {
    showLocalPetHint('working', workingMessage)

    try {
      const result = await action()
      const message = result?.message?.trim() || fallbackMessage
      showLocalPetHint(result?.ok === false ? 'error' : 'hint', message)
    } catch (error) {
      showLocalPetHint(
        'error',
        error instanceof Error ? error.message : '小咪执行快捷操作时遇到问题。'
      )
    }
  }

  async function runHoverShortcut(shortcut: PetHoverShortcut) {
    dragState.current = null
    setPressed(false)
    setClosePromptVisible(false)

    if (requiresCurrentVideo(shortcut) && !(await hasCurrentVideo())) {
      showLocalPetHint('hint', '暂无视频')
      return
    }

    if (shortcut.id === 'assistant') {
      showLocalPetHint('hint', '主人，小咪把小窗口打开啦。')
      void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'review' })
      return
    }

    if (shortcut.id === 'library') {
      showLocalPetHint('hint', '主人，小咪切到掌库啦。')
      void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({ tab: 'ledger' })
      return
    }

    if (shortcut.id === 'organize-old-favorites') {
      showLocalPetHint('hint', '主人，小咪切到掌库啦，旧藏整理从这里开始。')
      void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({
        tab: 'ledger',
        organizeOldFavorites: true
      })
      return
    }

    if (shortcut.id === 'transcribe') {
      void runShortcutWithPetResult(
        '小咪已经把转写加入队列，主人不用打开别的页面。',
        async () => {
          const queue = await window.bilimiDesktop?.enqueueCurrentVideoAudioTranscription?.()
          return queue ? { ok: true, message: '已加入转写队列，小咪会按顺序处理。' } : null
        },
        '已加入转写队列，小咪会按顺序处理。'
      )
      return
    }

    if (shortcut.id === 'prepare-ledgers') {
      void runShortcutWithPetResult(
        '主人，小咪正在备齐 Bilimi 册目。',
        () => window.bilimiDesktop?.ensureFavoriteLedgers?.(),
        '册目已备齐。'
      )
      return
    }

    if (shortcut.intent === 'video-action' && shortcut.action === '表') {
      showLocalPetHint('hint', '主人，小咪打开短评三选一小窗口啦。')
      void window.bilimiDesktop?.openFloatingAssistantWorkspace?.({
        action: '表',
        tab: 'review'
      })
      return
    }

    if (shortcut.intent === 'video-action' && shortcut.action) {
      void runShortcutWithPetResult(
        `主人，小咪这就去办「${shortcut.label}」。`,
        () => window.bilimiDesktop?.runFloatingMenuAction?.(shortcut.action),
        `「${shortcut.label}」已经处理好了。`
      )
      return
    }

    showLocalPetHint('hint', `主人，小咪暂时还不会直接处理「${shortcut.title}」。`)
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
    <main
      className="palace-maid-pet-shell"
      aria-label="Bilimi 小咪"
      style={{ '--floating-pet-size': `${petSize}px` } as CSSProperties}
    >
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
          scheduleHideHoverShortcuts()
          leaveInteractiveRegion()
        }}
        onPointerEnter={() => {
          enterInteractiveRegion()
          showResizeControls()
          showHoverShortcuts()
        }}
      >
        <span className="palace-maid-pet__halo" aria-hidden="true" />
        <LayeredPetRenderer
          petState={visiblePetState}
          clickReactionSignal={clickReactionSignal}
          petStyle={preferences.petStyle}
        />
      </button>
      <div
        className="palace-maid-pet__hover-shortcuts"
        role="group"
        aria-label="小咪悬浮快捷按钮"
        data-visible={hoverShortcutsVisible ? 'true' : 'false'}
        data-layout="fan"
        onPointerEnter={() => {
          enterInteractiveRegion()
          showHoverShortcuts()
        }}
        onPointerLeave={() => {
          scheduleHideHoverShortcuts()
          leaveInteractiveRegion()
        }}
      >
        {hoverShortcuts.map((shortcut) => (
          <button
            key={shortcut.id}
            className="palace-maid-pet__hover-shortcut"
            type="button"
            aria-label={shortcut.label}
            title={shortcut.title}
            data-testid="pet-hover-shortcut"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void runHoverShortcut(shortcut)
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              setPressed(false)
            }}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      {closePromptVisible ? (
        <span
          className="palace-maid-pet__quick-actions"
          role="group"
          aria-label="小咪快捷操作"
          onPointerEnter={enterInteractiveRegion}
          onPointerLeave={leaveInteractiveRegion}
        >
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
      <span
        className="palace-maid-pet__bubble"
        data-chat-open={chatOpen ? 'true' : 'false'}
        onPointerEnter={enterInteractiveRegion}
        onPointerLeave={leaveInteractiveRegion}
      >
        <button
          className="palace-maid-pet__bubble-toggle"
          type="button"
          aria-label="打开小咪对话"
          onClick={openPetChat}
        >
          <span>{bubbleMessage}</span>
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
                <span className="palace-maid-pet__chat-tail" ref={chatTailRef} aria-hidden="true" />
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
                {preferences.deepseekEnabled && preferences.deepseekApiKeyStored
                  ? DEEPSEEK_PET_CHAT_DISABLED_MESSAGE
                  : DEEPSEEK_CHAT_DISABLED_MESSAGE}
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
        onPointerEnter={() => {
          enterInteractiveRegion()
          showResizeControls()
        }}
        onPointerLeave={() => {
          scheduleHideResizeControls()
          leaveInteractiveRegion()
        }}
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
