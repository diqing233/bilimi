import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  RecommendationKind,
  VideoNote,
  VideoNoteExtractionResult,
  VisualAutomationFallback
} from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { executeAssistantAction } from '../actions/actionExecutor'
import { composeMemorialComments } from '../comments/commentComposer'
import { describeRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CoinPrompt } from './CoinPrompt'
import { CommentChooser } from './CommentChooser'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import { SealButton } from './SealButton'
import { BILIMI_LEDGER_PREFIX } from '@shared/favoriteLedgers'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'
import { normalizeExtractedVideoNoteResult } from '../notes/videoNoteExtractor'
import { createLocalVideoNoteDraft } from '../notes/videoNoteSummarizer'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

const CURRENT_TITLE = '早八生存实录'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const DEFAULT_OVERLAY_POSITION = { left: 24, top: 54 }
const DRAG_THRESHOLD_PX = 6
const OVERLAY_SAFE_GAP = 12
const COLLAPSED_SEAL_SIZE = { width: 44, height: 44 }
const MEMORIAL_PANEL_SIZE = { width: 236, height: 212 }
const ASSISTANT_DIALOG_SIZE = { width: 420, height: 220 }
const FAVORITE_LEDGER_PANEL_SIZE = { width: 520, height: 520 }
const DRAG_CLICK_SUPPRESSION_MS = 120
const VIDEO_CATEGORY_LABELS: Record<RecommendationKind, string> = {
  funny: '娱乐',
  humor: '娱乐',
  story: '小剧场',
  play: '游戏',
  life: '生活',
  craft: '科技数码',
  suspicious: '待确认'
}

type AssistantOverlayProps = {
  favoritesFolderName?: string
  openSignal?: number
  openPosition?: OverlayPosition
  readVideoContentContext?: () => Promise<VideoContentContext | null | undefined>
  readVideoNoteSource?: () => Promise<VideoNoteExtractionResult | null>
  readCurrentVideoTime?: () => Promise<number>
  seekVideoTime?: (seconds: number) => Promise<boolean>
  runActionSignal?: number
  runRequestedAction?: AssistantAction
  showSeal?: boolean
  videoContentContext?: VideoContentContext
  videoTitle?: string
  runVisualFallback?: VisualAutomationFallback
  runScript?: (script: string) => Promise<{
    ok: boolean
    steps: string[]
    missingTargets: string[]
    message: string
  }>
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  favoriteLedgerStatus?: FavoriteLedgerStatus
  readFavoriteLedgerStatus?: () => Promise<FavoriteLedgerStatus>
  scanOldFavorites?: () => Promise<FavoriteLedgerPreview>
  executeOldFavoritePlan?: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
  onRecordFeedback?: (kind: RecommendationKind, action: AssistantAction) => void
  saveVideoNote?: (note: VideoNote) => Promise<void>
  storedPreferences?: AssistantPreferences
}

const DEFAULT_RUN_RESULT = {
  ok: true,
  steps: [],
  missingTargets: [],
  message: '此折已阅。'
}

type ActionFeedback = {
  tone: 'progress' | 'success' | 'error'
  message: string
  steps: string[]
  missingTargets: string[]
}

type OverlayPosition = {
  left: number
  top: number
}

type DragState = {
  pointerId: number
  startClientX: number
  startClientY: number
  startLeft: number
  startTop: number
  moved: boolean
}

function stripBilimiPrefix(displayName: string) {
  return displayName.replace(BILIMI_LEDGER_PREFIX, '').trim()
}

function clampOverlayPositionForSize(
  position: OverlayPosition,
  size: { width: number; height: number }
): OverlayPosition {
  if (typeof window === 'undefined') {
    return position
  }

  const width = Math.min(size.width, Math.max(0, window.innerWidth - OVERLAY_SAFE_GAP * 2))
  const height = Math.min(size.height, Math.max(0, window.innerHeight - OVERLAY_SAFE_GAP * 2))
  const maxLeft = Math.max(OVERLAY_SAFE_GAP, window.innerWidth - OVERLAY_SAFE_GAP - width)
  const maxTop = Math.max(OVERLAY_SAFE_GAP, window.innerHeight - OVERLAY_SAFE_GAP - height)

  return {
    left: Math.min(Math.max(OVERLAY_SAFE_GAP, position.left), maxLeft),
    top: Math.min(Math.max(OVERLAY_SAFE_GAP, position.top), maxTop)
  }
}

