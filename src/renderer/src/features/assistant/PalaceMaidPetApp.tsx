import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
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
import {
  PET_IDLE_GREETINGS,
  PET_TEASE_CLICK_LINES,
  PET_WELCOME_HOME_LINES,
  pickPetLine
} from './petInteractionLines'
import { publishDeepSeekTask } from './deepSeekTaskSignal'
import type { FloatingAssistantWorkspaceRequest } from './assistantRuntimeTypes'

const DRAG_THRESHOLD_PX = 5
const LONG_PRESS_SUPPRESSION_MS = 350
const IDLE_GREETING_DELAY_MS = 45_000
const PET_TEASE_CLICK_WINDOW_MS = 1_500
const PET_TEASE_CLICK_THRESHOLD = 3
const PET_SIZE_STEP_PX = 16
const PET_SIZE_MIN_PX = 100
const PET_SIZE_MAX_PX = 164
const PET_SIZE_DEFAULT_PX = 148
const PET_HOVER_GRID_SIZE_THRESHOLD_PX = 116
const PET_LONG_HOVER_DELAY_MS = 5_000
const FLOATING_PET_HOST_WIDTH_PX = 336
const FLOATING_ASSISTANT_WIDTH_PX = 460
const FLOATING_ASSISTANT_GAP_PX = 12
const DEEPSEEK_CHAT_DISABLED_MESSAGE =
  '主人，想要跟小咪交流的话去设置开启DeepSeek支持吧'
const DEEPSEEK_PET_CHAT_DISABLED_MESSAGE =
  '主人，想要跟小咪交流的话去设置开启DeepSeek宠物对话功能吧'
