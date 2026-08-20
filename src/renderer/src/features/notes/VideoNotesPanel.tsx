import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  NotePosterSummary,
  TranscriptSegment,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueItem,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import type { MultipartVideoPart, MultipartVideoSnapshot } from './videoNoteMultipart'
import { buildMultipartPartUrl } from './videoNoteMultipart'
import { BilimiModal } from '../../components/BilimiModal'
import {
  createNotePosterCopyParts,
  createNotePosterSummaryText,
  createNotePosterText,
  normalizeNotePosterTextForDisplay,
  createPlainTranscriptText,
  createPolishedTranscriptText
} from '@shared/videoNoteArchive'
import { AssistantActionButton } from '../assistant/AssistantActionButton'
import { CopySplitButton, ExportButton, type DownloadFormat } from './CopySplitButton'
import { VideoNoteBatchExportDialog } from './VideoNoteBatchExportDialog'
import { VideoSummaryMenu } from './VideoSummaryMenu'
import { NoteSelectionCheckbox, NoteSelectionStore, NoteSelectionSubscriber } from './noteSelectionStore'
import idlePetUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import workingPetUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'

type VideoNotesGenerateOptions = {
  summarizeWithDeepSeek?: boolean
}

type QueueBulkAction =
  | 'remove'
  | 'retry'
  | 'cancel-waiting'

type QueueBulkResult = {
  snapshot: VideoAudioTranscriptionQueueSnapshot
  affected: number
  canceled: number
  stopped: number
  retried: number
  started: number
  removed: number
  skipped: number
}

type VideoNotesPanelProps = {
  note: VideoNote | null
  /** The queue snapshot is global; render only this signed-in account's jobs. */
  accountMid?: string
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
  onReadMultipartVideo?: () => Promise<MultipartVideoSnapshot | null>
  onEnqueueMultipartTranscription?: (
    snapshot: MultipartVideoSnapshot,
    parts: MultipartVideoPart[],
    options?: VideoNotesGenerateOptions
  ) => Promise<VideoAudioTranscriptionQueueSnapshot | null>
  onOpenQueueSource?: (item: VideoAudioTranscriptionQueueItem) => void
  onCancelQueuedVideoAudioTranscription?: (id: string) => void
  onCancelQueuedVideoSummary?: (id: string) => void
  onRetryQueuedVideoAudioTranscription?: (id: string) => void
  onRetryQueuedVideoAudioOnCpu?: (id: string) => void
  onRetryQueuedArchiveRegistration?: (id: string) => void
  onRetryQueuedVideoSummary?: (id: string) => void
  onBulkQueueAction?: (
    action: QueueBulkAction,
    ids: string[]
  ) => Promise<QueueBulkResult | void> | QueueBulkResult | void
  onGeneratePoster?: (note: VideoNote) => Promise<NotePosterSummary>
  onArchivePosterSummary?: (
    note: VideoNote,
    poster: NotePosterSummary
  ) => Promise<VideoNoteArchiveEntry[] | void>
  onOpenArchive?: () => void
  archivedSummaryText?: string
  deepSeekEnabled?: boolean
  deepSeekAutoSummaryEnabled?: boolean
  deepSeekSummaryGenerating?: boolean
  transcriptionQueue?: VideoAudioTranscriptionQueueSnapshot
  archivedNotes?: VideoNoteArchiveEntry[]
  activeResultTab?: VideoNotesResultTab | null
  onActiveResultTabChange?: (tab: VideoNotesResultTab | null) => void
  onSeekCurrentVideoTime?: (seconds: number) => void | Promise<void>
  onSeekSource?: (source: VideoNote['source'], seconds: number) => void | Promise<void>
  onCopyFeedback?: (feedback: VideoNotesCopyFeedback) => void
}

export type VideoNotesResultTab = 'plain' | 'timed' | 'summary'
export type VideoNotesCopyFeedback = { tone: 'success' | 'error'; message: string }

const resultTabs: Array<{ id: VideoNotesResultTab; label: string; description: string }> = [
  { id: 'plain', label: '无时间线文稿', description: '查看纯文稿，适合连续阅读' },
  { id: 'timed', label: '带时间线文稿', description: '查看时间线文稿，可点击时间跳转' },
  { id: 'summary', label: 'DeepSeek 总结', description: '查看结构化总结与精修文稿' }
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
  'canceling': 98,
  'canceling-summary': 98,
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
  'canceling': '正在取消转写',
  'canceling-summary': '正在取消总结',
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

function createQueueItemStatusLabel(item: VideoAudioTranscriptionQueueItem): string {
  switch (item.status) {
    case 'pending':
      return '等待转写'
    case 'running':
      return item.cancelRequested ? '正在取消…' : item.progress?.step === 'summarizing-deepseek' ? '正在生成总结' : '正在转写'
    case 'waiting-restart':
      return '等待重新开始'
    case 'completed':
      return '排队已完成'
    case 'failed':
      return '转写失败'
    case 'canceled':
      return '已取消'
  }
}

function createQueueItemOptionLabel(item: VideoAudioTranscriptionQueueItem): string {
  return `${createQueueItemStatusLabel(item)}：${item.title}`
}

function findArchivedQueueVersion(
  archives: VideoNoteArchiveEntry[],
  queueItem?: VideoAudioTranscriptionQueueItem | null
): VideoNoteArchiveEntry['versions'][number] | null {
  if (!queueItem?.archiveNoteId || !queueItem.archiveVersionId) return null
  const archive = archives.find((entry) => entry.id === queueItem.archiveNoteId)
  return archive?.versions.find((version) => version.id === queueItem.archiveVersionId) ?? null
}

function isValidTimestamp(seconds: number | null): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
}

function hasUsableTimeline(note: VideoNote | null): boolean {
  if (!note) return false
  const distinctStarts = new Set(
    note.transcript
      .filter((segment) => isValidTimestamp(segment.start) && isValidTimestamp(segment.end) && segment.end >= segment.start)
      .map((segment) => segment.start)
  )
  return distinctStarts.size > 1
}

function formatQueueErrorMessage(message: string | undefined): string {
  if (message?.startsWith('Audio download failed')) return '音频下载失败，请检查网络后重试。'
  return message || '转写失败，可重试。'
}

