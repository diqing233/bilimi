import type {
  AssistantAction,
  RecommendationLabel,
  VideoAudioTranscriptionProgress,
  VideoNote
} from '@shared/types'
import { useEffect, useState } from 'react'
import { VideoNotesPanel } from '../notes/VideoNotesPanel'

type MemorialPanelTab = 'review' | 'notes'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  videoCategory?: string
  videoTitle: string
  onAction: (action: AssistantAction) => void
  onClose: () => void
  onGenerateVideoNote: (manualTranscript?: string) => Promise<VideoNote | null>
  onTranscribeVideoAudio?: () => Promise<VideoNote | null>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  onChangeVideoNote?: (note: VideoNote) => void
  onGetCurrentVideoTime?: () => Promise<number>
  onSeekVideoTime?: (seconds: number) => Promise<boolean>
  onOpenLedgerPanel?: () => void
  pageClickOnly: boolean
  onPageClickOnlyChange: (pageClickOnly: boolean) => void
  videoNote: VideoNote | null
  videoNoteLoading: boolean
  transcriptionProgress?: VideoAudioTranscriptionProgress | null
  runningAction?: AssistantAction | null
  actionsLocked?: boolean
  feedback?: {
    tone: 'progress' | 'success' | 'error'
    message: string
    steps: string[]
    missingTargets: string[]
  } | null
  initialTab?: MemorialPanelTab
  showTabs?: boolean
  closeLabel?: string
}

const ACTIONS: Array<{
  action: AssistantAction
  label: string
  description: string
}> = [
  { action: '赏', label: '轻赏此条', description: '点赞并归入当前 Bilimi 分册' },
  { action: '藏', label: '归入内库', description: '只收藏到 Bilimi 分册' },
  { action: '赐', label: '投币厚赏', description: '点赞、收藏，并先询问投币数量' },
  { action: '表', label: '拟奏短评', description: '从三条候选评论中择一发送' },
  { action: '阅', label: '本条已阅', description: '不改动页面，只登记本次批阅' }
]

export function MemorialPanel({
  recommendation,
  commentDrafts,
  videoCategory = '解闷小品',
  videoTitle,
  onAction,
  onClose,
  onGenerateVideoNote,
  onTranscribeVideoAudio,
  onSaveVideoNote,
  onChangeVideoNote,
  onGetCurrentVideoTime,
  onSeekVideoTime,
  onOpenLedgerPanel,
  pageClickOnly,
  onPageClickOnlyChange,
  videoNote,
  videoNoteLoading,
  transcriptionProgress,
  runningAction = null,
  actionsLocked = runningAction !== null,
  feedback = null,
  initialTab = 'review',
  showTabs = true,
  closeLabel = '合折'
}: MemorialPanelProps) {
  const feedbackRole = feedback?.tone === 'error' ? 'alert' : 'status'
  const [activePanelTab, setActivePanelTab] = useState<MemorialPanelTab>(initialTab)

  useEffect(() => {
    setActivePanelTab(initialTab)
  }, [initialTab])

  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
        <div className="memorial-panel__header">
          <span>今日所陈</span>
          <h2>御前待阅折</h2>
          <span>司礼监掌印官谨呈</span>
        </div>
        {showTabs ? (
          <div className="memorial-panel__tabs" role="tablist" aria-label="奏折页签">
            <button
              type="button"
              role="tab"
              aria-selected={activePanelTab === 'review'}
              onClick={() => setActivePanelTab('review')}
            >
              批阅
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanelTab === 'notes'}
              onClick={() => setActivePanelTab('notes')}
            >
              札记
            </button>
          </div>
        ) : null}
        {activePanelTab === 'review' ? (
          <div className="memorial-panel__body">
            <aside className="memorial-panel__meta">
              <p title={videoTitle}>{videoTitle}</p>
              <p>{videoCategory}</p>
              <p>签语：{recommendation.badge}</p>
            </aside>
            <div className="memorial-panel__copy">
              <p>{recommendation.summary}</p>
              <p>臣谨以此条进呈陛下，若准其留档，臣便代行轻赏。</p>
              <p>若欲代拟奏表，臣已备下 {commentDrafts.length} 条奏折腔批语，静候钦点。</p>
            </div>
            <aside className="memorial-panel__verdict">
              <h3>朱批</h3>
              <p>此物可先过目，不必骤然重赐。</p>
            </aside>
            <div className="memorial-panel__actions" aria-label="批阅动作">
              {ACTIONS.map(({ action, label, description }) => (
                <button
                  key={action}
                  type="button"
                  className="memorial-panel__action"
                  disabled={actionsLocked}
                  aria-busy={runningAction === action}
                  onClick={() => void onAction(action)}
                >
                  <strong>{action}</strong>
                  <span>{label}</span>
                  <small>{description}</small>
                </button>
              ))}
              <button
                type="button"
                className="memorial-panel__action memorial-panel__action--ledger"
                disabled={actionsLocked}
                onClick={onOpenLedgerPanel}
              >
                <strong>库</strong>
                <span>打开掌库</span>
                <small>管理分册、补齐收藏夹、整理旧藏</small>
              </button>
            </div>
            <label className="memorial-panel__toggle">
              <input
                type="checkbox"
                role="switch"
                checked={pageClickOnly}
                disabled={actionsLocked}
                onChange={(event) => onPageClickOnlyChange(event.currentTarget.checked)}
              />
              <span>仅页面点击</span>
            </label>
          </div>
        ) : (
          <VideoNotesPanel
            note={videoNote}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onTranscribeAudio={onTranscribeVideoAudio}
            onSave={onSaveVideoNote}
            onChange={onChangeVideoNote}
            onGetCurrentTime={onGetCurrentVideoTime}
            onSeekToTime={onSeekVideoTime}
            transcriptionProgress={transcriptionProgress}
          />
        )}
        {feedback ? (
          <div
            className={`memorial-panel__feedback memorial-panel__feedback--${feedback.tone}`}
            role={feedbackRole}
            aria-live="polite"
          >
            <p>{feedback.message}</p>
            {feedback.steps.length > 0 ? (
              <details open className="memorial-panel__log">
                <summary>执行日志</summary>
                <ol>
                  {feedback.steps.map((step, index) => (
                    <li key={`${step}-${index}`}>{step}</li>
                  ))}
                </ol>
              </details>
            ) : null}
            {feedback.missingTargets.length > 0 ? (
              <small>未得：{feedback.missingTargets.join('、')}</small>
            ) : null}
          </div>
        ) : null}
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </section>
  )
}
