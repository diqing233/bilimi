import { useMemo, useState } from 'react'
import type {
  NotePosterSummary,
  TranscriptSegment,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueItem,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote
} from '@shared/types'
import {
  createNotePosterSummaryText,
  createNotePosterText,
  createPlainTranscriptText,
  createPolishedTranscriptText,
  createSummaryText
} from '@shared/videoNoteArchive'
import { AssistantActionButton } from '../assistant/AssistantActionButton'
import { CopySplitButton } from './CopySplitButton'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'

type VideoNotesGenerateOptions = {
  summarizeWithDeepSeek?: boolean
}

type VideoNotesPanelProps = {
  note: VideoNote | null
  currentVideoTitle?: string
  currentVideoAuthor?: string
  isLoading: boolean
  onGenerate: () => Promise<VideoNote | null>
  onSave: (note: VideoNote) => Promise<void>
  onChange?: (note: VideoNote) => void
  onTranscribeAudio?: (options?: VideoNotesGenerateOptions) => Promise<VideoNote | null>
  onEnqueueTranscription?: (
    options?: VideoNotesGenerateOptions
  ) => Promise<VideoAudioTranscriptionQueueSnapshot | null>
  onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
  onArchivePosterSummary?: (note: VideoNote, poster: NotePosterSummary) => Promise<void>
  onOpenArchive?: () => void
  deepSeekEnabled?: boolean
  deepSeekAutoSummaryEnabled?: boolean
  transcriptionProgress?: VideoAudioTranscriptionProgress | null
  transcriptionQueue?: VideoAudioTranscriptionQueueSnapshot
}

type VideoNotesResultTab = 'plain' | 'timed' | 'summary'

const resultTabs: Array<{ id: VideoNotesResultTab; label: string; description: string }> = [
  { id: 'plain', label: '无时间线文稿', description: '纯文稿连续阅读，提供复制全文。' },
  { id: 'timed', label: '带时间线文稿', description: '按时间段阅读，提供复制全文。' },
  { id: 'summary', label: 'DeepSeek 总结', description: '更丰富精细的结构化摘要，提供复制全文。' }
]

const progressFallbackByStep: Record<VideoAudioTranscriptionProgress['step'], number> = {
  'preparing-session': 8,
  'downloading-audio': 18,
  'preparing-segments': 30,
  'transcribing-segment': 50,
  'merging-transcript': 88,
  'generating-note': 96,
  'summarizing-deepseek': 96,
  'saving-archive': 98,
  'queue-completed': 100
}

const progressLabelByStep: Record<VideoAudioTranscriptionProgress['step'], string> = {
  'preparing-session': '正在准备转写任务',
  'downloading-audio': '正在下载音频',
  'preparing-segments': '正在切分音频',
  'transcribing-segment': '正在转写音频',
  'merging-transcript': '正在合并文稿',
  'generating-note': '正在生成文稿',
  'summarizing-deepseek': '正在生成 DeepSeek 总结',
  'saving-archive': '正在保存到档案库',
  'queue-completed': '排队已完成'
}

type FormattedProgress = {
  label: string
  percent: number
  ariaLabel: string
}

function createPosterCacheKey(note: VideoNote): string {
  return `${note.id}:${note.updatedAt}`
}

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) return '--:--'
  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60
  return minutes.toString().padStart(2, '0') + ':' + remainder.toString().padStart(2, '0')
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function interpolatePercent(start: number, end: number, index: number, count: number): number {
  if (count <= 0) return start
  const completedShare = Math.min(1, Math.max(0, index / count))
  return clampPercent(start + (end - start) * completedShare)
}

