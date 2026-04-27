import type {
  AssistantAction,
  AssistantPreferences,
  RecommendationKind,
  VisualAutomationFallback
} from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { executeAssistantAction } from '../actions/actionExecutor'
import { composeMemorialComments } from '../comments/commentComposer'
import { describeRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CoinPrompt } from './CoinPrompt'
import { CommentChooser } from './CommentChooser'
import { MemorialPanel } from './MemorialPanel'
import { SealButton } from './SealButton'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'

const CURRENT_TITLE = '早八生存实录'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const VIDEO_CATEGORY_LABELS: Record<RecommendationKind, string> = {
  funny: '解闷小品',
  knowledge: '见闻增广',
  story: '剧情留档',
  suspicious: '谨慎观察'
}

type AssistantOverlayProps = {
  favoritesFolderName?: string
  readVideoContentContext?: () => Promise<VideoContentContext | null | undefined>
  videoContentContext?: VideoContentContext
  videoTitle?: string
  runVisualFallback?: VisualAutomationFallback
  runScript?: (script: string) => Promise<{
    ok: boolean
    steps: string[]
    missingTargets: string[]
    message: string
  }>
  onRecordFeedback?: (kind: RecommendationKind, action: AssistantAction) => void
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

export function AssistantOverlay({
  favoritesFolderName,
  readVideoContentContext,
  videoContentContext,
  videoTitle = CURRENT_TITLE,
  runVisualFallback,
  runScript = async () => DEFAULT_RUN_RESULT,
  onRecordFeedback,
  storedPreferences
}: AssistantOverlayProps) {
  const [open, setOpen] = useState(false)
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [panelMinimized, setPanelMinimized] = useState(false)
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [latestVideoContentContext, setLatestVideoContentContext] = useState<
    VideoContentContext | undefined
  >(videoContentContext)
  const [preferences, setPreferences] = useState(() => createInitialAssistantPreferences(storedPreferences))
  const resolvedFavoritesFolderName = favoritesFolderName ?? preferences.favoritesFolderName
  const resolvedVideoTitle = videoTitle.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
  const resolvedVideoContentContext = useMemo<VideoContentContext>(
    () => latestVideoContentContext ?? videoContentContext ?? { title: resolvedVideoTitle },
    [latestVideoContentContext, resolvedVideoTitle, videoContentContext]
  )
  const currentKind = useMemo(
    () => classifyVideoContent(resolvedVideoContentContext),
    [resolvedVideoContentContext]
  )
  const recommendation = useMemo(() => describeRecommendation(currentKind), [currentKind])
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle),
    [currentKind, resolvedVideoTitle]
  )

  useEffect(() => {
    if (storedPreferences) {
      setPreferences(createInitialAssistantPreferences(storedPreferences))
    }
  }, [storedPreferences])

  useEffect(() => {
    setLatestVideoContentContext(videoContentContext)
  }, [videoContentContext])

  async function readRecommendationKindFromPage() {
    try {
      const nextContext = await readVideoContentContext?.()

      if (nextContext) {
        setLatestVideoContentContext(nextContext)
        return classifyVideoContent(nextContext)
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

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
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
        coinCount: options?.coinCount,
        commentDraft: options?.commentDraft,
        recommendationKind: actionRecommendationKind
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
    if (runningAction) {
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

  return (
    <div className={`assistant-overlay${panelMinimized ? ' assistant-overlay--minimized' : ''}`}>
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
              videoCategory={VIDEO_CATEGORY_LABELS[currentKind]}
              videoTitle={resolvedVideoTitle}
              onAction={handleAction}
              onClose={() => {
                setPanelMinimized(false)
                setOpen(false)
              }}
              runningAction={runningAction}
              feedback={feedback}
            />
          )}
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
      ) : (
        <SealButton onOpen={() => setOpen(true)} />
      )}
    </div>
  )
}
