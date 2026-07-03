import type {
  AssistantAction,
  RecommendationLabel,
  NotePosterSummary,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote
} from '@shared/types'
import { useEffect, useState } from 'react'
import { VideoNotesPanel } from '../notes/VideoNotesPanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import { AssistantActionButton } from './AssistantActionButton'

type MemorialPanelTab = 'review' | 'notes'

type VideoNoteTranscriptionOptions = {
  summarizeWithDeepSeek?: boolean
}

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  deepSeekEnabled?: boolean
  deepSeekCommentEnabled?: boolean
  deepSeekAutoSummaryEnabled?: boolean
  videoCategory?: string
  videoTitle: string
  videoAuthor?: string
  onAction: (action: AssistantAction) => void
  onClose: () => void
  onGenerateVideoNote: () => Promise<VideoNote | null>
  onTranscribeVideoAudio?: (
    options?: VideoNoteTranscriptionOptions
  ) => Promise<VideoNote | null>
  onEnqueueVideoAudioTranscription?: (
    options?: VideoNoteTranscriptionOptions
  ) => Promise<VideoAudioTranscriptionQueueSnapshot | null>
  onCancelQueuedVideoAudioTranscription?: (id: string) => void
  onRetryQueuedVideoAudioTranscription?: (id: string) => void
  onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
  onArchivePosterSummary?: (note: VideoNote, poster: NotePosterSummary) => Promise<void>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  onChangeVideoNote?: (note: VideoNote) => void
  onOpenVideoNoteArchive?: () => void
  videoNote: VideoNote | null
  videoNoteArchivedSummaryText?: string
  videoNoteLoading: boolean
  transcriptionProgress?: VideoAudioTranscriptionProgress | null
  transcriptionQueue?: VideoAudioTranscriptionQueueSnapshot
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
  testId: string
  label: string
  description: string
  icon: string
  iconAlt: string
}> = [
  {
    action: '赏',
    label: '轻赏此条',
    description: '一键点赞，并归类收藏到 bilimi',
    testId: 'review-action-like',
    icon: clickedPetUrl,
    iconAlt: '小咪轻赏'
  },
  {
    action: '藏',
    label: '归入内库',
    description: '一键归类收藏，不点赞不投币',
    testId: 'review-action-favorite',
    icon: idlePetUrl,
    iconAlt: '小咪归库'
  },
  {
    action: '赐',
    label: '投币厚赏',
    description: '一键三连，投币数量可在设置中调整',
    testId: 'review-action-coin',
    icon: workingPetUrl,
    iconAlt: '小咪厚赏'
  },
  {
    action: '表',
    label: '拟奏短评',
    description: '一键弹幕，发送方式可在设置中调整',
    testId: 'review-action-comment',
    icon: hintPetUrl,
    iconAlt: '小咪短评'
  }
]

const MISSING_TARGET_LABELS: Record<string, string> = {
  like: '点赞按钮',
  favorite: '收藏按钮',
  'favorite-open': '收藏入口',
  'favorite:open': '收藏入口',
  'favorite-folder': '目标收藏夹',
  'favorite:folder': '目标收藏夹',
  'favorite-create-button': '新建收藏夹按钮',
  'favorite-api-required': '收藏分组确认',
  coin: '投币按钮',
  'coin-open': '投币入口',
  'coin:open': '投币入口',
  'coin-confirm': '投币确认按钮',
  'coin:confirm': '投币确认按钮',
  comment: '评论框',
  'comment-box': '评论框',
  'comment-submit': '评论发送按钮',
  'current-video': '当前视频',
  webview: '浏览窗口',
  'bilibili-login': 'Bilibili 登录状态'
}

function localizeMissingTarget(target: string) {
  return MISSING_TARGET_LABELS[target] ?? target
}

function localizeFeedbackMessage(message: string) {
  return Object.entries(MISSING_TARGET_LABELS).reduce(
    (localized, [target, label]) => localized.replaceAll(target, label),
    message
  )
}

export function MemorialPanel({
  recommendation,
  commentDrafts,
  deepSeekEnabled = false,
  deepSeekCommentEnabled = deepSeekEnabled,
  deepSeekAutoSummaryEnabled = false,
  videoCategory = '解闷小品',
  videoTitle,
  videoAuthor,
  onAction,
  onClose,
  onGenerateVideoNote,
  onTranscribeVideoAudio,
  onEnqueueVideoAudioTranscription,
  onCancelQueuedVideoAudioTranscription,
  onRetryQueuedVideoAudioTranscription,
  onGeneratePoster,
  onArchivePosterSummary,
  onSaveVideoNote,
  onChangeVideoNote,
  onOpenVideoNoteArchive,
  videoNote,
  videoNoteArchivedSummaryText = '',
  videoNoteLoading,
  transcriptionProgress,
  transcriptionQueue,
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
              {recommendation.hint ? (
                <p className="memorial-panel__recommendation-summary">{recommendation.hint}</p>
              ) : null}
              <p className="memorial-panel__deepseek-status">
                {deepSeekEnabled && deepSeekCommentEnabled
                  ? 'DeepSeek 已开启，表会生成三条有趣视频评论。'
                  : 'DeepSeek 未开启，表会推荐三条默认评论。'}
              </p>
            </aside>
            <div className="memorial-panel__actions" role="group" aria-label="批阅动作">
              {ACTIONS.map(({ action, testId, label, description, icon, iconAlt }) => (
                <AssistantActionButton
                  key={action}
                  type="button"
                  data-testid={testId}
                  disabled={actionsLocked}
                  aria-label={`${action} ${label} ${description}`}
                  aria-busy={runningAction === action}
                  onClick={() => void onAction(action)}
                  icon={icon}
                  iconAlt={iconAlt}
                  badge={action}
                  label={label}
                  description={description}
                >
                </AssistantActionButton>
              ))}
            </div>
          </div>
        ) : (
          <VideoNotesPanel
            note={videoNote}
            currentVideoTitle={videoTitle}
            currentVideoAuthor={videoAuthor}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onTranscribeAudio={onTranscribeVideoAudio}
            onEnqueueTranscription={onEnqueueVideoAudioTranscription}
            onGeneratePoster={onGeneratePoster}
            onArchivePosterSummary={onArchivePosterSummary}
            onSave={onSaveVideoNote}
            onChange={onChangeVideoNote}
            onOpenArchive={onOpenVideoNoteArchive}
            archivedSummaryText={videoNoteArchivedSummaryText}
            deepSeekEnabled={deepSeekEnabled}
            deepSeekAutoSummaryEnabled={deepSeekAutoSummaryEnabled}
            transcriptionProgress={transcriptionProgress}
            transcriptionQueue={transcriptionQueue}
          />
        )}
        {feedback ? (
          <div
            className={`memorial-panel__feedback memorial-panel__feedback--${feedback.tone}`}
            role={feedbackRole}
            aria-live="polite"
          >
            <p>{localizeFeedbackMessage(feedback.message)}</p>
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
              <small>未得：{feedback.missingTargets.map(localizeMissingTarget).join('、')}</small>
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
