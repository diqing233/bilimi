import type {
  AssistantAction,
  RecommendationLabel,
  VideoAudioTranscriptionProgress,
  VideoNote
} from '@shared/types'
import { useEffect, useState } from 'react'
import { VideoNotesPanel } from '../notes/VideoNotesPanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'

type MemorialPanelTab = 'review' | 'notes'

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  videoCategory?: string
  videoTitle: string
  onAction: (action: AssistantAction) => void
  onClose: () => void
  onGenerateVideoNote: () => Promise<VideoNote | null>
  onTranscribeVideoAudio?: () => Promise<VideoNote | null>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  onChangeVideoNote?: (note: VideoNote) => void
  onGetCurrentVideoTime?: () => Promise<number>
  onSeekVideoTime?: (seconds: number) => Promise<boolean>
  onOpenVideoNoteArchive?: () => void
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
  showCloseButton?: boolean
}

const ACTIONS: Array<{
  action: AssistantAction
  label: string
  description: string
  icon: string
  iconAlt: string
}> = [
  {
    action: '赏',
    label: '轻赏此条',
    description: '点赞并归入当前 Bilimi 分册',
    icon: clickedPetUrl,
    iconAlt: '小mi轻赏'
  },
  {
    action: '藏',
    label: '归入内库',
    description: '只收藏到 Bilimi 分册',
    icon: idlePetUrl,
    iconAlt: '小mi归库'
  },
  {
    action: '赐',
    label: '投币厚赏',
    description: '点赞、收藏，并先询问投币数量',
    icon: workingPetUrl,
    iconAlt: '小mi厚赏'
  },
  {
    action: '表',
    label: '拟奏短评',
    description: '从三条候选评论中择一发送',
    icon: hintPetUrl,
    iconAlt: '小mi短评'
  }
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
  onOpenVideoNoteArchive,
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
  closeLabel = '合折',
  showCloseButton = true
}: MemorialPanelProps) {
  const feedbackRole = feedback?.tone === 'error' ? 'alert' : 'status'
  const [activePanelTab, setActivePanelTab] = useState<MemorialPanelTab>(initialTab)

  useEffect(() => {
    setActivePanelTab(initialTab)
  }, [initialTab])

  return (
    <section className="memorial-panel" aria-label="案头奏折">
      <div className="memorial-panel__paper">
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
            <div className="memorial-panel__actions" role="group" aria-label="批阅动作">
              {ACTIONS.map(({ action, label, description, icon, iconAlt }) => (
                <button
                  key={action}
                  type="button"
                  className="memorial-panel__action"
                  disabled={actionsLocked}
                  aria-label={`${action} ${label} ${description}`}
                  aria-busy={runningAction === action}
                  onClick={() => void onAction(action)}
                >
                  <span className="memorial-panel__action-icon">
                    <img className="memorial-panel__action-pet" src={icon} alt={iconAlt} />
                    <strong>{action}</strong>
                  </span>
                  <span className="memorial-panel__action-label">{label}</span>
                  <small className="memorial-panel__action-description">{description}</small>
                </button>
              ))}
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
            currentVideoTitle={videoTitle}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onTranscribeAudio={onTranscribeVideoAudio}
            onSave={onSaveVideoNote}
            onChange={onChangeVideoNote}
            onGetCurrentTime={onGetCurrentVideoTime}
            onSeekToTime={onSeekVideoTime}
            onOpenArchive={onOpenVideoNoteArchive}
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
        {showCloseButton ? (
          <button className="memorial-panel__close" type="button" onClick={onClose}>
            {closeLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}
