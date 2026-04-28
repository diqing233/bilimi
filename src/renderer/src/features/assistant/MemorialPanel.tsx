import type { AssistantAction, RecommendationLabel, VideoNote } from '@shared/types'
import { useState } from 'react'
import { VideoNotesPanel } from '../notes/VideoNotesPanel'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  videoCategory?: string
  videoTitle: string
  onAction: (action: AssistantAction) => void
  onClose: () => void
  onGenerateVideoNote: (manualTranscript?: string) => Promise<VideoNote | null>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  videoNote: VideoNote | null
  videoNoteLoading: boolean
  runningAction?: AssistantAction | null
  feedback?: {
    tone: 'progress' | 'success' | 'error'
    message: string
    steps: string[]
    missingTargets: string[]
  } | null
}

export function MemorialPanel({
  recommendation,
  commentDrafts,
  videoCategory = '解闷小品',
  videoTitle,
  onAction,
  onClose,
  onGenerateVideoNote,
  onSaveVideoNote,
  videoNote,
  videoNoteLoading,
  runningAction = null,
  feedback = null
}: MemorialPanelProps) {
  const feedbackRole = feedback?.tone === 'error' ? 'alert' : 'status'
  const [activePanelTab, setActivePanelTab] = useState<'review' | 'notes'>('review')

  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
        <div className="memorial-panel__header">
          <span>今日所陈</span>
          <h2>御前待阅折</h2>
          <span>司礼监掌印官谨呈</span>
        </div>
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
            <div className="memorial-panel__actions">
              {(['赏', '藏', '赐', '表', '阅'] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={runningAction !== null}
                  aria-busy={runningAction === action}
                  onClick={() => void onAction(action)}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <VideoNotesPanel
            note={videoNote}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onSave={onSaveVideoNote}
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
              <small>已行：{feedback.steps.join('、')}</small>
            ) : null}
            {feedback.missingTargets.length > 0 ? (
              <small>未得：{feedback.missingTargets.join('、')}</small>
            ) : null}
          </div>
        ) : null}
        <button className="memorial-panel__close" type="button" onClick={onClose}>
          合折
        </button>
      </div>
    </section>
  )
}
