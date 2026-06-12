import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  RecommendationKind,
  VideoNote
} from '@shared/types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composeMemorialComments } from '../comments/commentComposer'
import { classifyVideoContent } from '../recommendation/videoClassifier'
import { describeRecommendation } from '../recommendation/recommendationRules'
import {
  createInitialAssistantPreferences,
  recordAssistantPreferenceFeedback
} from '../state/assistantState'
import { CoinPrompt } from './CoinPrompt'
import { CommentChooser } from './CommentChooser'
import { FavoriteLedgerPanel } from './FavoriteLedgerPanel'
import { MemorialPanel } from './MemorialPanel'
import type { AssistantSnapshot } from './assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'

const CURRENT_TITLE = '早八生存实录'
const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i
const VIDEO_CATEGORY_LABELS: Record<RecommendationKind, string> = {
  funny: '解闷小品',
  humor: '解闷小品',
  knowledge: '见闻增广',
  story: '剧情留档',
  suspicious: '谨慎观察'
}

type ActionFeedback = {
  tone: 'progress' | 'success' | 'error'
  message: string
  steps: string[]
  missingTargets: string[]
}

function createFallbackSnapshot(): AssistantSnapshot {
  const preferences = createInitialAssistantPreferences()

  return {
    preferences,
    favoriteLedgerStatus: null,
    videoContentContext: { title: CURRENT_TITLE },
    videoTitle: CURRENT_TITLE
  }
}

function stripBilimiPrefix(displayName: string) {
  return displayName.replace(/^Bilimi[·\s-]*/, '').trim()
}

function normalizeTitle(title: string) {
  return title.replace(BILIBILI_TITLE_SUFFIX, '').trim() || CURRENT_TITLE
}

function createDefaultResult(message: string): AssistantAutomationResult {
  return {
    ok: true,
    steps: [],
    missingTargets: [],
    message
  }
}