function clampOverlayPosition(position: OverlayPosition): OverlayPosition {
  return clampOverlayPositionForSize(position, COLLAPSED_SEAL_SIZE)
}

export function AssistantOverlay({
  favoritesFolderName,
  openSignal = 0,
  openPosition,
  readVideoContentContext,
  readVideoNoteSource,
  readCurrentVideoTime,
  seekVideoTime,
  runActionSignal = 0,
  runRequestedAction,
  showSeal = true,
  videoContentContext,
  videoTitle = CURRENT_TITLE,
  runVisualFallback,
  runScript = async () => DEFAULT_RUN_RESULT,
  ensureFavoriteLedgers = async () => DEFAULT_RUN_RESULT,
  favoriteLedgerStatus,
  readFavoriteLedgerStatus,
  scanOldFavorites = async () => ({ items: [], skippedSourceFolderTitles: [] }),
  executeOldFavoritePlan = async () => DEFAULT_RUN_RESULT,
  onRecordFeedback,
  saveVideoNote,
  storedPreferences
}: AssistantOverlayProps) {
  const [open, setOpen] = useState(false)
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>(DEFAULT_OVERLAY_POSITION)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const suppressSealClickRef = useRef(false)
  const suppressSealClickTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [ledgerPanelOpen, setLedgerPanelOpen] = useState(false)
  const [ledgerStatus, setLedgerStatus] = useState<FavoriteLedgerStatus | null>(
    favoriteLedgerStatus ?? null
  )
  const [ledgerStatusChecked, setLedgerStatusChecked] = useState(false)
  const [panelMinimized, setPanelMinimized] = useState(false)
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [pageClickOnly, setPageClickOnly] = useState(true)
  const [latestVideoContentContext, setLatestVideoContentContext] = useState<
    VideoContentContext | undefined
  >(videoContentContext)
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
  const [preferences, setPreferences] = useState(() => createInitialAssistantPreferences(storedPreferences))
  const resolvedFavoritesFolderName = favoritesFolderName ?? preferences.favoritesFolderName
  const resolvedVideoTitle = videoTitle.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
  const resolvedVideoContentContext = useMemo<VideoContentContext>(
    () => latestVideoContentContext ?? videoContentContext ?? { title: resolvedVideoTitle },
    [latestVideoContentContext, resolvedVideoTitle, videoContentContext]
  )
  const resolvedVideoAuthor = resolvedVideoContentContext.author?.trim()
  const currentClassification = useMemo(
    () => classifyVideoContent(resolvedVideoContentContext, preferences.favoriteLedgers),
    [preferences.favoriteLedgers, resolvedVideoContentContext]
  )
  const currentKind = currentClassification.ledgerId
  const recommendation = useMemo(() => describeRecommendation(currentKind), [currentKind])
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle, resolvedVideoAuthor),
    [currentKind, resolvedVideoAuthor, resolvedVideoTitle]
  )
  const videoCategory =
    VIDEO_CATEGORY_LABELS[currentKind] || stripBilimiPrefix(currentClassification.displayName) || currentKind
  const expandedOverlaySize = ledgerPanelOpen
    ? FAVORITE_LEDGER_PANEL_SIZE
    : coinPromptOpen || commentChooserOpen
      ? ASSISTANT_DIALOG_SIZE
      : MEMORIAL_PANEL_SIZE
  const visibleOverlayPosition =
    open && !panelMinimized
      ? clampOverlayPositionForSize(overlayPosition, expandedOverlaySize)
      : overlayPosition
  const actionsLocked = runningAction !== null || coinPromptOpen || commentChooserOpen || ledgerPanelOpen

  function moveSealTo(clientX: number, clientY: number, pointerId: number) {
    const currentDragState = dragStateRef.current

    if (!currentDragState || currentDragState.pointerId !== pointerId) {
      return
    }

    const deltaX = clientX - currentDragState.startClientX
    const deltaY = clientY - currentDragState.startClientY
    const moved = currentDragState.moved || Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PX
    const nextDragState = { ...currentDragState, moved }

    setOverlayPosition(
      clampOverlayPosition({
        left: currentDragState.startLeft + deltaX,
        top: currentDragState.startTop + deltaY
      })
    )
    dragStateRef.current = nextDragState
    setDragState(nextDragState)
  }

  function startSealDrag(pointerId: number, clientX: number, clientY: number) {
    const nextDragState = {
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      startLeft: overlayPosition.left,
      startTop: overlayPosition.top,
      moved: false
    }

    dragStateRef.current = nextDragState
    setDragState(nextDragState)
  }

  function finishSealDrag(pointerId: number) {
    const currentDragState = dragStateRef.current

    if (!currentDragState || currentDragState.pointerId !== pointerId) {
      return
    }

    if (currentDragState.moved) {
      suppressSealClickRef.current = true

      if (suppressSealClickTimerRef.current) {
        window.clearTimeout(suppressSealClickTimerRef.current)
      }

      suppressSealClickTimerRef.current = window.setTimeout(() => {
        suppressSealClickRef.current = false
        suppressSealClickTimerRef.current = null
      }, DRAG_CLICK_SUPPRESSION_MS)
    }

    dragStateRef.current = null
    setDragState(null)
  }

  useEffect(() => {
    if (storedPreferences) {
      setPreferences(createInitialAssistantPreferences(storedPreferences))
    }
  }, [storedPreferences])

  useEffect(() => {
    if (openSignal > 0) {
      if (openPosition) {
        setOverlayPosition(clampOverlayPositionForSize(openPosition, expandedOverlaySize))
      }
      setPanelMinimized(false)
      setOpen(true)
    }
  }, [expandedOverlaySize, openPosition, openSignal])

  useEffect(() => {
    if (favoriteLedgerStatus) {
      setLedgerStatus(favoriteLedgerStatus)
      setLedgerStatusChecked(true)
    }
  }, [favoriteLedgerStatus])

  useEffect(() => {
    if (!open || ledgerStatusChecked || !readFavoriteLedgerStatus) {
      return
    }

    let cancelled = false

    async function checkFavoriteLedgerStatus() {
      try {
        const status = await readFavoriteLedgerStatus?.()

        if (!status || cancelled) {
          return
        }

        setLedgerStatus(status)
        setLedgerStatusChecked(true)

        if (status.ledgers.length > 0) {
          setPreferences((currentPreferences) =>
            createInitialAssistantPreferences({
              ...currentPreferences,
              favoriteLedgers: status.ledgers
            })
          )
        }
      } catch {
        if (!cancelled) {
          setLedgerStatusChecked(true)
        }
      }
    }

    void checkFavoriteLedgerStatus()

    return () => {
      cancelled = true
    }
  }, [ledgerStatusChecked, open, readFavoriteLedgerStatus])

  useEffect(() => {
    setLatestVideoContentContext(videoContentContext)
  }, [videoContentContext])

  useEffect(() => {
    return () => {
      if (suppressSealClickTimerRef.current) {
        window.clearTimeout(suppressSealClickTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!dragState) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      moveSealTo(event.clientX, event.clientY, event.pointerId)
    }
    const handlePointerUp = (event: PointerEvent) => {
      finishSealDrag(event.pointerId)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [dragState])

  async function readRecommendationKindFromPage() {
    try {
      const nextContext = await readVideoContentContext?.()

      if (nextContext) {
        setLatestVideoContentContext(nextContext)
        return classifyVideoContent(nextContext, preferences.favoriteLedgers).ledgerId
      }
    } catch {
      return currentKind
    }

    return currentKind
  }

  async function persistFeedback(action: AssistantAction, kind: RecommendationKind) {
    const baselinePreferences = window.bilimiDesktop?.loadPreferences
      ? createInitialAssistantPreferences(await window.bilimiDesktop.loadPreferences())
      : preferences
    const nextPreferences = recordAssistantPreferenceFeedback(
      baselinePreferences,
      kind,
      action
    )
    setPreferences(nextPreferences)
    onRecordFeedback?.(kind, action)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    setPreferences(nextPreferences)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  function dismissLedgerPrompt(openLedgerPanel: boolean) {
    if (openLedgerPanel) {
      setLedgerPanelOpen(true)
    }

    void persistPreferences({
      ...preferences,
      ledgerPromptDismissed: true
    })
  }

  async function generateVideoNote() {
    setVideoNoteLoading(true)

    try {
      const extraction = await readVideoNoteSource?.()

      if (!extraction) {
        return null
      }

      const safeExtraction = normalizeExtractedVideoNoteResult({
        ...extraction.source,
        transcript: extraction.transcript
      })
      const note = createLocalVideoNoteDraft({
        now: new Date().toISOString(),
        source: safeExtraction.source,
        transcript: safeExtraction.transcript,
        transcriptSource: safeExtraction.transcriptSource
      })

      setVideoNote(note)
      return note
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function persistVideoNote(note: VideoNote) {
    await saveVideoNote?.(note)
  }

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
    if (runningAction) {
      return
    }

    if (action !== '阅') {
      setPanelMinimized(true)
    }

    setRunningAction(action)
    setFeedback({
      tone: 'progress',
      message: action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。',
      steps: [],
      missingTargets: []
    })

    try {
      const actionRecommendationKind = readVideoContentContext
        ? await readRecommendationKindFromPage()
        : currentKind
      const result = await executeAssistantAction({
        action,
        favoritesFolderName: resolvedFavoritesFolderName,
        runScript,
        runVisualFallback,
        favoriteApiFallbackEnabled: !pageClickOnly,
        coinCount: options?.coinCount,
        commentDraft: options?.commentDraft,
        favoriteLedgers: preferences.favoriteLedgers,
        targetLedgerId: actionRecommendationKind
      })

      if (result.ok && action !== '阅') {
        await persistFeedback(action, actionRecommendationKind)
      }

      setFeedback({
        tone: result.ok ? 'success' : 'error',
        message: result.message,
        steps: result.steps,
        missingTargets: result.missingTargets
      })

      if (!result.ok) {
        setPanelMinimized(false)
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '代批时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
      setPanelMinimized(false)
    } finally {
      setRunningAction(null)
    }
  }

  function handleAction(action: AssistantAction) {
    if (actionsLocked) {
      return
    }

    setFeedback(null)

    if (action === '赐') {
      setCoinPromptOpen(true)
      return
    }

    if (action === '表') {
      setCommentChooserOpen(true)
      return
    }

    void runAction(action)
  }

  useEffect(() => {
    if (runActionSignal <= 0 || !runRequestedAction) {
      return
    }

    setOpen(true)
    setPanelMinimized(false)
    handleAction(runRequestedAction)
  }, [runActionSignal, runRequestedAction])

  function handleSealPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    startSealDrag(event.pointerId, event.clientX, event.clientY)
  }

  function handleSealPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    moveSealTo(event.clientX, event.clientY, event.pointerId)
  }

  function handleSealPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    finishSealDrag(event.pointerId)
  }

  function handleSealMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    startSealDrag(1, event.clientX, event.clientY)
  }

  function handleSealMouseMove(event: React.MouseEvent<HTMLButtonElement>) {
    moveSealTo(event.clientX, event.clientY, 1)
  }

  function handleSealMouseUp() {
    finishSealDrag(1)
  }

  function openFromSeal() {
    if (suppressSealClickRef.current) {
      suppressSealClickRef.current = false

      if (suppressSealClickTimerRef.current) {
        window.clearTimeout(suppressSealClickTimerRef.current)
        suppressSealClickTimerRef.current = null
      }

      return
    }

    setOpen(true)
  }

  if (!open && !showSeal) {
    return null
  }

  return (
    <div
      className={`assistant-overlay${panelMinimized ? ' assistant-overlay--minimized' : ''}${dragState?.moved ? ' assistant-overlay--dragging' : ''}`}
      style={{
        left: `${visibleOverlayPosition.left}px`,
        top: `${visibleOverlayPosition.top}px`
      }}
    >
      {open ? (
        <>
          {panelMinimized && feedback ? (
            <button
              type="button"
              className={`assistant-status-pill assistant-status-pill--${feedback.tone}`}
              aria-label="展开助手状态"
              onClick={() => setPanelMinimized(false)}
            >
              <span role={feedback.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
                {feedback.message}
              </span>
            </button>
          ) : (
            <MemorialPanel
              recommendation={recommendation}
              commentDrafts={commentDrafts}
              videoCategory={videoCategory}
              videoTitle={resolvedVideoTitle}
              onAction={handleAction}
              onClose={() => {
                setPanelMinimized(false)
                setOpen(false)
              }}
              onGenerateVideoNote={generateVideoNote}
              onSaveVideoNote={persistVideoNote}
              onChangeVideoNote={setVideoNote}
              onGetCurrentVideoTime={readCurrentVideoTime}
              onSeekVideoTime={seekVideoTime}
              pageClickOnly={pageClickOnly}
              onPageClickOnlyChange={setPageClickOnly}
              videoNote={videoNote}
              videoNoteLoading={videoNoteLoading}
              runningAction={runningAction}
              actionsLocked={actionsLocked}
              feedback={feedback}
            />
          )}
          {ledgerStatus && ledgerStatus.missingLedgerIds.length > 0 && !preferences.ledgerPromptDismissed ? (
            <div className="favorite-ledger-prompt" role="status">
              <p>Bilimi 专用册目尚未备齐，可请掌库先行备册。</p>
              <div className="favorite-ledger-prompt__actions">
                <button type="button" onClick={() => dismissLedgerPrompt(true)}>
                  请掌库
                </button>
                <button type="button" onClick={() => dismissLedgerPrompt(false)}>
                  稍后
                </button>
              </div>
            </div>
          ) : null}
          {ledgerPanelOpen ? (
            <FavoriteLedgerPanel
              ledgers={preferences.favoriteLedgers}
              missingLedgerIds={ledgerStatus?.missingLedgerIds ?? []}
              onEnsureLedgers={ensureFavoriteLedgers}
              onSaveLedgers={(favoriteLedgers) => {
                void persistPreferences({
                  ...preferences,
                  favoriteLedgers
                })
              }}
              onScanOldFavorites={scanOldFavorites}
              onExecuteOldFavoritePlan={executeOldFavoritePlan}
            />
          ) : null}
          {coinPromptOpen ? (
            <CoinPrompt
              onChoose={(coinCount) => {
                setCoinPromptOpen(false)
                void runAction('赐', { coinCount })
              }}
              onCancel={() => setCoinPromptOpen(false)}
            />
          ) : null}
          {commentChooserOpen ? (
            <CommentChooser
              drafts={commentDrafts}
              onSelect={(draft) => {
                setCommentChooserOpen(false)
                void runAction('表', { commentDraft: draft })
              }}
              onCancel={() => setCommentChooserOpen(false)}
            />
          ) : null}
        </>
      ) : showSeal ? (
        <SealButton
          onOpen={openFromSeal}
          onMouseDown={handleSealMouseDown}
          onMouseMove={handleSealMouseMove}
          onMouseUp={handleSealMouseUp}
          onPointerDown={handleSealPointerDown}
          onPointerMove={handleSealPointerMove}
          onPointerUp={handleSealPointerUp}
        />
      ) : null}
    </div>
  )
}