const BILIBILI_VIDEO_URL_PATTERN = /bilibili\.com\/video\/[^/?#]+/i

const PET_SHORTCUT_NO_VIDEO_HINTS: Partial<Record<PetHoverShortcut['id'], string>> = {
  like: '主人，当前还没打开视频，小咪不能帮这条点喜欢。',
  favorite: '主人，当前还没打开视频，小咪不能把这条归入 bilimi。',
  coin: '主人，当前还没打开视频，小咪不能给这条投币。',
  comment: '主人，当前还没打开视频，小咪不能帮这条拟短评。',
  transcribe: '主人，当前还没打开视频，小咪不能帮这条转写音频。'
}

type DragState = {
  startClientX: number
  startClientY: number
  startScreenX: number
  startScreenY: number
  moved: boolean
  started: boolean
  longPress: boolean
}

type FloatingAssistantSide = 'left' | 'right'

export function PalaceMaidPetApp() {
  const dragState = useRef<DragState | null>(null)
  const longPressTimeout = useRef<number | null>(null)
  const idleGreetingTimeout = useRef<number | null>(null)
  const resizeControlsHideTimeout = useRef<number | null>(null)
  const hoverShortcutsHideTimeout = useRef<number | null>(null)
  const petLongHoverTimeout = useRef<number | null>(null)
  const interactiveHoverCount = useRef(0)
  const petClickStreak = useRef({ count: 0, lastAt: 0 })
  const suppressNextClick = useRef(false)
  const chatTailRef = useRef<HTMLSpanElement | null>(null)
  const chatOpenRef = useRef(false)
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
  const [hoverPreview, setHoverPreview] = useState<AssistantPetHint | null>(null)
  const [closePromptVisible, setClosePromptVisible] = useState(false)
  const [workspaceSide, setWorkspaceSide] = useState<FloatingAssistantSide | null>(null)
  const visiblePetState = hoverPreview?.tone ?? petHint?.tone ?? petState
  const stateView = createPetStateView(visiblePetState)
  const bubbleMessage = hoverPreview?.message ?? petHint?.message ?? stateView.bubble
  const deepSeekChatEnabled =
    preferences.deepseekEnabled &&
    preferences.deepseekApiKeyStored &&
    preferences.deepseekPetChatEnabled
  const hoverShortcuts = resolvePetHoverShortcuts(preferences.petHoverShortcuts)
  const hoverShortcutLayout =
    hoverShortcuts.length >= 4 && petSize <= PET_HOVER_GRID_SIZE_THRESHOLD_PX ? 'grid' : 'fan'

  function showLocalPetHint(tone: AssistantPetHint['tone'], message: string) {
    setPetHint({ tone, message })
  }

  function previewHoverHint(tone: AssistantPetHint['tone'], message: string) {
    setHoverPreview({ tone, message })
  }

  function clearHoverPreview() {
    setHoverPreview(null)
  }

  function clearPetLongHoverTimeout() {
    if (petLongHoverTimeout.current !== null) {
      window.clearTimeout(petLongHoverTimeout.current)
      petLongHoverTimeout.current = null
    }
  }

  function previewPetHover() {
    clearPetLongHoverTimeout()
    previewHoverHint('hint', '小咪：打开/唤醒 bilimi~可拖拽移动，右键聊天或关闭')
    petLongHoverTimeout.current = window.setTimeout(() => {
      previewHoverHint('hint', '嘿嘿主人，想要小咪做点什么吗~')
      petLongHoverTimeout.current = null
    }, PET_LONG_HOVER_DELAY_MS)
  }

  function clearPetHoverPreview() {
    clearPetLongHoverTimeout()
    clearHoverPreview()
  }

  function scheduleIdleGreeting() {
    if (idleGreetingTimeout.current !== null) {
      window.clearTimeout(idleGreetingTimeout.current)
      idleGreetingTimeout.current = null
    }

    if (chatOpenRef.current) {
      return
    }

    idleGreetingTimeout.current = window.setTimeout(() => {
      if (chatOpenRef.current) {
        idleGreetingTimeout.current = null
        return
      }

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

      showLocalPetHint(hint.tone, message)
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
      clearPetHoverPreview()
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
      clearPetLongHoverTimeout()
      window.bilimiDesktop?.setFloatingSealMouseTransparent?.(true)
      window.removeEventListener('blur', hideClosePrompt)
    }
  }, [])

  useEffect(() => {
    chatOpenRef.current = chatOpen
    scheduleIdleGreeting()

    return () => {
      if (idleGreetingTimeout.current !== null) {
        window.clearTimeout(idleGreetingTimeout.current)
        idleGreetingTimeout.current = null
      }
    }
  }, [chatOpen])

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

  function getRestorePetHint(): AssistantPetHint {
    const now = Date.now()
    const withinTeaseWindow = now - petClickStreak.current.lastAt <= PET_TEASE_CLICK_WINDOW_MS
    const nextCount = withinTeaseWindow ? petClickStreak.current.count + 1 : 1

    petClickStreak.current = { count: nextCount, lastAt: now }

    if (nextCount >= PET_TEASE_CLICK_THRESHOLD) {
      return { tone: 'surprised', message: pickPetLine(PET_TEASE_CLICK_LINES) }
    }

    return { tone: 'shy', message: pickPetLine(PET_WELCOME_HOME_LINES) }
  }

  function restoreMainWindow() {
    setClosePromptVisible(false)
    clearPetHoverPreview()
    setClickReactionSignal((signal) => signal + 1)
    const hint = getRestorePetHint()
    showLocalPetHint(hint.tone, hint.message)
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

  function letsFloatingAssistantHandleCurrentVideoCheck(shortcut: PetHoverShortcut) {
    return (
      shortcut.intent === 'video-action' &&
      shortcut.action === '表' &&
      preferences.commentSubmitMode !== 'random'
    )
  }

  function getNoVideoHint(shortcut: PetHoverShortcut) {
    return PET_SHORTCUT_NO_VIDEO_HINTS[shortcut.id] ?? '主人，当前还没打开视频，小咪不能帮这个忙。'
  }

  function explainHoverShortcut(shortcut: PetHoverShortcut) {
    if (shortcut.id === 'coin') {
      previewHoverHint(
        'hint',
        `${shortcut.label}：一键三连，当前将投 ${preferences.defaultCoinCount} 枚硬币`
      )
      return
    }

    if (shortcut.id === 'comment') {
      previewHoverHint(
        'hint',
        preferences.commentSubmitMode === 'random'
          ? '表：一键弹幕，当前会随机生成一条并直接发送'
          : '表：一键弹幕，当前会生成 3 条候选，选择后发送'
      )
      return
    }

    previewHoverHint('hint', `${shortcut.label}：${shortcut.description}`)
  }

  async function runShortcutWithPetResult(
    workingMessage: string,
    action: () => Promise<{ ok?: boolean; message?: string } | null | undefined> | undefined,
    fallbackMessage: string
  ) {
    showLocalPetHint('working', workingMessage)

    try {
      const result = await action()
      const message = result?.message?.trim() || fallbackMessage
      showLocalPetHint(result?.ok === false ? 'error' : 'done', message)
    } catch (error) {
      showLocalPetHint(
        'error',
        error instanceof Error ? error.message : '小咪执行快捷操作时遇到问题。'
      )
    }
  }

  function createWorkspaceAnchor(event?: ReactMouseEvent<HTMLButtonElement>) {
    if (!event || (!event.screenX && !event.screenY)) {
      return undefined
    }

    return {
      screenX: Math.round(event.screenX),
      screenY: Math.round(event.screenY)
    }
  }

  function openFloatingWorkspace(payload: FloatingAssistantWorkspaceRequest) {
    const anchorX = payload.anchor?.screenX ?? window.screenX + window.innerWidth / 2
    const availableLeft = window.screen.availLeft || 0
    const requiredLeftSpace =
      FLOATING_PET_HOST_WIDTH_PX / 2 + FLOATING_ASSISTANT_WIDTH_PX + FLOATING_ASSISTANT_GAP_PX * 2
    setWorkspaceSide(anchorX - availableLeft >= requiredLeftSpace ? 'left' : 'right')
    void window.bilimiDesktop?.openFloatingAssistantWorkspace?.(payload)
  }

  function openAssistantShortcut(event?: ReactMouseEvent<HTMLButtonElement>) {
    dragState.current = null
    setPressed(false)
    setClosePromptVisible(false)
    clearHoverPreview()
    const anchor = createWorkspaceAnchor(event)
    showLocalPetHint('happy', '主人，小咪把小窗口打开啦。')
    openFloatingWorkspace({ tab: 'review', anchor })
  }

  async function runHoverShortcut(
    shortcut: PetHoverShortcut,
    event?: ReactMouseEvent<HTMLButtonElement>
  ) {
    dragState.current = null
    setPressed(false)
    setClosePromptVisible(false)
    clearHoverPreview()
    const anchor = createWorkspaceAnchor(event)

    if (
      requiresCurrentVideo(shortcut) &&
      !letsFloatingAssistantHandleCurrentVideoCheck(shortcut) &&
      !(await hasCurrentVideo())
    ) {
      showLocalPetHint('error', getNoVideoHint(shortcut))
      return
    }

    if (shortcut.id === 'assistant') {
      showLocalPetHint('happy', '主人，小咪把小窗口打开啦。')
      openFloatingWorkspace({ tab: 'review', anchor })
      return
    }

    if (shortcut.id === 'library') {
      showLocalPetHint('happy', '主人，小咪打开档案库啦。')
      openFloatingWorkspace({
        tab: 'notes',
        anchor,
        openNoteArchive: true
      })
      return
    }

    if (shortcut.id === 'organize-old-favorites') {
      showLocalPetHint('happy', '主人，小咪切到掌库啦，旧藏整理从这里开始。')
      openFloatingWorkspace({
        tab: 'ledger',
        anchor,
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
        '主人，小咪正在备齐 bilimi 册目。',
        () => window.bilimiDesktop?.ensureFavoriteLedgers?.(),
        '册目已备齐。'
      )
      return
    }

    if (shortcut.intent === 'video-action' && shortcut.action === '表') {
      if (preferences.commentSubmitMode === 'random') {
        void runShortcutWithPetResult(
          '主人，小咪随机拟一条弹幕直接发送。',
          () => window.bilimiDesktop?.runFloatingMenuAction?.('表'),
          '弹幕已发送，没有看到请检查弹幕开关是否开启'
        )
        return
      }

      showLocalPetHint('happy', '主人，小咪打开短评三选一小窗口啦。')
      openFloatingWorkspace({
        action: '表',
        anchor,
        tab: 'review'
      })
      return
    }

    if (shortcut.intent === 'video-action' && shortcut.action) {
      const action = shortcut.action
      void runShortcutWithPetResult(
        `主人，小咪这就去办「${shortcut.label}」。`,
        () => window.bilimiDesktop?.runFloatingMenuAction?.(action),
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
    clearHoverPreview()
    chatOpenRef.current = true
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
    const finishDeepSeekTask = publishDeepSeekTask({
      id: `pet-chat:${Date.now()}:${Math.random()}`,
      kind: 'pet-chat',
      detail: '宠物对话：正在生成小咪回复'
    })

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
      finishDeepSeekTask()
      setChatBusy(false)
    }
  }

  return (
    <main
      className="palace-maid-pet-shell"
      aria-label="bilimi 小咪"
      data-workspace-side={workspaceSide ?? undefined}
      style={{ '--floating-pet-size': `${petSize}px` } as CSSProperties}
    >
      <button
        className="palace-maid-pet"
        type="button"
        aria-label="打开 bilimi，小咪在这里"
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
        onPointerCancel={finishDrag}
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
          clearPetHoverPreview()
          leaveInteractiveRegion()
        }}
        onPointerEnter={() => {
          enterInteractiveRegion()
          showResizeControls()
          showHoverShortcuts()
          previewPetHover()
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
        data-layout={hoverShortcutLayout}
        data-assistant-shortcut={preferences.showPetAssistantShortcut ? 'true' : 'false'}
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
            data-testid="pet-hover-shortcut"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void runHoverShortcut(shortcut, event)
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              setPressed(false)
            }}
            onPointerEnter={() => explainHoverShortcut(shortcut)}
            onPointerLeave={clearHoverPreview}
          >
            {shortcut.label}
          </button>
        ))}
        {preferences.showPetAssistantShortcut ? (
          <button
            className="palace-maid-pet__assistant-shortcut"
            type="button"
            aria-label="打开小咪"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openAssistantShortcut(event)
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
              setPressed(false)
            }}
            onPointerEnter={() => previewHoverHint('hint', '咪：打开小咪功能窗口')}
            onPointerLeave={clearHoverPreview}
          >
            咪
          </button>
        ) : null}
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
            onPointerEnter={() =>
              previewHoverHint(
                'working',
                '对话宠物：打开输入框，和小咪聊天（需启用 DeepSeek）'
              )
            }
            onPointerLeave={clearHoverPreview}
          >
            对话宠物
          </button>
          <button
            className="palace-maid-pet__quick-action"
            type="button"
            onClick={closePetFromPrompt}
            onPointerEnter={() => previewHoverHint('error', '关闭宠物：主人要关闭小咪吗？')}
            onPointerLeave={clearHoverPreview}
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
                <span className="palace-maid-pet__chat-compose">
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
                </span>
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
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            resizePetByStep(-1)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            setPressed(false)
          }}
          onPointerEnter={() => previewHoverHint('hint', '缩小：缩小小咪的显示尺寸')}
          onPointerLeave={clearHoverPreview}
        >
          -
        </button>
        <button
          className="palace-maid-pet__resize-step"
          type="button"
          aria-label="放大小咪"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            resizePetByStep(1)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            setPressed(false)
          }}
          onPointerEnter={() => previewHoverHint('hint', '放大：放大小咪的显示尺寸')}
          onPointerLeave={clearHoverPreview}
        >
          +
        </button>
      </div>
    </main>
  )
}