function formatProgress(
  progress: VideoAudioTranscriptionProgress,
  summarizeWithDeepSeek = false
): FormattedProgress {
  const ariaLabel = summarizeWithDeepSeek ? '转写音频到 DeepSeek 总结整体进度' : '转写音频到文稿生成整体进度'

  if (progress.step === 'queue-completed') {
    return {
      label: summarizeWithDeepSeek ? 'DeepSeek 总结已完成' : '文稿已生成',
      percent: 100,
      ariaLabel
    }
  }

  if (
    progress.step === 'transcribing-segment' &&
    typeof progress.segmentIndex === 'number' &&
    typeof progress.segmentCount === 'number' &&
    progress.segmentCount > 0
  ) {
    return {
      label: '正在转写第 ' + progress.segmentIndex + ' / ' + progress.segmentCount + ' 段',
      percent: summarizeWithDeepSeek
        ? interpolatePercent(30, 78, progress.segmentIndex, progress.segmentCount)
        : interpolatePercent(30, 68, progress.segmentIndex, progress.segmentCount),
      ariaLabel
    }
  }

  if (progress.step === 'merging-transcript') {
    return {
      label: progressLabelByStep[progress.step],
      percent: summarizeWithDeepSeek ? 82 : 76,
      ariaLabel
    }
  }

  if (progress.step === 'generating-note') {
    return {
      label: progressLabelByStep[progress.step],
      percent: summarizeWithDeepSeek ? 88 : 94,
      ariaLabel
    }
  }

  return {
    label: progressLabelByStep[progress.step],
    percent: progressFallbackByStep[progress.step],
    ariaLabel
  }
}

function createTimedTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => '[' + formatTimestamp(segment.start) + '] ' + segment.text.trim())
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
}

