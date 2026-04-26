import type { AssistantAction, AssistantPreferences, RecommendationKind } from '@shared/types'
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

const CURRENT_KIND = 'funny' as const
const CURRENT_TITLE = '早八生存实录'

type AssistantOverlayProps = {
  favoritesFolderName?: string
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
  runScript = async () => DEFAULT_RUN_RESULT,
  onRecordFeedback,
  storedPreferences
}: AssistantOverlayProps) {
  const [open, setOpen] = useState(false)
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [preferences, setPreferences] = useState(() => createInitialAssistantPreferences(storedPreferences))
  const recommendation = useMemo(() => describeRecommendation(CURRENT_KIND), [])
  const commentDrafts = useMemo(() => composeMemorialComments(CURRENT_KIND, CURRENT_TITLE), [])
  const resolvedFavoritesFolderName = favoritesFolderName ?? preferences.favoritesFolderName

  useEffect(() => {
    if (storedPreferences) {
      setPreferences(createInitialAssistantPreferences(storedPreferences))
    }
  }, [storedPreferences])

  async function persistFeedback(action: AssistantAction) {
    const baselinePreferences = window.bilimiDesktop?.loadPreferences
      ? createInitialAssistantPreferences(await window.bilimiDesktop.loadPreferences())
      : preferences
    const nextPreferences = recordAssistantPreferenceFeedback(
      baselinePreferences,
      CURRENT_KIND,
      action
    )
    setPreferences(nextPreferences)
    onRecordFeedback?.(CURRENT_KIND, action)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
    setRunningAction(action)
    setFeedback({
      tone: 'progress',
      message: action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。',
      steps: [],
      missingTargets: []
    })

    try {
      const result = await executeAssistantAction({
        action,
        favoritesFolderName: resolvedFavoritesFolderName,
        runScript,
        coinCount: options?.coinCount,
        commentDraft: options?.commentDraft,
        recommendationKind: CURRENT_KIND
      })

      if (result.ok && action !== '阅') {
        await persistFeedback(action)
      }

      setFeedback({
        tone: result.ok ? 'success' : 'error',
        message: result.message,
        steps: result.steps,
        missingTargets: result.missingTargets
      })
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '代批时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
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
    <div className="assistant-overlay">
      {open ? (
        <>
          <MemorialPanel
            recommendation={recommendation}
            commentDrafts={commentDrafts}
            onAction={handleAction}
            onClose={() => setOpen(false)}
            runningAction={runningAction}
            feedback={feedback}
          />
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