function findCurrentArchiveSelection(
  archives: VideoNoteArchiveEntry[],
  note: VideoNote | null,
  queueItem: VideoAudioTranscriptionQueueItem | null | undefined,
  accountMid?: string
): { accountMid: string; archiveId: string; versionId: string; hasNotes: boolean } | null {
  if (queueItem?.archiveNoteId && queueItem.archiveVersionId) {
    const archive = archives.find((entry) => entry.id === queueItem.archiveNoteId)
    const version = archive?.versions.find((candidate) => candidate.id === queueItem.archiveVersionId)
    const owner = archive?.source.accountMid
    if (archive && version && owner && owner === queueItem.accountMid && (!accountMid || owner === accountMid)) {
      return { accountMid: owner, archiveId: archive.id, versionId: version.id, hasNotes: Boolean(version.note.userMemo.trim() || version.note.annotations.length) }
    }
  }
  if (!note) return null
  const archive = archives.find((entry) => {
    const source = entry.source
    if (!source.accountMid || !note.source.accountMid || source.accountMid !== note.source.accountMid || (accountMid && source.accountMid !== accountMid)) return false
    if (typeof source.aid === 'number' || typeof note.source.aid === 'number') return source.aid === note.source.aid && source.cid === note.source.cid
    return Boolean(source.bvid && note.source.bvid && source.bvid === note.source.bvid)
  })
  const version = archive?.versions.find((candidate) => candidate.note.updatedAt === note.updatedAt)
  if (!archive || !version || !archive.source.accountMid) return null
  return { accountMid: archive.source.accountMid, archiveId: archive.id, versionId: version.id, hasNotes: Boolean(version.note.userMemo.trim() || version.note.annotations.length) }
}

