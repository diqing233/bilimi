import type {
  AssistantAction,
  AssistantPreferences,
  CommentSubmitMode,
  RecommendationLabel,
  NotePosterSummary,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import { useEffect, useState, type ComponentProps, type SyntheticEvent } from 'react'
import { VideoNotesPanel, type VideoNotesResultTab } from '../notes/VideoNotesPanel'
import clickedPetUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import hintPetUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import { AssistantActionButton } from './AssistantActionButton'

type MemorialPanelTab = 'review' | 'notes'

type VideoNoteTranscriptionOptions = {
  summarizeWithDeepSeek?: boolean
}

type VideoNotesPanelProps = ComponentProps<typeof VideoNotesPanel>

type MemorialPanelProps = {
  recommendation: RecommendationLabel
  commentDrafts: string[]
  deepSeekEnabled?: boolean
  deepSeekCommentEnabled?: boolean
  deepSeekAutoSummaryEnabled?: boolean
  deepSeekSummaryGenerating?: boolean
  defaultCoinCount?: 1 | 2
  commentSubmitMode?: CommentSubmitMode
  onPreferenceChange?: (patch: Partial<AssistantPreferences>) => void
  videoNotesResultTab?: VideoNotesResultTab | null
  onVideoNotesResultTabChange?: (tab: VideoNotesResultTab | null) => void
  onSeekCurrentVideoTime?: (seconds: number) => void | Promise<void>
  onSeekVideoNoteSource?: (source: VideoNote['source'], seconds: number) => void | Promise<void>
  onVideoNotesCopyFeedback?: VideoNotesPanelProps['onCopyFeedback']
  videoCategory?: string
  favoriteProvisioningHint?: string
  currentAccountMid?: string
  videoTitle: string
  videoAuthor?: string
  hasCurrentVideo?: boolean
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
  onCancelQueuedVideoSummary?: (id: string) => void
  onRetryQueuedVideoAudioTranscription?: (id: string) => void
  onRetryQueuedVideoAudioOnCpu?: (id: string) => void
  onRetryQueuedArchiveRegistration?: (id: string) => void
  onRetryQueuedVideoSummary?: (id: string) => void
  onBulkQueueAction?: VideoNotesPanelProps['onBulkQueueAction']
  onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
  onArchivePosterSummary?: (
    note: VideoNote,
    poster: NotePosterSummary
  ) => Promise<VideoNoteArchiveEntry[] | void>
  onSaveVideoNote: (note: VideoNote) => Promise<void>
  onChangeVideoNote?: (note: VideoNote) => void
  onOpenVideoNoteArchive?: () => void
  videoNote: VideoNote | null
  videoNoteArchivedSummaryText?: string
  videoNoteArchives?: VideoNoteArchiveEntry[]
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

const COIN_SETTING_TITLES: Record<1 | 2, string> = {
  1: '默认投 1 枚硬币（再点一次可补投 1 枚）',
  2: '默认投 2 枚硬币'
}

const COMMENT_SETTING_TITLES: Record<CommentSubmitMode, string> = {
  random: '随机生成一条并直接发送',
  choose: '生成 3 条候选，选择后发送（也可以复制后发评论）'
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

function stopActionEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

export function MemorialPanel({
  recommendation,
  commentDrafts,
  deepSeekEnabled = false,
  deepSeekCommentEnabled = deepSeekEnabled,
  deepSeekAutoSummaryEnabled = false,
  deepSeekSummaryGenerating = false,
  defaultCoinCount = 1,
  commentSubmitMode = 'choose',
  onPreferenceChange,
  videoNotesResultTab,
  onVideoNotesResultTabChange,
  onSeekCurrentVideoTime,
  onSeekVideoNoteSource,
  onVideoNotesCopyFeedback,
  videoCategory = '解闷小品',
  favoriteProvisioningHint,
  currentAccountMid,
  videoTitle,
  videoAuthor,
  hasCurrentVideo = true,
  onAction,
  onClose,
  onGenerateVideoNote,
  onTranscribeVideoAudio,
  onEnqueueVideoAudioTranscription,
  onCancelQueuedVideoAudioTranscription,
  onCancelQueuedVideoSummary,
  onRetryQueuedVideoAudioTranscription,
  onRetryQueuedVideoAudioOnCpu,
  onRetryQueuedArchiveRegistration,
  onRetryQueuedVideoSummary,
  onBulkQueueAction,
  onGeneratePoster,
  onArchivePosterSummary,
  onSaveVideoNote,
  onChangeVideoNote,
  onOpenVideoNoteArchive,
  videoNote,
  videoNoteArchivedSummaryText = '',
  videoNoteArchives = [],
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
  const authorLabel = videoAuthor?.trim() || '待识别'
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
              {hasCurrentVideo ? (
                <>
                  <p>UP 主：{authorLabel}</p>
                  <p>小咪准备归类到：{videoCategory}</p>
                  {favoriteProvisioningHint ? <p className="memorial-panel__favorite-provisioning-hint">{favoriteProvisioningHint}</p> : null}
                </>
              ) : (
                <>
                  <p>UP 主会显示在这里</p>
                  <p>小咪会在这里展示视频的预归类位置</p>
                </>
              )}
              {recommendation.hint ? (
                <p className="memorial-panel__recommendation-summary">{recommendation.hint}</p>
              ) : null}
            </aside>
            <div className="memorial-panel__actions" role="group" aria-label="批阅动作">
              {ACTIONS.map(({ action, testId, label, description, icon, iconAlt }) => {
                const quickSetting =
                  action === '赐' ? (
                    <label
                      className="memorial-panel__action-setting"
                      onClick={stopActionEvent}
                      onPointerDown={stopActionEvent}
                      onKeyDown={stopActionEvent}
                    >
                      <select
                        aria-label="投币厚赏参数"
                        title={COIN_SETTING_TITLES[defaultCoinCount]}
                        value={defaultCoinCount}
                        onChange={(event) => {
                          event.stopPropagation()
                          onPreferenceChange?.({
                            defaultCoinCount: Number(event.currentTarget.value) as 1 | 2
                          })
                        }}
                      >
                        <option value={1}>一枚</option>
                        <option value={2}>两枚</option>
                      </select>
                    </label>
                  ) : action === '表' ? (
                    <label
                      className="memorial-panel__action-setting"
                      onClick={stopActionEvent}
                      onPointerDown={stopActionEvent}
                      onKeyDown={stopActionEvent}
                    >
                      <select
                        aria-label="拟奏短评参数"
                        title={COMMENT_SETTING_TITLES[commentSubmitMode]}
                        value={commentSubmitMode}
                        onChange={(event) => {
                          event.stopPropagation()
                          onPreferenceChange?.({
                            commentSubmitMode: event.currentTarget.value as CommentSubmitMode
                          })
                        }}
                      >
                        <option value="random">随机</option>
                        <option value="choose">选择</option>
                      </select>
                    </label>
                  ) : null

                return (
                  <div
                    key={action}
                    className={[
                      'memorial-panel__action-card',
                      quickSetting ? 'memorial-panel__action-card--with-setting' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <AssistantActionButton
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
                    />
                    {quickSetting}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <VideoNotesPanel
            note={videoNote}
            accountMid={currentAccountMid}
            currentVideoTitle={videoTitle}
            currentVideoAuthor={videoAuthor}
            isLoading={videoNoteLoading}
            onGenerate={onGenerateVideoNote}
            onTranscribeAudio={onTranscribeVideoAudio}
            onEnqueueTranscription={onEnqueueVideoAudioTranscription}
            onCancelQueuedVideoAudioTranscription={onCancelQueuedVideoAudioTranscription}
            onCancelQueuedVideoSummary={onCancelQueuedVideoSummary}
            onRetryQueuedVideoAudioTranscription={onRetryQueuedVideoAudioTranscription}
            onRetryQueuedVideoAudioOnCpu={onRetryQueuedVideoAudioOnCpu}
            onRetryQueuedArchiveRegistration={onRetryQueuedArchiveRegistration}
            onRetryQueuedVideoSummary={onRetryQueuedVideoSummary}
            onBulkQueueAction={onBulkQueueAction}
            onGeneratePoster={onGeneratePoster}
            onArchivePosterSummary={onArchivePosterSummary}
            onSave={onSaveVideoNote}
            onChange={onChangeVideoNote}
            onOpenArchive={onOpenVideoNoteArchive}
            archivedSummaryText={videoNoteArchivedSummaryText}
            archivedNotes={videoNoteArchives}
            deepSeekEnabled={deepSeekEnabled}
            deepSeekAutoSummaryEnabled={deepSeekAutoSummaryEnabled}
            deepSeekSummaryGenerating={deepSeekSummaryGenerating}
            transcriptionQueue={transcriptionQueue}
            activeResultTab={videoNotesResultTab}
            onActiveResultTabChange={onVideoNotesResultTabChange}
            onSeekCurrentVideoTime={onSeekCurrentVideoTime}
            onSeekSource={onSeekVideoNoteSource}
            onCopyFeedback={onVideoNotesCopyFeedback}
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
              <details className="memorial-panel__log">
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