export function FloatingAssistantApp() {
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null)
  const [preferences, setPreferences] = useState<AssistantPreferences>(() =>
    createInitialAssistantPreferences()
  )
  const [favoriteLedgerStatus, setFavoriteLedgerStatus] = useState<FavoriteLedgerStatus | null>(null)
  const [activeTab, setActiveTab] = useState<'review' | 'notes' | 'ledger'>('review')
  const [coinPromptOpen, setCoinPromptOpen] = useState(false)
  const [commentChooserOpen, setCommentChooserOpen] = useState(false)
  const [runningAction, setRunningAction] = useState<AssistantAction | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [pageClickOnly, setPageClickOnly] = useState(true)
  const [videoNote, setVideoNote] = useState<VideoNote | null>(null)
  const [videoNoteLoading, setVideoNoteLoading] = useState(false)
  const mounted = useRef(false)

  const loadSnapshot = useCallback(async ({ resetVideoNote = false } = {}) => {
    try {
      const nextSnapshot =
        (await window.bilimiDesktop?.requestAssistantSnapshot?.()) ?? createFallbackSnapshot()

      if (!mounted.current) {
        return
      }

      setSnapshot(nextSnapshot)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)

      if (resetVideoNote) {
        setVideoNote(null)
      }
    } catch (error) {
      if (!mounted.current) {
        return
      }

      const fallback = createFallbackSnapshot()
      setSnapshot(fallback)
      setPreferences(fallback.preferences)
      setFavoriteLedgerStatus(fallback.favoriteLedgerStatus)
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '读取当前视频时遇到未知差错。',
        steps: [],
        missingTargets: []
      })
    }
  }, [])

  useEffect(() => {
    mounted.current = true

    void loadSnapshot()

    return () => {
      mounted.current = false
    }
  }, [loadSnapshot])

  useEffect(() => {
    return window.bilimiDesktop?.onAssistantSnapshotChanged?.(() => {
      void loadSnapshot({ resetVideoNote: true })
    })
  }, [loadSnapshot])

  const resolvedSnapshot = snapshot ?? createFallbackSnapshot()
  const resolvedVideoTitle = normalizeTitle(resolvedSnapshot.videoTitle)
  const currentClassification = useMemo(
    () => classifyVideoContent(resolvedSnapshot.videoContentContext, preferences.favoriteLedgers),
    [preferences.favoriteLedgers, resolvedSnapshot.videoContentContext]
  )
  const currentKind = currentClassification.ledgerId
  const recommendation = useMemo(() => describeRecommendation(currentKind), [currentKind])
  const commentDrafts = useMemo(
    () => composeMemorialComments(currentKind, resolvedVideoTitle),
    [currentKind, resolvedVideoTitle]
  )
  const videoCategory =
    VIDEO_CATEGORY_LABELS[currentKind] || stripBilimiPrefix(currentClassification.displayName) || currentKind
  const actionsLocked = runningAction !== null || coinPromptOpen || commentChooserOpen

  async function persistPreferences(nextPreferences: AssistantPreferences) {
    setPreferences(nextPreferences)

    if (window.bilimiDesktop?.savePreferences) {
      const saved = await window.bilimiDesktop.savePreferences(nextPreferences)
      setPreferences(createInitialAssistantPreferences(saved))
    }
  }

  async function persistFeedback(action: AssistantAction, kind: RecommendationKind) {
    const nextPreferences = recordAssistantPreferenceFeedback(preferences, kind, action)
    await persistPreferences(nextPreferences)
  }

  async function runAction(action: AssistantAction, options?: { coinCount?: 1 | 2; commentDraft?: string }) {
    if (runningAction) {
      return
    }

    setRunningAction(action)
    setFeedback({
      tone: 'progress',
      message: action === '阅' ? '正在登记已阅。' : '正在代批，请稍候。',
      steps: [],
      missingTargets: []
    })

    try {
      const result =
        (await window.bilimiDesktop?.runAssistantAction?.(action, {
          ...options,
          pageClickOnly
        })) ?? createDefaultResult('此折已阅。')

      if (result.ok && action !== '阅') {
        await persistFeedback(action, currentKind)
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

  async function generateVideoNote(manualTranscript?: string) {
    setVideoNoteLoading(true)

    try {
      const note = (await window.bilimiDesktop?.generateVideoNote?.(manualTranscript)) ?? null
      setVideoNote(note)
      return note
    } finally {
      setVideoNoteLoading(false)
    }
  }

  async function saveVideoNote(note: VideoNote) {
    await window.bilimiDesktop?.saveVideoNote?.(note)
  }

  async function getCurrentVideoTime() {
    if (!window.bilimiDesktop?.getCurrentVideoTime) {
      throw new Error('当前页面暂不能读取视频时间。')
    }

    return window.bilimiDesktop.getCurrentVideoTime()
  }

  async function seekVideoTime(seconds: number) {
    if (!window.bilimiDesktop?.seekVideoTime) {
      throw new Error('当前页面暂不能跳转视频时间。')
    }

    return window.bilimiDesktop.seekVideoTime(seconds)
  }

  async function ensureFavoriteLedgers() {
    const result =
      (await window.bilimiDesktop?.ensureFavoriteLedgers?.()) ?? createDefaultResult('册目已备齐。')
    const nextSnapshot = await window.bilimiDesktop?.requestAssistantSnapshot?.()

    if (nextSnapshot) {
      setFavoriteLedgerStatus(nextSnapshot.favoriteLedgerStatus)
      setPreferences(createInitialAssistantPreferences(nextSnapshot.preferences))
    }

    return result
  }

  async function scanOldFavorites(): Promise<FavoriteLedgerPreview> {
    return (
      (await window.bilimiDesktop?.scanOldFavorites?.()) ?? {
        items: [],
        skippedSourceFolderTitles: []
      }
    )
  }

  async function executeOldFavoritePlan(
    items: FavoriteLedgerPreviewItem[]
  ): Promise<AssistantAutomationResult> {
    return (
      (await window.bilimiDesktop?.executeOldFavoritePlan?.(items)) ??
      createDefaultResult('旧藏已归册。')
    )
  }

  function closeAssistant() {
    window.bilimiDesktop?.closeFloatingAssistant?.()
  }

  return (
    <main className="floating-assistant-shell" aria-label="Bilimi 悬浮助手">
      <section className="floating-assistant-workspace">
        <div className="floating-assistant-tabs" role="tablist" aria-label="助手功能">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'review'}
            onClick={() => setActiveTab('review')}
          >
            批阅
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
          >
            札记
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ledger'}
            onClick={() => setActiveTab('ledger')}
          >
            掌库
          </button>
        </div>

        {activeTab === 'ledger' ? (
          <FavoriteLedgerPanel
            ledgers={preferences.favoriteLedgers}
            missingLedgerIds={favoriteLedgerStatus?.missingLedgerIds ?? []}
            onClose={() => setActiveTab('review')}
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
        ) : (
          <MemorialPanel
            recommendation={recommendation}
            commentDrafts={commentDrafts}
            videoCategory={videoCategory}
            videoTitle={resolvedVideoTitle}
            onAction={handleAction}
            onClose={closeAssistant}
            onGenerateVideoNote={generateVideoNote}
            onSaveVideoNote={saveVideoNote}
            onChangeVideoNote={setVideoNote}
            onGetCurrentVideoTime={getCurrentVideoTime}
            onSeekVideoTime={seekVideoTime}
            pageClickOnly={pageClickOnly}
            onPageClickOnlyChange={setPageClickOnly}
            videoNote={videoNote}
            videoNoteLoading={videoNoteLoading}
            runningAction={runningAction}
            actionsLocked={actionsLocked}
            feedback={feedback}
            onOpenLedgerPanel={() => setActiveTab('ledger')}
            initialTab={activeTab === 'notes' ? 'notes' : 'review'}
            showTabs={false}
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
            onSelect={(commentDraft) => {
              setCommentChooserOpen(false)
              void runAction('表', { commentDraft })
            }}
            onCancel={() => setCommentChooserOpen(false)}
          />
        ) : null}
      </section>
    </main>
  )
}