export function VideoNotesPanel({
  note,
  accountMid,
  currentVideoTitle = '当前视频',
  currentVideoAuthor,
  isLoading,
  onGenerate,
  onTranscribeAudio,
  onEnqueueTranscription,
  onReadMultipartVideo,
  onEnqueueMultipartTranscription,
  onOpenQueueSource,
  onCancelQueuedVideoAudioTranscription,
  onCancelQueuedVideoSummary,
  onRetryQueuedVideoAudioTranscription,
  onRetryQueuedVideoAudioOnCpu,
  onRetryQueuedArchiveRegistration,
  onRetryQueuedVideoSummary,
  onBulkQueueAction,
  onGeneratePoster,
  onArchivePosterSummary,
  onOpenArchive,
  archivedSummaryText = '',
  deepSeekEnabled = false,
  deepSeekAutoSummaryEnabled = false,
  deepSeekSummaryGenerating = false,
  transcriptionQueue,
  archivedNotes = [],
  activeResultTab: controlledActiveResultTab,
  onActiveResultTabChange,
  onSeekCurrentVideoTime,
  onSeekSource,
  onCopyFeedback
}: VideoNotesPanelProps): React.JSX.Element {
  const [uncontrolledActiveResultTab, setUncontrolledActiveResultTab] =
    useState<VideoNotesResultTab | null>(null)
  const [localGenerating, setLocalGenerating] = useState(false)
  const [transcribingAudio, setTranscribingAudio] = useState(false)
  const [enqueueingTranscription, setEnqueueingTranscription] = useState(false)
  const [transcriptionMode, setTranscriptionMode] = useState<'single' | 'multi'>('single')
  const [multipartSnapshot, setMultipartSnapshot] = useState<MultipartVideoSnapshot | null>(null)
  const [multipartDialogOpen, setMultipartDialogOpen] = useState(false)
  const [multipartLoading, setMultipartLoading] = useState(false)
  const [multipartError, setMultipartError] = useState('')
  const [selectedMultipartParts, setSelectedMultipartParts] = useState<number[]>([])
  const [multipartSubmitting, setMultipartSubmitting] = useState(false)
  const [generateFailed, setGenerateFailed] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [posterSummary, setPosterSummary] = useState<{
    noteKey: string
    summary: NotePosterSummary
  } | null>(null)
  const [posterGenerating, setPosterGenerating] = useState(false)
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null)
  const [queueSelection] = useState(() => new NoteSelectionStore())
  const [queueBulkFeedback, setQueueBulkFeedback] = useState('')
  const [documentExport, setDocumentExport] = useState<{
    accountMid: string
    selections: Array<{ archiveId: string; versionId: string }>
    skippedCount: number
    hasNotes: boolean
    initialScope?: 'current' | 'complete'
    currentContent?: VideoNotesResultTab
    initialFormats?: DownloadFormat[]
  } | null>(null)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const previousAccountMidRef = useRef(accountMid)
  const subscribeBatchProgress = useCallback<NonNullable<ComponentProps<typeof VideoNoteBatchExportDialog>['onProgress']>>(
    (callback) => window.bilimiDesktop.onVideoNoteArchiveBatchProgress?.(callback) ?? (() => undefined),
    []
  )
  const queueItems = useMemo(() => (transcriptionQueue?.items ?? []).filter((item) =>
    !accountMid || item.accountMid === accountMid
  ), [accountMid, transcriptionQueue])
  const activeQueueItem = useMemo(
    () =>
      queueItems.find((item) =>
        transcriptionQueue?.activeItemId
          ? item.id === transcriptionQueue.activeItemId
          : item.status === 'running'
      ) ?? null,
    [queueItems, transcriptionQueue?.activeItemId]
  )
  const latestCompletedQueueItem = useMemo(
    () =>
      queueItems
        .filter((item) => item.status === 'completed')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null,
    [queueItems]
  )
  const defaultVisibleQueueItem = activeQueueItem ?? queueItems
    .filter((item) => item.status === 'pending')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? latestCompletedQueueItem ?? queueItems
    .filter((item) => item.status === 'failed' || item.status === 'canceled' || item.status === 'waiting-restart')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  const visibleQueueItem =
    queueItems.find((item) => item.id === selectedQueueItemId) ?? defaultVisibleQueueItem
  const archivedQueueVersion = useMemo(
    () => findArchivedQueueVersion(archivedNotes, visibleQueueItem),
    [archivedNotes, visibleQueueItem]
  )
  const archivedQueueNote = archivedQueueVersion?.note ?? null
  // Once a queue exists it owns the details card. This prevents navigation to a
  // different page from replacing the selected queue item's identity mid-run.
  const isQueuePreviewActive = Boolean(visibleQueueItem)
  const visibleNote = isQueuePreviewActive ? visibleQueueItem?.draftNote ?? archivedQueueNote : note
  const sourceIdentity = visibleNote?.source.url ?? currentVideoTitle
  const queuedItemCount = useMemo(
    () => queueItems.filter((item) => item.status === 'pending').length,
    [queueItems]
  )
  const sessionCompletedCount = accountMid
    ? queueItems.filter((item) => item.status === 'completed' && item.archiveRegistrationStatus === 'registered').length
    : transcriptionQueue?.sessionCompletedCount ?? 0
  const generationBusy = isLoading || localGenerating || transcribingAudio
  const activeResultTab = controlledActiveResultTab ?? uncontrolledActiveResultTab
  const notePosterKey = visibleNote ? createPosterCacheKey(visibleNote) : ''
  const activePosterSummary =
    posterSummary && posterSummary.noteKey === notePosterKey ? posterSummary.summary : null
  const activeArchivedSummaryText = activePosterSummary
    ? ''
    : isQueuePreviewActive
      ? archivedQueueVersion?.summaryText?.trim() ?? ''
      : archivedSummaryText.trim()
  const archivedCopyParts = useMemo(
    () => createNotePosterCopyParts(activeArchivedSummaryText),
    [activeArchivedSummaryText]
  )
  const hasDeepSeekSummary = Boolean(activePosterSummary || activeArchivedSummaryText)
  const sourceTitle =
    visibleNote?.source.title ?? (isQueuePreviewActive ? visibleQueueItem?.title : currentVideoTitle) ?? currentVideoTitle
  const sourceAuthor = visibleNote?.source.author?.trim() ||
    (isQueuePreviewActive
      ? visibleQueueItem?.author?.trim() || '待转写后补齐'
      : currentVideoAuthor?.trim() || '待识别')
  const transcriptionStatus = visibleQueueItem
    ? visibleQueueItem.cancelRequested || visibleQueueItem.progress?.step.startsWith('canceling')
      ? '正在取消转写视频音频'
      : visibleQueueItem.status === 'pending'
        ? '尚未转写视频音频'
        : visibleQueueItem.status === 'running'
          ? '正在转写视频音频'
          : visibleQueueItem.status === 'completed'
            ? '视频音频已转写'
            : visibleQueueItem.status === 'canceled'
              ? '视频音频转写已取消'
              : '视频音频转写失败'
    : visibleNote
      ? '视频音频已转写'
      : '尚未转写视频音频'
  const plainTranscript = useMemo(
    () => (visibleNote ? createPlainTranscriptText(visibleNote) : ''),
    [visibleNote]
  )
  const timedTranscript = useMemo(
    () => (visibleNote ? createTimedTranscriptText(visibleNote.transcript) : ''),
    [visibleNote]
  )
  const timelineAvailable = useMemo(
    () => visibleNote ? hasUsableTimeline(visibleNote) : true,
    [visibleNote]
  )
  // A selected queue record always keeps the three result destinations available.
  // Until its archive version is usable, the timed view provides an empty state.
  const timelineTabAvailable = timelineAvailable || Boolean(visibleQueueItem)
  const availableResultTabs = useMemo(
    () => resultTabs.filter((tab) => tab.id !== 'timed' || timelineTabAvailable),
    [timelineTabAvailable]
  )
  const summaryText = useMemo(
    () =>
      activePosterSummary
        ? createNotePosterText(activePosterSummary)
        : normalizeNotePosterTextForDisplay(activeArchivedSummaryText),
    [activeArchivedSummaryText, activePosterSummary]
  )
  const visibleCopyParts = useMemo(() => createNotePosterCopyParts(summaryText), [summaryText])
  const preciseSummaryText = visibleCopyParts.summaryText.replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '').trim()
  const detailedOutlineText = visibleCopyParts.detailedOutlineText
  const polishedTranscriptText = visibleCopyParts.polishedTranscriptText
  const unifiedCopyOptions = [
    { id: 'plain', label: '复制无时间线文稿', text: plainTranscript, message: '无时间线文稿已复制', disabled: !plainTranscript },
    { id: 'timed', label: '复制带时间线文稿', text: timedTranscript, message: '带时间线文稿已复制', disabled: !timelineAvailable || !timedTranscript },
    { id: 'summary-full', label: '复制 DeepSeek 总结全文', text: summaryText, message: '总结全文已复制', disabled: !summaryText },
    { id: 'divider', label: '', text: '', message: '', disabled: true },
    { id: 'summary-precise', label: '仅复制精准总结', text: preciseSummaryText, message: '精准总结已复制', disabled: !preciseSummaryText },
    { id: 'summary-outline', label: '仅复制详细内容提要', text: detailedOutlineText, message: '详细内容提要已复制', disabled: !detailedOutlineText },
    { id: 'summary-polished', label: '仅复制精修文稿', text: polishedTranscriptText, message: '精修文稿已复制', disabled: !polishedTranscriptText }
  ]
  const currentArchiveSelection = useMemo(
    () => findCurrentArchiveSelection(archivedNotes, visibleNote, visibleQueueItem, accountMid),
    [accountMid, archivedNotes, visibleNote, visibleQueueItem]
  )

  useEffect(() => {
    if (!selectedQueueItemId) return
    if (!queueItems.some((item) => item.id === selectedQueueItemId)) {
      setSelectedQueueItemId(null)
    }
  }, [queueItems, selectedQueueItemId])

  useEffect(() => {
    const availableIds = new Set(queueItems
      .filter((item) => activeQueueItem?.status !== 'running' || item.id !== activeQueueItem.id)
      .map((item) => item.id))
    queueSelection.retain(availableIds)
  }, [activeQueueItem, queueItems, queueSelection])

  useEffect(() => {
    if (queueItems.length === 0) {
      setQueueExpanded(false)
    }
  }, [queueItems.length])

  useEffect(() => window.bilimiDesktop?.onBilibiliAccountChanged?.(() => {
    setDocumentExport(null)
  }), [])

  useEffect(() => {
    if (previousAccountMidRef.current === accountMid) return
    previousAccountMidRef.current = accountMid
    setDocumentExport(null)
  }, [accountMid])

  useEffect(() => {
    resetMultipartMode()
  }, [sourceIdentity])

  function setResultTab(tab: VideoNotesResultTab | null): void {
    if (controlledActiveResultTab === undefined) {
      setUncontrolledActiveResultTab(tab)
    }

    onActiveResultTabChange?.(tab)
  }

  async function handleGenerate(): Promise<void> {
    if (generationBusy || enqueueingTranscription) return
    if (transcriptionMode === 'multi') {
      await openMultipartDialog()
      return
    }
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
    setTranscribingAudio(true)
    try {
      return await onTranscribeAudio(createDeepSeekOptions())
    } catch {
      return null
    } finally {
      setTranscribingAudio(false)
    }
  }

  async function handleTranscribeAudio(): Promise<void> {
    await runTranscribeAudio()
  }

  async function handleEnqueueTranscription(): Promise<void> {
    if (!onEnqueueTranscription || generationBusy || enqueueingTranscription) return
    setEnqueueingTranscription(true)
    try {
      await onEnqueueTranscription(createDeepSeekOptions())
    } catch {
      // The workspace publishes queue failures through its shared feedback channels.
    } finally {
      setEnqueueingTranscription(false)
    }
  }

  function queueItemForPart(part: MultipartVideoPart): VideoAudioTranscriptionQueueItem | undefined {
    if (!multipartSnapshot) return undefined
    return queueItems.find((item) => item.aid === multipartSnapshot.aid && item.cid === part.cid)
  }

  function archiveForPart(part: MultipartVideoPart): VideoNoteArchiveEntry | undefined {
    if (!multipartSnapshot) return undefined
    return archivedNotes.find((archive) =>
      archive.source.accountMid === accountMid &&
      archive.source.aid === multipartSnapshot.aid &&
      archive.source.cid === part.cid
    )
  }

  function partIsBusy(part: MultipartVideoPart): boolean {
    const item = queueItemForPart(part)
    return Boolean(item && (
      item.status === 'pending' ||
      item.status === 'running' ||
      item.archiveRegistrationStatus === 'failed' ||
      item.summaryStatus === 'queued' ||
      item.summaryStatus === 'generating'
    ))
  }

  function partIsArchived(part: MultipartVideoPart): boolean {
    return Boolean(archiveForPart(part))
  }

  function isPartSelected(partNumber: number): boolean {
    return selectedMultipartParts.includes(partNumber)
  }

  function toggleMultipartPart(part: MultipartVideoPart): void {
    if (partIsBusy(part)) return
    if (partIsArchived(part) && !isPartSelected(part.number)) return
    setSelectedMultipartParts((current) => current.includes(part.number)
      ? current.filter((number) => number !== part.number)
      : [...current, part.number])
  }

  function toggleAvailableMultipartParts(): void {
    if (!multipartSnapshot) return
    const availableNumbers = multipartSnapshot.parts
      .filter((part) => !partIsBusy(part) && !partIsArchived(part))
      .map((part) => part.number)
    if (availableNumbers.length === 0) return
    setSelectedMultipartParts((current) => {
      const selected = new Set(current)
      const allAvailableSelected = availableNumbers.every((number) => selected.has(number))
      availableNumbers.forEach((number) => {
        if (allAvailableSelected) selected.delete(number)
        else selected.add(number)
      })
      return [...selected]
    })
  }

  function resetMultipartMode(): void {
    setTranscriptionMode('single')
    setMultipartDialogOpen(false)
    setMultipartSnapshot(null)
    setMultipartError('')
    setSelectedMultipartParts([])
    setMultipartSubmitting(false)
  }

  async function openMultipartDialog(): Promise<void> {
    if (multipartLoading || !onReadMultipartVideo) {
      if (!onReadMultipartVideo) setMultipartError('当前页面暂不支持读取分 P 信息，请返回视频页面后重试。')
      setMultipartDialogOpen(true)
      return
    }
    setMultipartLoading(true)
    setMultipartError('')
    setMultipartSnapshot(null)
    setSelectedMultipartParts([])
    setMultipartDialogOpen(true)
    try {
      const snapshot = await onReadMultipartVideo()
      if (!snapshot || snapshot.parts.length <= 1) {
        throw new Error(snapshot ? '当前视频只有 1 个分 P，请使用单 P 转写。' : '未能读取当前视频的分 P 信息。')
      }
      setMultipartSnapshot(snapshot)
    } catch (error) {
      setMultipartError(error instanceof Error ? error.message : '读取分 P 信息失败，请重试。')
    } finally {
      setMultipartLoading(false)
    }
  }

  async function submitMultipartTranscription(): Promise<void> {
    if (!multipartSnapshot || !onEnqueueMultipartTranscription || selectedMultipartParts.length === 0 || multipartSubmitting) return
    const parts = multipartSnapshot.parts.filter((part) => selectedMultipartParts.includes(part.number))
    if (parts.length === 0) return
    setMultipartSubmitting(true)
    try {
      await onEnqueueMultipartTranscription(multipartSnapshot, parts, createDeepSeekOptions())
      resetMultipartMode()
    } catch (error) {
      setMultipartError(error instanceof Error ? error.message : '加入转写队列失败，请重试。')
      setMultipartSubmitting(false)
    }
  }

  function renderMultipartDialog(): React.JSX.Element | null {
    if (!multipartDialogOpen) return null
    const selectableParts = multipartSnapshot?.parts.filter((part) => !partIsBusy(part) && !partIsArchived(part)) ?? []
    const selectableCount = selectableParts.length
    const selectedAvailableCount = selectableParts.filter((part) => selectedMultipartParts.includes(part.number)).length
    const allAvailableSelected = selectableCount > 0 && selectedAvailableCount === selectableCount
    const multipartSelectionActionLabel = allAvailableSelected ? '取消全选' : '全选'
    return <BilimiModal
      title="选择多 P 转写"
      busy={multipartLoading || multipartSubmitting}
      onClose={resetMultipartMode}
      actions={<>
        {multipartError ? <button type="button" onClick={() => void openMultipartDialog()} disabled={multipartLoading}>重试</button> : null}
        <button type="button" onClick={resetMultipartMode} disabled={multipartSubmitting}>返回</button>
        <button type="button" onClick={() => void submitMultipartTranscription()} disabled={!selectedMultipartParts.length || multipartLoading || multipartSubmitting || !onEnqueueMultipartTranscription}>加入转写队列</button>
      </>}
    >
      {multipartLoading ? <p role="status">正在读取当前视频的分 P 信息…</p> : multipartError ? <p role="alert">{multipartError}</p> : multipartSnapshot ? <>
        <div className="video-notes__multipart-toolbar">
          <button type="button" onClick={toggleAvailableMultipartParts} disabled={!selectableCount}>{multipartSelectionActionLabel}</button>
          <span>已选 {selectedMultipartParts.length} 个</span>
        </div>
        <ul className="video-notes__multipart-list">
          {multipartSnapshot.parts.map((part) => {
            const busy = partIsBusy(part)
            const archived = partIsArchived(part)
            const selected = isPartSelected(part.number)
            const status = busy ? '处理中' : archived && !selected ? '已归档' : '可加入'
            return <li key={part.number} className="video-notes__multipart-row">
              <label>
                <input
                  type="checkbox"
                  aria-label={`选择 P${part.number}`}
                  checked={selected}
                  disabled={busy || (archived && !selected)}
                  onChange={() => toggleMultipartPart(part)}
                />
                <span>P{part.number} · {part.title}</span>
                <small>{Math.floor(part.durationSeconds / 60)}:{String(part.durationSeconds % 60).padStart(2, '0')} · {status}</small>
              </label>
              {archived && !busy ? <button type="button" onClick={() => toggleMultipartPart(part)}>{selected ? '已选择重转写' : '重新转写'}</button> : null}
            </li>
          })}
        </ul>
      </> : null}
    </BilimiModal>
  }

  useEffect(() => {
    if (visibleNote && activeResultTab === 'timed' && !timelineTabAvailable) setResultTab('plain')
  }, [activeResultTab, timelineTabAvailable, visibleNote])

  async function generatePosterForNote(targetNote: VideoNote): Promise<void> {
    if (!onGeneratePoster || posterGenerating) return
    setPosterGenerating(true)
    try {
      const summary = await onGeneratePoster(targetNote)
      await onArchivePosterSummary?.(targetNote, summary)
      setPosterSummary({
        noteKey: createPosterCacheKey(targetNote),
        summary
      })
    } catch {
      // The workspace publishes DeepSeek failures through its shared feedback channels.
    } finally {
      setPosterGenerating(false)
    }
  }

  function handleResultTabClick(tab: VideoNotesResultTab): void {
    setResultTab(activeResultTab === tab ? null : tab)
  }

  function selectQueueItem(id: string): void {
    setSelectedQueueItemId(id)
    if (queueItems.find((item) => item.id === id)?.status === 'completed') setResultTab('plain')
  }

  function formatQueueBulkFeedback(result: QueueBulkResult): string {
    const changed = result.removed || result.retried || result.canceled || result.stopped
    return `已处理 ${changed} 项${result.skipped ? `，跳过 ${result.skipped} 项` : ''}。`
  }

  async function runQueueBulkAction(action: QueueBulkAction): Promise<void> {
    const selectedQueueItemIds = queueSelection.getSelectedIds()
    if (!onBulkQueueAction || selectedQueueItemIds.length === 0) return
    const outcome = await onBulkQueueAction(action, selectedQueueItemIds)
    if (!outcome) return
    setQueueBulkFeedback(formatQueueBulkFeedback(outcome))
  }

  function openQueueItemDocumentExport(item: VideoAudioTranscriptionQueueItem, initialFormats: DownloadFormat[]): void {
    const selection = findCurrentArchiveSelection(archivedNotes, item.draftNote ?? null, item, accountMid)
    if (!selection) return
    setDocumentExport({
      accountMid: selection.accountMid,
      selections: [{ archiveId: selection.archiveId, versionId: selection.versionId }],
      skippedCount: 0,
      hasNotes: selection.hasNotes,
      initialScope: 'current',
      currentContent: 'plain',
      initialFormats
    })
  }

  function renderQueueItemAction(item: VideoAudioTranscriptionQueueItem): React.JSX.Element | null {
    if (item.status === 'completed' && ['queued', 'generating'].includes(item.summaryStatus ?? '')) {
      return <button
        type="button"
        className="video-notes__queue-row-action"
        aria-label={`取消总结 ${item.title}`}
        onClick={() => onCancelQueuedVideoSummary?.(item.id)}
      >
        取消总结
      </button>
    }
    if (item.status === 'completed' && item.summaryStatus === 'failed') {
      return <button
        type="button"
        className="video-notes__queue-row-action"
        aria-label={`仅重试总结 ${item.title}`}
        onClick={() => onRetryQueuedVideoSummary?.(item.id)}
      >
        重试总结
      </button>
    }
    if ((item.status === 'pending' || item.status === 'running') && !item.cancelRequested && !item.progress?.step.startsWith('canceling')) {
      return <button
        type="button"
        className="video-notes__queue-progress-cancel"
        onClick={() => onCancelQueuedVideoAudioTranscription?.(item.id)}
      >
        取消转写
      </button>
    }
    if (item.status === 'failed' || item.status === 'canceled' || item.status === 'waiting-restart') {
      return <button
        type="button"
        className="video-notes__queue-row-action"
        aria-label={`重试 ${item.title}`}
        onClick={() => onRetryQueuedVideoAudioTranscription?.(item.id)}
      >
        重试
      </button>
    }
    return null
  }

  async function copyText(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      onCopyFeedback?.({ tone: 'success', message: successMessage })
    } catch (error) {
      onCopyFeedback?.({
        tone: 'error',
        message: error instanceof Error ? error.message : '复制失败。'
      })
    }
  }

  function renderQueueItemProgress(item: VideoAudioTranscriptionQueueItem, action?: React.ReactNode): React.JSX.Element | null {
    if (item.status === 'completed') {
      const completionLabel = item.transcriptOutcome === 'no-speech'
        ? item.archiveRegistrationStatus === 'failed'
          ? '未检测到可转写语音，档案保存失败'
          : '未检测到可转写语音'
        : item.archiveRegistrationStatus === 'failed'
        ? item.summaryStatus === 'generated' ? '总结已生成，档案保存失败' : '文稿已生成，档案保存失败'
        : item.summaryStatus === 'failed'
          ? item.errorMessage?.trim() || '总结生成失败'
        : item.summarizeWithDeepSeek
        ? item.summaryStatus === 'saved' ? 'DeepSeek 总结已完成'
          : item.summaryStatus === 'generating' ? '文稿已生成，正在生成 DeepSeek 总结'
            : item.summaryStatus === 'queued' ? '文稿已生成，等待 DeepSeek 总结'
              : '文稿已生成，总结未完成'
        : '文稿已生成'
      const runtimeLabel = item.actualDevice
        ? `实际使用：${item.actualDevice === 'cuda' ? 'NVIDIA GPU' : 'CPU'}${item.actualComputeType ? `（${item.actualComputeType}）` : ''}`
        : undefined
      return <div className="video-notes__queue-progress" role="status">
        <div>{completionLabel}</div>
        {runtimeLabel ? <div>{runtimeLabel}</div> : null}
        {item.runtimeFallbackMessage ? <div>{item.runtimeFallbackMessage}</div> : null}
      </div>
    }
    if (item.status === 'failed' || item.status === 'canceled' || item.status === 'waiting-restart') {
      const message = item.status === 'failed'
        ? formatQueueErrorMessage(item.errorMessage)
        : item.status === 'waiting-restart'
          ? '等待重新开始转写'
          : '已取消转写'
      return <div className="video-notes__queue-progress" role="status">
        <div>{message}</div>
        {item.errorDetails ? <details className="video-notes__queue-error-details">
          <summary>查看详情</summary>
          <pre>{item.errorDetails}</pre>
        </details> : null}
      </div>
    }
    const itemProgress = item.progress

    if (!itemProgress) {
      if (item.status === 'running' && !item.cancelRequested) {
        return <div className="video-notes__queue-progress" role="status" aria-live="polite">
          <div><span>正在转写</span>{action}</div>
        </div>
      }
      return null
    }
    const progress = formatProgress(itemProgress, Boolean(item.summarizeWithDeepSeek))
    const progressLabel = progress.label

    return (
      <div className="video-notes__queue-progress" role="status" aria-live="polite">
        <div>
          <span>{progressLabel}</span>
          <span>{progress.percent}%</span>
          {action}
        </div>
        <progress max={100} value={progress.percent} aria-label={progress.ariaLabel} />
        {itemProgress.step === 'transcribing-segment' ? (
          <small>
            正在本地转写，CPU 占用升高是正常现象。
          </small>
        ) : null}
      </div>
    )
  }

  function renderTranscriptionQueue(): React.JSX.Element | null {
    const hasQueueItems = queueItems.length > 0
    const queueDetailsTitle = queueItems.map((item) => createQueueItemOptionLabel(item)).join('\n')
    const historicalQueueItems = queueItems.filter((item) =>
      activeQueueItem?.status !== 'running' || item.id !== activeQueueItem.id
    )
    const displayedHistoricalQueueItems = [...historicalQueueItems]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return (
      <section className="video-notes__queue" aria-label="转写状态">
        {activeQueueItem?.status === 'running' ? (
          <>
            <div className="video-notes__queue-current-heading">
              <div className="video-notes__queue-current-content">
                <button type="button" className="video-notes__queue-current-title" aria-current={activeQueueItem.id === visibleQueueItem?.id ? 'true' : undefined} title={activeQueueItem.title} aria-label={(activeQueueItem.cancelRequested ? '正在取消…：' : '正在转写：') + activeQueueItem.title} onClick={(event) => {
                  selectQueueItem(activeQueueItem.id)
                  if ((event.target as HTMLElement).closest('.video-notes__queue-record-title')) onOpenQueueSource?.(activeQueueItem)
                }}>
                  <span className="video-notes__queue-current-accessible-label">{(activeQueueItem.cancelRequested ? '正在取消…：' : '正在转写：') + activeQueueItem.title}</span>
                  <span className="video-notes__queue-current-prefix">{activeQueueItem.cancelRequested ? '正在取消…：' : '正在转写：'}</span>
                  <span className="video-notes__queue-record-title">{activeQueueItem.title}</span>
                  {activeQueueItem.actualDevice ? <span className="video-notes__queue-runtime">
                    {`正在使用${activeQueueItem.actualDevice === 'cuda' ? ' NVIDIA GPU' : ' CPU'} 转写${activeQueueItem.actualComputeType ? ` · ${activeQueueItem.actualComputeType}` : ''}`}
                    {activeQueueItem.runtimeFallbackMessage ? ` · ${activeQueueItem.runtimeFallbackMessage}` : ''}
                  </span> : null}
                </button>
                {renderQueueItemProgress(activeQueueItem, renderQueueItemAction(activeQueueItem))}
              </div>
            </div>
          </>
        ) : null}
        <div className={'video-notes__queue-header' + (activeQueueItem?.status === 'running' ? ' video-notes__queue-header--after-current' : '')}>
          <div className="video-notes__queue-summary">
            <span>本次完成：{sessionCompletedCount} 个</span>
            <span>{'排队中：' + queuedItemCount + ' 个'}</span>
            <button
              type="button"
              className="video-notes__queue-selector"
              aria-label={queueExpanded ? '收起转写队列' : '展开转写队列'}
              aria-expanded={queueExpanded}
              title={queueDetailsTitle}
              onClick={() => setQueueExpanded((expanded) => !expanded)}
            >
              <span>{queueExpanded ? '收起队列' : '展开队列'}</span>
              <span className="disclosure-arrow video-notes__queue-arrow" aria-hidden="true" />
            </button>
          </div>
        </div>
        {queueExpanded && hasQueueItems ? <>
        <NoteSelectionSubscriber store={queueSelection}>{({ ids: selectedIds }) => {
          const selectedItems = displayedHistoricalQueueItems.filter((item) => selectedIds.has(item.id))
          const removableCount = selectedItems.filter((item) => item.status !== 'running').length
          const retryableCount = selectedItems.filter((item) => ['failed', 'canceled', 'waiting-restart'].includes(item.status)).length
          const cancelableCount = selectedItems.filter((item) => item.status === 'pending' || (item.status === 'running' && !item.cancelRequested)).length
          const documentSelections = new Map<string, { archiveId: string; versionId: string; accountMid: string; hasNote: boolean }>()
          for (const item of selectedItems) {
            if (item.status !== 'completed' || item.archiveRegistrationStatus === 'failed' || !item.archiveNoteId || !item.archiveVersionId) continue
            if (!item.accountMid || !/^\d+$/.test(item.accountMid)) continue
            documentSelections.set(`${item.archiveNoteId}:${item.archiveVersionId}`, { archiveId: item.archiveNoteId, versionId: item.archiveVersionId, accountMid: item.accountMid, hasNote: false })
          }
          const documentAccounts = new Set([...documentSelections.values()].map((selection) => selection.accountMid))
          const documentExportable = documentAccounts.size === 1 ? [...documentSelections.values()] : []
          const documentContextAccounts = new Set([...documentAccounts, ...selectedItems.map((item) => item.accountMid).filter((mid): mid is string => Boolean(mid && /^\d+$/.test(mid)))])
          const documentAccountMid = documentContextAccounts.size === 1 ? [...documentContextAccounts][0] : undefined
          const cancelSelectedQueueItems = async () => {
            const pendingIds = selectedItems.filter((item) => item.status === 'pending').map((item) => item.id)
            const runningIds = new Set(selectedItems.filter((item) => item.status === 'running' && !item.cancelRequested).map((item) => item.id))
            if (pendingIds.length) {
              const outcome = await onBulkQueueAction?.('cancel-waiting', pendingIds)
              if (outcome) {
                setQueueBulkFeedback(formatQueueBulkFeedback(outcome))
                outcome.snapshot.items.filter((item) => queueSelection.isSelected(item.id) && item.status === 'running' && !item.cancelRequested).forEach((item) => runningIds.add(item.id))
              }
            }
            runningIds.forEach((id) => onCancelQueuedVideoAudioTranscription?.(id))
          }
          return <div className="video-notes__queue-bulk-toolbar" aria-label="队列批量操作">
          <label>
            <input
              type="checkbox"
              aria-label="全选队列记录"
              checked={displayedHistoricalQueueItems.length > 0 && selectedItems.length === displayedHistoricalQueueItems.length}
              onChange={() => {
                const visibleIds = displayedHistoricalQueueItems.map((item) => item.id)
                const nextIds = new Set(queueSelection.getSelectedIds())
                if (selectedItems.length === visibleIds.length) visibleIds.forEach((id) => nextIds.delete(id))
                else visibleIds.forEach((id) => nextIds.add(id))
                queueSelection.replace(nextIds)
              }}
            />
            全选
          </label>
          <span>已选 {selectedItems.length} 项</span>
          <button type="button" disabled={!removableCount} onClick={() => void runQueueBulkAction('remove')}>删除记录</button>
          <VideoSummaryMenu
            disabled={!selectedItems.length}
            actions={[
              { id: 'retry', label: '转写音频', disabled: !retryableCount, onSelect: () => void runQueueBulkAction('retry') },
              { id: 'cancel', label: '取消转写', disabled: !cancelableCount, onSelect: () => void cancelSelectedQueueItems() }
            ]}
            download={{
              disabled: !documentAccountMid,
              onSelect: () => {
                const accountMid = documentAccountMid
                if (!accountMid) return
                setDocumentExport({
                  accountMid,
                  selections: documentExportable.map(({ archiveId, versionId }) => ({ archiveId, versionId })),
                  skippedCount: selectedItems.length - documentExportable.length,
                  hasNotes: documentExportable.some((selection) => selection.hasNote),
                  initialFormats: ['markdown']
                })
              }
            }}
          />
        </div>
        }}</NoteSelectionSubscriber>
        <div className="video-notes__queue-body porcelain-full-bleed-divider">
          {displayedHistoricalQueueItems.map((item) => <div className="video-notes__queue-record" data-selected={item.id === visibleQueueItem?.id ? 'true' : undefined} key={item.id}>
              <label>
              <NoteSelectionCheckbox store={queueSelection} id={item.id} label={'选择 ' + item.title} />
              </label>
              <button
                type="button"
                className="video-notes__queue-record-select"
                title={item.title}
                aria-label={createQueueItemOptionLabel(item)}
                aria-current={item.id === visibleQueueItem?.id ? 'true' : undefined}
                onClick={(event) => {
                  selectQueueItem(item.id)
                  if ((event.target as HTMLElement).closest('.video-notes__queue-record-title')) onOpenQueueSource?.(item)
                }}
              >
                <span className="video-notes__queue-record-title">{item.title}</span>
                {renderQueueItemProgress(item)}
              </button>
              {renderQueueItemAction(item)}
            </div>)}
        </div>
        {queueBulkFeedback ? <p className="video-notes__queue-bulk-feedback" role="status">{queueBulkFeedback}</p> : null}
        </> : queueExpanded ? <div className="video-notes__queue-empty">暂无转写任务</div> : null}
      </section>
    )
  }

  function openCurrentDocumentExport(currentContent: VideoNotesResultTab, initialFormats: DownloadFormat[] = ['markdown']): void {
    if (!currentArchiveSelection) return
    setDocumentExport({
      accountMid: currentArchiveSelection.accountMid,
      selections: [{ archiveId: currentArchiveSelection.archiveId, versionId: currentArchiveSelection.versionId }],
      skippedCount: 0,
      hasNotes: currentArchiveSelection.hasNotes,
      initialScope: 'current',
      currentContent,
      initialFormats
    })
  }

  function renderResultTabs(): React.JSX.Element {
    return (
      <div className="video-notes__result-tabs" role="tablist" aria-label="札记结果">
        {availableResultTabs.map((tab) => {
          const tooltip = `${tab.label}：${tab.description}`

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeResultTab === tab.id}
              aria-controls={'video-notes-' + tab.id}
              id={'video-notes-tab-' + tab.id}
              title={tooltip}
              onClick={() => handleResultTabClick(tab.id)}
            >
              <strong>{tab.label}</strong>
              <small>{tab.description}</small>
            </button>
          )
        })}
      </div>
    )
  }

  function renderSummaryPanel(): React.JSX.Element {
    const summaryActionLabel = hasDeepSeekSummary ? '重新总结' : '生成总结'
    const summaryGenerating = posterGenerating || deepSeekSummaryGenerating
    const summaryActionDisabled = !deepSeekEnabled || !visibleNote || summaryGenerating
    return (
      <div role="tabpanel" id="video-notes-summary" aria-labelledby="video-notes-tab-summary">
        <div className="video-notes__panel-header">
          <strong>DeepSeek 总结</strong>
          <div className="video-notes__panel-actions">
            <button
              type="button"
              className="video-notes__summary-generate"
              disabled={summaryActionDisabled}
              onClick={() => visibleNote && void generatePosterForNote(visibleNote)}
            >
              {summaryGenerating ? '生成中...' : summaryActionLabel}
            </button>
            <CopySplitButton
              groupLabel="DeepSeek 复制"
              menuLabel="复制"
              onCopy={copyText}
              options={unifiedCopyOptions}
            />
            <ExportButton
              groupLabel="DeepSeek 总结导出"
              disabled={!currentArchiveSelection}
              title={!currentArchiveSelection ? '档案尚未完成登记，暂不能导出。' : undefined}
              onExport={() => openCurrentDocumentExport('summary')}
            />
          </div>
        </div>
        <div className="video-notes__result-body">
          {activePosterSummary ? (
            <section className="video-notes__summary-result" aria-label="DeepSeek 总结">
              <h4>{activePosterSummary.title}</h4>
              <p className="video-notes__summary-subtitle">{activePosterSummary.subtitle}</p>
              <ul className="video-notes__summary-points">
                {activePosterSummary.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {activePosterSummary.detailedOutline?.length ? (
                <article className="video-notes__summary-section">
                  <h4>详细内容提要</h4>
                  <ul>{activePosterSummary.detailedOutline.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul>
                </article>
              ) : activePosterSummary.auditChecklistText?.trim() ? (
                <article className="video-notes__summary-section">
                  <h4>详细内容提要</h4>
                  <pre>{activePosterSummary.auditChecklistText.replace(/^#+\s*内容核对清单\s*/u, '').replace(/(?:^|\n)精修记录：[\s\S]*$/u, '').trim()}</pre>
                </article>
              ) : null}
              {activePosterSummary.polishedTranscriptText?.trim() ? (
                <article className="video-notes__summary-section">
                  <h4>精修文稿</h4>
                  <pre>{activePosterSummary.polishedTranscriptText.replace(/^#+\s*精修文稿\s*/u, '').trim()}</pre>
                </article>
              ) : null}
            </section>
          ) : activeArchivedSummaryText ? (
            <section className="video-notes__summary-result" aria-label="DeepSeek 总结">
              <pre>{summaryText}</pre>
            </section>
          ) : !deepSeekEnabled ? (
            <p className="video-notes__summary-empty">请先到设置启用 DeepSeek 后再生成总结。</p>
          ) : visibleNote ? (
            <p className="video-notes__summary-empty">
              请点击生成总结，让 DeepSeek 基于文稿生成精准总结。
            </p>
          ) : (
            <p className="video-notes__summary-empty">请先转写音频，再生成 DeepSeek 总结。</p>
          )}
        </div>
      </div>
    )
  }

  const primaryActionLabel = onTranscribeAudio ? '转写音频' : generateFailed ? '重新整理' : '整理札记'
  const primaryActionBusyLabel = onTranscribeAudio ? '转写中...' : '整理中...'
  const displayedPrimaryActionLabel = enqueueingTranscription
    ? '正在加入...'
    : generationBusy
      ? primaryActionBusyLabel
      : primaryActionLabel
  const primaryActionDescription = onTranscribeAudio
    ? '一键转写视频音频，生成文稿自动保存在档案库'
    : '整理当前视频文稿'

  return (
    <section className="video-notes" aria-label="视频札记">
      <section className="video-notes__source" aria-label="当前视频详情">
        <span>当前转写</span>
        <h3>{sourceTitle}</h3>
        <dl>
          <dt>UP主</dt>
          <dd>{sourceAuthor}</dd>
        </dl>
        <p className="video-notes__source-transcription-status">{transcriptionStatus}</p>
      </section>

      <section className="video-notes__primary-actions" aria-label="札记主操作">
        <div className="video-notes__primary-action-card">
          <AssistantActionButton
            type="button"
            aria-label={displayedPrimaryActionLabel}
            disabled={generationBusy || enqueueingTranscription || multipartLoading}
            onClick={() => void handleGenerate()}
            icon={workingPetUrl}
            iconAlt="小咪转写音频"
            badge="转"
            label={displayedPrimaryActionLabel}
            description={primaryActionDescription}
          />
          {onTranscribeAudio ? <div
            className="video-notes__transcription-mode"
            role="group"
            aria-label="转写模式"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="sr-only">转写模式</span>
            <button
              type="button"
              className="video-notes__transcription-mode-option"
              aria-pressed={transcriptionMode === 'single'}
              title="单 P：只将当前正在播放的这一P视频加入转写队列"
              disabled={generationBusy || enqueueingTranscription || multipartLoading}
              onClick={() => setTranscriptionMode('single')}
            >单 P</button>
            <span className="video-notes__transcription-mode-separator" aria-hidden="true">·</span>
            <button
              type="button"
              className="video-notes__transcription-mode-option"
              aria-pressed={transcriptionMode === 'multi'}
              title="多 P：先选择多个分 P，再批量加入转写队列"
              disabled={generationBusy || enqueueingTranscription || multipartLoading}
              onClick={() => setTranscriptionMode('multi')}
            >多 P</button>
          </div> : null}
        </div>
        <AssistantActionButton
          type="button"
          aria-label="档案库"
          disabled={!onOpenArchive}
          onClick={onOpenArchive}
          icon={idlePetUrl}
          iconAlt="小咪档案库"
          badge="库"
          label="档案库"
          description="打开档案库，可查看或备注视频文稿"
        />
      </section>

      {renderMultipartDialog()}
      {renderTranscriptionQueue()}
      {documentExport ? <VideoNoteBatchExportDialog
        open
        accountMid={documentExport.accountMid}
        selections={documentExport.selections}
        initialSkippedCount={documentExport.skippedCount}
        hasNotes={documentExport.hasNotes}
        initialScope={documentExport.initialScope}
        currentContent={documentExport.currentContent}
        initialFormats={documentExport.initialFormats}
        onClose={() => setDocumentExport(null)}
        preview={(request) => window.bilimiDesktop.previewVideoNoteArchiveBatch?.(request) ?? Promise.resolve({ selectedCount: request.selections.length, exportableCount: 0, skippedCount: request.selections.length })}
        start={(request) => window.bilimiDesktop.startVideoNoteArchiveBatch?.(request) as Promise<{ folderPath?: string; succeededCount: number; skippedCount: number; failedCount: number }>}
        cancel={(input) => window.bilimiDesktop.cancelVideoNoteArchiveBatch?.(input) ?? Promise.resolve(false)}
        openFolder={(input) => window.bilimiDesktop.openVideoNoteArchiveBatchFolder?.(input) ?? Promise.resolve(undefined)}
        onProgress={subscribeBatchProgress}
      /> : null}
      {renderResultTabs()}

      {(!visibleNote || (activeResultTab === 'timed' && !timelineAvailable)) && activeResultTab ? (
        activeResultTab === 'summary' ? (
          renderSummaryPanel()
        ) : (
          <div role="tabpanel" id={'video-notes-' + activeResultTab} aria-labelledby={'video-notes-tab-' + activeResultTab}>
            {activeResultTab === 'timed'
              ? '暂无带时间线文稿。'
              : visibleQueueItem
                ? visibleQueueItem.status === 'completed'
                  ? '该队列项暂无可预览文稿，可到档案库查看。'
                  : '该视频还在转写，完成后可查看文稿。'
              : '暂无文稿。点击“转写音频”开始。'}
          </div>
        )
      ) : null}

      {visibleNote && activeResultTab === 'plain' ? (
        <div role="tabpanel" id="video-notes-plain" aria-labelledby="video-notes-tab-plain">
          <div className="video-notes__panel-header">
            <strong>无时间线文稿</strong>
            <div className="video-notes__panel-actions">
              <CopySplitButton
                groupLabel="无时间线文稿复制"
                menuLabel="复制"
                onCopy={copyText}
                options={unifiedCopyOptions}
              />
              <ExportButton groupLabel="无时间线文稿导出" disabled={!currentArchiveSelection} title={!currentArchiveSelection ? '档案尚未完成登记，暂不能导出。' : undefined} onExport={() => openCurrentDocumentExport('plain')} />
            </div>
          </div>
          <div className="video-notes__result-body video-notes__plain-text">
            {plainTranscript ? plainTranscript : '暂无文稿。'}
          </div>
        </div>
      ) : null}

      {visibleNote && timelineAvailable && activeResultTab === 'timed' ? (
        <div role="tabpanel" id="video-notes-timed" aria-labelledby="video-notes-tab-timed">
          <div className="video-notes__panel-header">
            <strong>带时间线文稿</strong>
            <div className="video-notes__panel-actions">
              <CopySplitButton
                groupLabel="带时间线文稿复制"
                menuLabel="复制"
                onCopy={copyText}
                options={unifiedCopyOptions}
              />
              <ExportButton groupLabel="带时间线文稿导出" disabled={!currentArchiveSelection} title={!currentArchiveSelection ? '档案尚未完成登记，暂不能导出。' : undefined} onExport={() => openCurrentDocumentExport('timed')} />
            </div>
          </div>
          <div className="video-notes__result-body">
            <div className="video-notes__timeline" aria-label="带时间线文稿">
              {visibleNote.transcript.map((segment, index) => (
                <div className="video-notes__timeline-row" key={String(segment.start ?? 'unknown') + '-' + index}>
                  {isValidTimestamp(segment.start) && (isQueuePreviewActive ? onSeekSource : onSeekCurrentVideoTime) ? (
                    <button
                      type="button"
                      className="video-note-archive__timestamp-button"
                      aria-label={`跳转到 ${formatTimestamp(segment.start)}`}
                      onClick={() => {
                        const start = segment.start
                        if (!isValidTimestamp(start)) return
                        if (isQueuePreviewActive) void onSeekSource?.(visibleNote.source, start)
                        else void onSeekCurrentVideoTime?.(start)
                      }}
                    >
                      {formatTimestamp(segment.start)}
                    </button>
                  ) : (
                    <time>{formatTimestamp(segment.start)}</time>
                  )}
                  <p>{segment.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {visibleNote && activeResultTab === 'summary' ? renderSummaryPanel() : null}

      {errorMessage || statusMessage ? (
        <div className="video-notes__feedback" aria-live="polite">
          {errorMessage ? <p role="alert">{errorMessage}</p> : null}
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