export function VideoNotesPanel({
  note,
  currentVideoTitle = '当前视频',
  currentVideoAuthor,
  isLoading,
  onGenerate,
  onTranscribeAudio,
  onEnqueueTranscription,
  onGeneratePoster,
  onArchivePosterSummary,
  onOpenArchive,
  deepSeekEnabled = false,
  deepSeekAutoSummaryEnabled = false,
  transcriptionProgress = null,
  transcriptionQueue
}: VideoNotesPanelProps): React.JSX.Element {
  const [activeResultTab, setActiveResultTab] = useState<VideoNotesResultTab | null>(null)
  const [localGenerating, setLocalGenerating] = useState(false)
  const [transcribingAudio, setTranscribingAudio] = useState(false)
  const [generateFailed, setGenerateFailed] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [posterSummary, setPosterSummary] = useState<{
    noteKey: string
    summary: NotePosterSummary
  } | null>(null)
  const [posterGenerating, setPosterGenerating] = useState(false)
  const activeQueueItem = useMemo(
    () =>
      transcriptionQueue?.items.find((item) =>
        transcriptionQueue.activeItemId
          ? item.id === transcriptionQueue.activeItemId
          : item.status === 'running'
      ) ?? null,
    [transcriptionQueue]
  )
  const latestCompletedQueueItem = useMemo(
    () =>
      transcriptionQueue?.items
        .filter((item) => item.status === 'completed')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null,
    [transcriptionQueue]
  )
  const visibleQueueItem = activeQueueItem ?? latestCompletedQueueItem
  const queuedItemCount = useMemo(
    () => transcriptionQueue?.items.filter((item) => item.status === 'pending').length ?? 0,
    [transcriptionQueue]
  )
  const generationBusy = isLoading || localGenerating || transcribingAudio
  const notePosterKey = note ? createPosterCacheKey(note) : ''
  const activePosterSummary =
    posterSummary && posterSummary.noteKey === notePosterKey ? posterSummary.summary : null
  const sourceAuthor =
    note?.source.author?.trim() || currentVideoAuthor?.trim() || '待转写后补齐'
  const plainTranscript = useMemo(() => (note ? createPlainTranscriptText(note) : ''), [note])
  const timedTranscript = useMemo(() => (note ? createTimedTranscriptText(note.transcript) : ''), [note])
  const summaryText = useMemo(
    () =>
      activePosterSummary
        ? createNotePosterText(activePosterSummary)
        : note
          ? createSummaryText(note)
          : '',
    [activePosterSummary, note]
  )

  async function handleGenerate(): Promise<void> {
    if (generationBusy) return
    if (onTranscribeAudio) {
      if (onEnqueueTranscription) {
        await handleEnqueueTranscription()
        return
      }
      await handleTranscribeAudio()
      return
    }
    setLocalGenerating(true)
    setGenerateFailed(false)
    setStatusMessage('')
    setErrorMessage('')
    try {
      const generatedNote = await onGenerate()
      if (generatedNote) setStatusMessage('札记已整理')
    } catch (error) {
      setGenerateFailed(true)
      setErrorMessage(error instanceof Error ? error.message : '整理札记时遇到未知错误。')
    } finally {
      setLocalGenerating(false)
    }
  }

  function createDeepSeekOptions(): VideoNotesGenerateOptions {
    return {
      summarizeWithDeepSeek: deepSeekEnabled && deepSeekAutoSummaryEnabled
    }
  }

  async function runTranscribeAudio(): Promise<VideoNote | null> {
    if (!onTranscribeAudio || generationBusy) return null
    setActiveResultTab('plain')
    setTranscribingAudio(true)
    setStatusMessage('')
    setErrorMessage('')
    try {
      const generatedNote = await onTranscribeAudio(createDeepSeekOptions())
      if (generatedNote) setStatusMessage(deepSeekEnabled ? '音频已转写，可继续生成 DeepSeek 总结。' : '音频转写已完成。')
      return generatedNote
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '音频转写失败。')
      return null
    } finally {
      setTranscribingAudio(false)
    }
  }

  async function handleTranscribeAudio(): Promise<void> {
    await runTranscribeAudio()
  }

  async function handleEnqueueTranscription(): Promise<void> {
    if (!onEnqueueTranscription || generationBusy) return
    setActiveResultTab('plain')
    setStatusMessage('')
    setErrorMessage('')
    try {
      const snapshot = await onEnqueueTranscription(createDeepSeekOptions())
      if (snapshot) {
        const runningTitle =
          snapshot.items.find((item) =>
            snapshot.activeItemId ? item.id === snapshot.activeItemId : item.status === 'running'
          )?.title ?? activeQueueItem?.title

        setStatusMessage(
          runningTitle && runningTitle !== currentVideoTitle
            ? `正在转写「${runningTitle}」，「${currentVideoTitle}」已加入队列。`
            : `「${currentVideoTitle}」已开始转写。`
        )
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加入转写队列失败。')
    }
  }

  async function generatePosterForNote(targetNote: VideoNote): Promise<void> {
    if (!onGeneratePoster || posterGenerating) return
    setPosterGenerating(true)
    setStatusMessage('')
    setErrorMessage('')
    try {
      const summary = await onGeneratePoster(targetNote)
      await onArchivePosterSummary?.(targetNote, summary)
      setPosterSummary({
        noteKey: createPosterCacheKey(targetNote),
        summary
      })
      setStatusMessage('DeepSeek 总结已生成。')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'DeepSeek 总结生成失败。')
    } finally {
      setPosterGenerating(false)
    }
  }

  function handleResultTabClick(tab: VideoNotesResultTab): void {
    setActiveResultTab(tab)
  }

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setStatusMessage(successMessage)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '复制失败。')
      setStatusMessage('')
    }
  }

  function renderProgress(): React.JSX.Element | null {
    if (!transcriptionProgress) return null
    const progress = formatProgress(transcriptionProgress)
    return (
      <div className="video-notes__progress" role="status" aria-live="polite">
        <div>
          <strong>{progress.label}</strong>
          <span>{progress.percent}%</span>
        </div>
        <progress max={100} value={progress.percent} aria-label={progress.ariaLabel} />
      </div>
    )
  }

  function renderQueueItemProgress(item: VideoAudioTranscriptionQueueItem): React.JSX.Element | null {
    const itemProgress =
      item.status === 'completed'
        ? ({
            step: 'queue-completed',
            message: item.progress?.message ?? 'Queued transcription completed.'
          } satisfies VideoAudioTranscriptionProgress)
        : item.progress

    if (!itemProgress) return null
    const progress = formatProgress(itemProgress, Boolean(item.summarizeWithDeepSeek))

    return (
      <div className="video-notes__queue-progress" role="status" aria-live="polite">
        <div>
          <span>{progress.label}</span>
          <span>{progress.percent}%</span>
        </div>
        <progress max={100} value={progress.percent} aria-label={progress.ariaLabel} />
      </div>
    )
  }

  function renderTranscriptionQueue(): React.JSX.Element | null {
    if (!visibleQueueItem) return null
    const statusLabel =
      visibleQueueItem.status === 'completed' ? '排队已完成' : '正在转写'

    return (
      <section className="video-notes__queue" aria-label="转写状态">
        <div className="video-notes__panel-header">
          <strong>{statusLabel}：{visibleQueueItem.title}</strong>
          <span>排队中：{queuedItemCount} 个</span>
        </div>
        {renderQueueItemProgress(visibleQueueItem)}
      </section>
    )
  }

  function renderResultTabs(): React.JSX.Element {
    return (
      <div className="video-notes__result-tabs" role="tablist" aria-label="札记结果">
        {resultTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeResultTab === tab.id}
            aria-controls={'video-notes-' + tab.id}
            id={'video-notes-tab-' + tab.id}
            onClick={() => handleResultTabClick(tab.id)}
          >
            <strong>{tab.label}</strong>
            <small>{tab.description}</small>
          </button>
        ))}
      </div>
    )
  }

  function renderSummaryPanel(): React.JSX.Element {
    const summaryCopy = summaryText || '暂无 DeepSeek 总结。'
    const summaryActionLabel = activePosterSummary ? '重新总结' : '生成总结'
    const summaryActionDisabled = !deepSeekEnabled || !note || posterGenerating
    const polishedCopy = activePosterSummary ? createPolishedTranscriptText(activePosterSummary) : ''
    const summaryOnlyCopy = activePosterSummary ? createNotePosterSummaryText(activePosterSummary) : ''
    return (
      <div role="tabpanel" id="video-notes-summary" aria-labelledby="video-notes-tab-summary">
        <div className="video-notes__panel-header">
          <strong>DeepSeek 总结</strong>
          <div className="video-notes__panel-actions">
            <button
              type="button"
              className="video-notes__summary-generate"
              disabled={summaryActionDisabled}
              onClick={() => note && void generatePosterForNote(note)}
            >
              {posterGenerating ? '生成中...' : summaryActionLabel}
            </button>
            <CopySplitButton
              groupLabel="DeepSeek 复制"
              buttonLabel="复制全文"
              menuLabel="更多复制"
              text={summaryCopy}
              message="全文已复制"
              disabled={!activePosterSummary}
              onCopy={copyText}
              options={[
                {
                  id: 'polished',
                  label: '复制精修文',
                  text: polishedCopy,
                  message: '精修文稿已复制',
                  disabled: !polishedCopy
                },
                {
                  id: 'summary',
                  label: '复制总结',
                  text: summaryOnlyCopy,
                  message: '总结已复制',
                  disabled: !summaryOnlyCopy
                }
              ]}
            />
          </div>
        </div>
        {!deepSeekEnabled ? (
          <p className="video-notes__summary-empty">请先到设置启用 DeepSeek 后再生成总结。</p>
        ) : posterGenerating ? (
          <p role="status">DeepSeek 正在生成总结...</p>
        ) : activePosterSummary ? (
          <section className="video-notes__summary-result" aria-label="DeepSeek 总结">
            <h4>{activePosterSummary.title}</h4>
            <p className="video-notes__summary-subtitle">{activePosterSummary.subtitle}</p>
            <ul className="video-notes__summary-points">
              {activePosterSummary.keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {activePosterSummary.keywords.length > 0 ? (
              <ul className="video-notes__keywords" aria-label="关键词">
                {activePosterSummary.keywords.map((keyword) => (
                  <li key={keyword}>{keyword}</li>
                ))}
              </ul>
            ) : null}
            {activePosterSummary.polishedTranscriptText?.trim() ? (
              <article className="video-notes__summary-section">
                <h4>精修文稿</h4>
                <pre>{activePosterSummary.polishedTranscriptText.replace(/^#+\s*精修文稿\s*/u, '').trim()}</pre>
              </article>
            ) : null}
            {activePosterSummary.auditChecklistText?.trim() ? (
              <article className="video-notes__summary-section">
                <h4>内容核对清单</h4>
                <pre>{activePosterSummary.auditChecklistText.replace(/^#+\s*内容核对清单\s*/u, '').trim()}</pre>
              </article>
            ) : null}
          </section>
        ) : note ? (
          <p className="video-notes__summary-empty">
            请点击生成总结，让 DeepSeek 基于文稿生成精准总结。
          </p>
        ) : (
          <p className="video-notes__summary-empty">请先转写音频，再生成 DeepSeek 总结。</p>
        )}
      </div>
    )
  }

  const primaryActionLabel = onTranscribeAudio ? '转写音频' : generateFailed ? '重新整理' : '整理札记'
  const primaryActionBusyLabel = onTranscribeAudio ? '转写中...' : '整理中...'
  const primaryActionDescription = onTranscribeAudio
    ? '下载音频并生成文稿自动保存在档案库里'
    : '整理当前视频文稿'

  return (
    <section className="video-notes" aria-label="视频札记">
      <section className="video-notes__source" aria-label="当前视频详情">
        <span>{note ? '当前视频' : '当前视频详情'}</span>
        <h3>{note?.source.title ?? currentVideoTitle}</h3>
        <dl>
          <dt>UP</dt>
          <dd>{sourceAuthor}</dd>
          <dt>BV</dt>
          <dd>{note?.source.bvid ?? '待识别'}</dd>
          <dt>链接</dt>
          <dd>{note?.source.url ?? '待转写后补齐'}</dd>
        </dl>
      </section>

      <section className="video-notes__primary-actions" aria-label="札记主操作">
        <AssistantActionButton
          type="button"
          aria-label={primaryActionLabel}
          disabled={generationBusy}
          onClick={() => void handleGenerate()}
          icon={workingPetUrl}
          iconAlt="小咪转写音频"
          badge="转"
          label={generationBusy ? primaryActionBusyLabel : primaryActionLabel}
          description={primaryActionDescription}
        />
        <AssistantActionButton
          type="button"
          aria-label="档案库"
          disabled={!onOpenArchive}
          onClick={onOpenArchive}
          icon={idlePetUrl}
          iconAlt="小咪档案库"
          badge="库"
          label="档案库"
          description="可查看或备注已保存视频文稿"
        />
      </section>

      {renderProgress()}
      {renderTranscriptionQueue()}
      {renderResultTabs()}

      {!note && activeResultTab ? (
        activeResultTab === 'summary' ? (
          renderSummaryPanel()
        ) : (
          <div role="tabpanel" id={'video-notes-' + activeResultTab}>
            暂无文稿。点击“转写音频”开始。
          </div>
        )
      ) : null}

      {note && activeResultTab === 'plain' ? (
        <div role="tabpanel" id="video-notes-plain" aria-labelledby="video-notes-tab-plain">
          <div className="video-notes__panel-header">
            <strong>无时间线文稿</strong>
            <button type="button" onClick={() => void copyText(plainTranscript, '全文已复制')}>
              复制全文
            </button>
          </div>
          <div className="video-notes__plain-text">{plainTranscript ? plainTranscript : '暂无文稿。'}</div>
        </div>
      ) : null}

      {note && activeResultTab === 'timed' ? (
        <div role="tabpanel" id="video-notes-timed" aria-labelledby="video-notes-tab-timed">
          <div className="video-notes__panel-header">
            <strong>带时间线文稿</strong>
            <button type="button" onClick={() => void copyText(timedTranscript, '全文已复制')}>
              复制全文
            </button>
          </div>
          <ol aria-label="带时间线文稿">
            {note.transcript.map((segment, index) => (
              <li key={String(segment.start ?? 'unknown') + '-' + index}>
                <time>{formatTimestamp(segment.start)}</time>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {note && activeResultTab === 'summary' ? renderSummaryPanel() : null}

      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
    </section>
  )
}
