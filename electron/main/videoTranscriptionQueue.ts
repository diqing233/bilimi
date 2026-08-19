import type {
  TranscriptSegment,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueItem,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote,
  TranscriptionModelId
} from '../../src/shared/types'
import { createLocalVideoNoteDraft } from '../../src/shared/videoNoteDraft'

type QueueDeps = {
  loadItems: () => VideoAudioTranscriptionQueueItem[]
  saveItems: (items: VideoAudioTranscriptionQueueItem[]) => void
  transcribe: (
    request: VideoAudioTranscriptionRequest,
    progress: (progress: VideoAudioTranscriptionProgress) => void,
    signal?: AbortSignal
  ) => Promise<VideoAudioTranscriptionResult>
  summarizeNote?: (
    note: VideoNote,
    signal?: AbortSignal,
    onProgress?: (progress: VideoAudioTranscriptionProgress) => void
  ) => Promise<string>
  saveArchiveVersion: (note: VideoNote, summaryText: string) => { archiveId: string; versionId: string } | undefined
  /** Reads the exact persisted version; summary retries must never fall back to an archive's latest version. */
  loadArchiveVersion?: (archiveId: string, versionId: string) => VideoNote | undefined
  /** Persists and re-reads summary text at the exact immutable archive/version identity. */
  saveArchiveSummary?: (archiveId: string, versionId: string, note: VideoNote, summaryText: string) => void
  /** Blocks an in-flight retry from writing after its signed-in account changes. */
  isAccountStillCurrent?: (accountMid: string | undefined) => boolean | Promise<boolean>
  modelForRequest?: (request: VideoAudioTranscriptionRequest) => TranscriptionModelId
  now?: () => string
  onSnapshot?: (snapshot: VideoAudioTranscriptionQueueSnapshot) => void
}

type QueueItem = VideoAudioTranscriptionQueueItem

const PROGRESS_PERSIST_THROTTLE_MS = 100

export type VideoTranscriptionQueueBatchResult = {
  snapshot: VideoAudioTranscriptionQueueSnapshot
  affected: number
  canceled: number
  stopped: number
  retried: number
  started: number
  removed: number
  skipped: number
}

export type VideoTranscriptionQueueVideoTarget = {
  aid: number
  cid?: number
}

type VideoTranscriptionQueue = {
  getSnapshot: () => VideoAudioTranscriptionQueueSnapshot
  enqueue: (request: VideoAudioTranscriptionRequest) => VideoAudioTranscriptionQueueSnapshot
  cancel: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retry: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retryOnCpu: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retryArchiveRegistration: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retrySummary: (id: string) => VideoAudioTranscriptionQueueSnapshot
  cancelWaitingBatch: (ids: string[]) => VideoTranscriptionQueueBatchResult
  cancelWaitingForVideos: (accountMid: string, targets: Array<number | VideoTranscriptionQueueVideoTarget>) => VideoTranscriptionQueueBatchResult
  cancelSummary: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retryBatch: (ids: string[]) => VideoTranscriptionQueueBatchResult
  removeBatch: (ids: string[]) => VideoTranscriptionQueueBatchResult
  clearAccount: (accountMid: string) => VideoAudioTranscriptionQueueSnapshot
  createRunningStopConfirmation: (ids: string[]) => { confirmationToken: string; runningCount: number }
  stopRunningBatch: (ids: string[], confirmationToken: string) => VideoTranscriptionQueueBatchResult
  cancelAllAndWait: () => Promise<VideoAudioTranscriptionQueueSnapshot>
}

function createQueueItemId(request: VideoAudioTranscriptionRequest): string {
  const account = request.accountMid?.trim() ? `account:${request.accountMid.trim()}:` : ''
  if (request.aid !== undefined) {
    const cid = request.cid === undefined ? '' : `:cid:${request.cid}`
    return `${account}aid:${request.aid}${cid}`
  }
  return request.bvid ? `${account}bvid:${request.bvid}` : `${account}url:${request.url}`
}

function matchesRequestRevision(item: QueueItem, request: VideoAudioTranscriptionRequest): boolean {
  return item.metadataRevision === request.metadataRevision
}

function normalizeVideoTargets(targets: Array<number | VideoTranscriptionQueueVideoTarget>): VideoTranscriptionQueueVideoTarget[] {
  const normalized = targets.map((target) => typeof target === 'number' ? { aid: target } : target)
  if (normalized.some((target) =>
    !Number.isSafeInteger(target.aid) || target.aid <= 0 ||
    (target.cid !== undefined && (!Number.isSafeInteger(target.cid) || target.cid <= 0))
  )) throw new Error('Video selection is invalid.')
  return [...new Map(normalized.map((target) => [`${target.aid}:${target.cid ?? ''}`, target])).values()]
}

function createErrorMessage(error: unknown): string {
  const details = error instanceof Error ? error.message : 'Audio transcription failed.'
  if (details.startsWith('Audio preparation failed:')) return '音频格式转换失败'
  if (details.startsWith('Audio download failed')) return '音频下载失败，请检查网络后重试。'
  return details
}

function errorDetailsFor(error: unknown): string | undefined {
  const details = error instanceof Error ? error.message : undefined
  if (!details?.startsWith('Audio preparation failed:')) return undefined
  return details
    .replace(/https?:\/\/\S+/gu, '[redacted-url]')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s]+/gu, '[redacted-path]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500)
}

function failureKindForError(error: unknown): 'cuda-oom' | undefined {
  return error && typeof error === 'object' && 'kind' in error && (error as { kind?: unknown }).kind === 'cuda-oom'
    ? 'cuda-oom'
    : undefined
}

function numericIdentity(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined
  if (!value || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function createNoteFromQueueItem(
  item: VideoAudioTranscriptionQueueItem,
  transcript: TranscriptSegment[],
  now: string
): VideoNote {
  const note = createLocalVideoNoteDraft({
    now,
    source: {
      accountMid: item.accountMid,
      aid: numericIdentity(item.aid),
      cid: numericIdentity(item.cid),
      partNumber: numericIdentity(item.partNumber),
      partTitle: item.partTitle,
      partDurationSeconds: numericIdentity(item.partDurationSeconds),
      title: item.title,
      author: item.author,
      bvid: item.bvid,
      url: item.url,
      tags: []
    },
    transcript,
    transcriptSource: 'audio'
  })
  // Library jobs have a stable account/video identity even when a BV changes.
  return item.aid === undefined ? note : { ...note, id: item.id }
}

function matchesQueueItemArchiveIdentity(item: QueueItem, note: VideoNote): boolean {
  return Boolean(
    item.accountMid &&
    item.bvid &&
    note.source.accountMid === item.accountMid &&
    note.source.aid === numericIdentity(item.aid) &&
    note.source.cid === numericIdentity(item.cid) &&
    note.source.bvid === item.bvid
  )
}

function snapshotFromItems(
  items: QueueItem[],
  sessionCompletedCount: number
): VideoAudioTranscriptionQueueSnapshot {
  return {
    items,
    activeItemId: items.find((item) => item.status === 'running')?.id,
    sessionCompletedCount
  }
}


export function createVideoTranscriptionQueue({
  loadItems,
  saveItems,
  transcribe,
  summarizeNote,
  saveArchiveVersion,
  loadArchiveVersion,
  saveArchiveSummary,
  isAccountStillCurrent = () => true,
  modelForRequest = () => 'whisper-small',
  now = () => new Date().toISOString(),
  onSnapshot
}: QueueDeps): VideoTranscriptionQueue {
  let items: QueueItem[] = loadItems()
  // Never resume interrupted work, but keep historical records until the user removes them.
  const persistedItems = items.filter((item) =>
    !['pending', 'running'].includes(item.status)
  )
  if (items.length > 0 && persistedItems.length !== items.length) {
    items = persistedItems
    saveItems(items)
  }
  let sessionCompletedCount = 0
  let processing = false
  let summaryProcessing = false
  let activeController: AbortController | undefined
  let activeSummaryController: { id: string; controller: AbortController } | undefined
  let idleWaiters: Array<() => void> = []
  const runningStopConfirmations = new Map<string, Set<string>>()
  const pendingArchiveRegistrationRetries = new Set<string>()
  let pendingProgressPersistTimer: ReturnType<typeof setTimeout> | undefined

  function notifyIdle() {
    if (processing || summaryProcessing) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  function waitForIdle() {
    if (!processing && !summaryProcessing) return Promise.resolve()
    return new Promise<void>((resolve) => idleWaiters.push(resolve))
  }

  function persistNow() {
    if (pendingProgressPersistTimer) {
      clearTimeout(pendingProgressPersistTimer)
      pendingProgressPersistTimer = undefined
    }
    saveItems(items)
  }

  function publish(persist: 'immediate' | 'coalesced' = 'immediate'): VideoAudioTranscriptionQueueSnapshot {
    const snapshot = snapshotFromItems(items, sessionCompletedCount)
    if (persist === 'immediate') {
      persistNow()
    } else if (!pendingProgressPersistTimer) {
      pendingProgressPersistTimer = setTimeout(() => {
        pendingProgressPersistTimer = undefined
        saveItems(items)
      }, PROGRESS_PERSIST_THROTTLE_MS)
    }
    onSnapshot?.(snapshot)
    return snapshot
  }

  function updateItem(
    id: string,
    updater: (item: QueueItem) => QueueItem
  ) {
    items = items.map((item) => (item.id === id ? updater(item) : item))
  }

  function finishCanceled(id: string) {
    updateItem(id, (item) => item.cancelRequested
      ? { ...item, status: 'canceled', cancelRequested: undefined, progress: undefined, updatedAt: now() }
      : item)
  }

  async function processNext() {
    if (processing) {
      return
    }

    const next = items.find((item) => item.status === 'pending')
    if (!next) {
      return
    }

    processing = true
    activeController = new AbortController()
    updateItem(next.id, (item) => ({
      ...item,
      status: 'running',
      startedAt: now(),
      updatedAt: now(),
      errorMessage: undefined,
      errorDetails: undefined
    }))
    publish()

    try {
      const runningItem = items.find((item) => item.id === next.id) ?? next
      const result = await transcribe(runningItem, (progress) => {
        const current = items.find((item) => item.id === runningItem.id)
        if (current?.status !== 'running' || current.cancelRequested) return
        updateItem(runningItem.id, (item) => ({
          ...item,
          progress,
          ...(progress.actualDevice ? {
            actualDevice: progress.actualDevice,
            actualComputeType: progress.actualComputeType,
            runtimeFallbackMessage: progress.runtimeFallbackMessage
          } : {}),
          updatedAt: now()
        }))
        publish('coalesced')
      }, activeController.signal)
      if (items.find((item) => item.id === runningItem.id)?.cancelRequested) {
        finishCanceled(runningItem.id)
        return
      }
      if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return
      const completedAt = now()
      const transcriptOutcome = result.transcript.length === 0 ? 'no-speech' : undefined
      const note = createNoteFromQueueItem(runningItem, result.transcript, completedAt)
      updateItem(runningItem.id, (item) => ({
        ...item,
        draftNote: note,
        transcriptOutcome,
        ...(result.runtime ? {
          actualDevice: result.runtime.device,
          actualComputeType: result.runtime.computeType,
          runtimeFallbackMessage: result.runtime.fallbackMessage
        } : {}),
        progress: { step: 'generating-note', message: 'Generating note from transcript.' },
        updatedAt: now()
      }))
      publish()

      let summaryText = ''
      let summaryErrorMessage: string | undefined
      // Keep the pre-independent-summary contract for embedders that have not
      // supplied exact archive-version summary persistence yet. The Electron
      // production wiring supplies both callbacks and uses processNextSummary.
      if (!transcriptOutcome && runningItem.summarizeWithDeepSeek && summarizeNote && (!loadArchiveVersion || !saveArchiveSummary)) {
        const summaryController = new AbortController()
        activeSummaryController = { id: runningItem.id, controller: summaryController }
        updateItem(runningItem.id, (item) => ({
          ...item,
          draftNote: note,
          summaryStatus: 'generating',
          progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' },
          updatedAt: now()
        }))
        publish()
        try {
          const generatedSummary = await summarizeNote(note, summaryController.signal, (progress) => {
            if (summaryController.signal.aborted) return
            updateItem(runningItem.id, (item) => ({ ...item, progress, updatedAt: now() }))
            publish('coalesced')
          })
          if (summaryController.signal.aborted) {
            summaryErrorMessage = 'DeepSeek summary canceled.'
          } else {
            summaryText = generatedSummary.trim()
            if (!summaryText) summaryErrorMessage = 'DeepSeek summary returned empty content.'
          }
        } catch (error) {
          if (items.find((item) => item.id === runningItem.id)?.cancelRequested) {
            finishCanceled(runningItem.id)
            return
          }
          summaryErrorMessage = summaryController.signal.aborted ? 'DeepSeek summary canceled.' : createErrorMessage(error)
        } finally {
          if (activeSummaryController?.id === runningItem.id) activeSummaryController = undefined
        }
      }

      if (items.find((item) => item.id === runningItem.id)?.cancelRequested) {
        finishCanceled(runningItem.id)
        return
      }
      if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return

      updateItem(runningItem.id, (item) => ({
        ...item,
        progress: { step: 'saving-archive', message: 'Saving note to archive.' },
        updatedAt: now()
      }))
      publish()

      let registration: { archiveId: string; versionId: string } | undefined
      try {
        if (items.find((item) => item.id === runningItem.id)?.cancelRequested) {
          finishCanceled(runningItem.id)
          return
        }
        if (!await isAccountStillCurrent(runningItem.accountMid)) {
          throw new Error('The signed-in account changed before the archive could be saved.')
        }
        registration = saveArchiveVersion(note, summaryText)
        if (!registration?.archiveId || !registration.versionId) {
          throw new Error('Archive registration did not return an immutable archive identity.')
        }
      } catch (error) {
        updateItem(runningItem.id, (item) => ({
          ...item,
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
          draftNote: note,
          progress: { step: 'queue-completed', message: 'Transcription completed; archive registration needs retry.' },
          errorMessage: summaryErrorMessage,
          archiveRegistrationStatus: 'failed',
          archiveRegistrationError: createErrorMessage(error),
          archiveSummaryText: summaryText || undefined,
          transcriptOutcome,
          summaryStatus: !transcriptOutcome && runningItem.summarizeWithDeepSeek
            ? summaryErrorMessage ? 'failed' : summaryText ? 'saved' : 'queued'
            : 'not-requested',
          transcriptionDeviceOverride: undefined
        }))
        return
      }
      updateItem(runningItem.id, (item) => ({
        ...item,
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        archiveNoteId: registration.archiveId,
        archiveVersionId: registration.versionId,
        draftNote: !transcriptOutcome && runningItem.summarizeWithDeepSeek && !summaryText && !summaryErrorMessage ? note : undefined,
        progress: { step: 'queue-completed', message: 'Queued transcription completed.' },
        errorMessage: summaryErrorMessage,
        archiveRegistrationStatus: 'registered',
        archiveRegistrationError: undefined,
        archiveSummaryText: undefined,
        transcriptOutcome,
        summaryStatus: !transcriptOutcome && runningItem.summarizeWithDeepSeek
          ? summaryErrorMessage ? 'failed' : summaryText ? 'saved' : 'queued'
          : 'not-requested',
        transcriptionDeviceOverride: undefined
      }))
      sessionCompletedCount += 1
    } catch (error) {
      if (items.find((item) => item.id === next.id)?.cancelRequested) {
        finishCanceled(next.id)
        return
      }
      if (items.find((item) => item.id === next.id)?.status !== 'running') return
      const failedAt = now()
      updateItem(next.id, (item) => ({
        ...item,
        status: 'failed',
        updatedAt: failedAt,
        errorMessage: createErrorMessage(error),
        errorDetails: errorDetailsFor(error),
        failureKind: failureKindForError(error),
        transcriptionDeviceOverride: undefined
      }))
    } finally {
      processing = false
      activeController = undefined
      publish()
      if (items.some((item) => item.status === 'pending')) void processNext()
      void processNextSummary()
      notifyIdle()
    }
  }

  async function processNextSummary() {
    if (summaryProcessing) return
    const next = items.find((item) =>
      item.status === 'completed' &&
      item.archiveRegistrationStatus === 'registered' &&
      item.summaryStatus === 'queued'
    )
    if (!next) {
      notifyIdle()
      return
    }
    if (!next.archiveNoteId || !next.archiveVersionId || !saveArchiveSummary) {
      updateItem(next.id, (item) => ({
        ...item,
        summaryStatus: 'failed',
        errorMessage: 'DeepSeek summary storage is unavailable.',
        progress: { step: 'queue-completed', message: 'Queued transcription completed; summary needs retry.' },
        updatedAt: now()
      }))
      publish()
      void processNextSummary()
      return
    }
    const note = next.draftNote ?? loadArchiveVersion?.(next.archiveNoteId, next.archiveVersionId)
    if (!note || !matchesQueueItemArchiveIdentity(next, note)) {
      updateItem(next.id, (item) => ({
        ...item,
        summaryStatus: 'failed',
        errorMessage: 'The archived transcript version could not be verified for summary.',
        progress: { step: 'queue-completed', message: 'Queued transcription completed; summary needs retry.' },
        updatedAt: now()
      }))
      publish()
      void processNextSummary()
      return
    }

    summaryProcessing = true
    const summaryController = new AbortController()
    activeSummaryController = { id: next.id, controller: summaryController }
    updateItem(next.id, (item) => ({
      ...item,
      draftNote: note,
      summaryStatus: 'generating',
      errorMessage: undefined,
      progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' },
      updatedAt: now()
    }))
    publish()

    let generatedSummaryText = next.archiveSummaryText?.trim()
    try {
      if (!generatedSummaryText) {
        if (!summarizeNote) throw new Error('DeepSeek summary is unavailable.')
        const generated = await summarizeNote(note, summaryController.signal, (progress) => {
          if (summaryController.signal.aborted) return
          updateItem(next.id, (item) => ({ ...item, progress, updatedAt: now() }))
          publish('coalesced')
        })
        generatedSummaryText = generated.trim()
      }
      if (summaryController.signal.aborted) throw new Error('DeepSeek summary canceled.')
      if (!generatedSummaryText) throw new Error('DeepSeek summary returned empty content.')
      if (!await isAccountStillCurrent(next.accountMid)) {
        throw new Error('The signed-in account changed before the summary could be saved.')
      }
      saveArchiveSummary(next.archiveNoteId, next.archiveVersionId, note, generatedSummaryText)
      updateItem(next.id, (item) => ({
        ...item,
        draftNote: undefined,
        summaryStatus: 'saved',
        archiveSummaryText: undefined,
        progress: { step: 'queue-completed', message: 'Queued transcription completed.' },
        errorMessage: undefined,
        updatedAt: now()
      }))
    } catch (error) {
      const message = summaryController.signal.aborted ? 'DeepSeek summary canceled.' : createErrorMessage(error)
      updateItem(next.id, (item) => ({
        ...item,
        draftNote: undefined,
        summaryStatus: generatedSummaryText ? 'generated' : 'failed',
        archiveSummaryText: generatedSummaryText,
        progress: { step: 'queue-completed', message: 'Queued transcription completed; summary needs retry.' },
        errorMessage: message,
        updatedAt: now()
      }))
    } finally {
      if (activeSummaryController?.id === next.id) activeSummaryController = undefined
      summaryProcessing = false
      publish()
      void processNextSummary()
      notifyIdle()
    }
  }

  function enqueue(request: VideoAudioTranscriptionRequest): VideoAudioTranscriptionQueueSnapshot {
    const id = createQueueItemId(request)
    const existing = items.find((item) => item.id === id && matchesRequestRevision(item, request))

    if (existing?.status === 'completed' && existing.archiveRegistrationStatus === 'failed') {
      return retryArchiveRegistration(existing.id)
    }

    if (!existing || existing.status === 'completed') {
      const createdAt = now()
      items = [
        ...items,
        {
          ...request,
          transcriptionModelId: request.transcriptionModelId ?? modelForRequest(request),
          id: existing && existing.status === 'completed' ? `${id}:retry:${createdAt}` : id,
          status: 'pending',
          createdAt,
          updatedAt: createdAt
        }
      ]
    } else if (existing.status === 'failed' || existing.status === 'canceled') {
      updateItem(existing.id, (item) => ({
        ...item,
        status: 'pending',
        updatedAt: now(),
        errorMessage: undefined,
        errorDetails: undefined
      }))
    }

    const snapshot = publish()
    void processNext()
    return snapshot
  }

  function cancel(id: string): VideoAudioTranscriptionQueueSnapshot {
    const wasRunning = items.some((item) => item.id === id && item.status === 'running')
    updateItem(id, (item) =>
      item.status === 'pending'
        ? {
            ...item,
            status: 'canceled',
            updatedAt: now()
          }
        : item.status === 'running'
          ? {
              ...item,
              cancelRequested: true,
              progress: { step: 'canceling', message: 'Canceling transcription.' },
              updatedAt: now()
            }
        : item
    )
    if (wasRunning && items.some((item) => item.id === id && item.cancelRequested)) {
      activeController?.abort()
      if (activeSummaryController?.id === id) activeSummaryController.controller.abort()
    }

    return publish()
  }

  function retry(id: string): VideoAudioTranscriptionQueueSnapshot {
    updateItem(id, (item) =>
      item.status === 'failed' || item.status === 'canceled' || item.status === 'waiting-restart'
        ? {
            ...item,
            status: 'pending',
            updatedAt: now(),
            errorMessage: undefined,
            errorDetails: undefined,
            failureKind: undefined,
            progress: undefined
          }
        : item
    )
    const snapshot = publish()
    void processNext()
    return snapshot
  }

  function retryOnCpu(id: string): VideoAudioTranscriptionQueueSnapshot {
    updateItem(id, (item) =>
      item.status === 'failed' && item.failureKind === 'cuda-oom'
        ? {
            ...item,
            status: 'pending',
            transcriptionDeviceOverride: 'cpu',
            updatedAt: now(),
            errorMessage: undefined,
            errorDetails: undefined,
            failureKind: undefined,
            progress: undefined
          }
        : item
    )
    const snapshot = publish()
    void processNext()
    return snapshot
  }

  function retryArchiveRegistration(id: string): VideoAudioTranscriptionQueueSnapshot {
    const item = items.find((candidate) => candidate.id === id)
    if (
      pendingArchiveRegistrationRetries.has(id) ||
      !item ||
      item.status !== 'completed' ||
      item.archiveRegistrationStatus !== 'failed' ||
      !item.draftNote
    ) {
      return snapshotFromItems(items, sessionCompletedCount)
    }

    pendingArchiveRegistrationRetries.add(id)
    void (async () => {
      try {
        if (!await isAccountStillCurrent(item.accountMid)) {
          throw new Error('The signed-in account changed before the archive could be saved.')
        }
        const registration = saveArchiveVersion(item.draftNote!, item.archiveSummaryText ?? '')
        if (!registration?.archiveId || !registration.versionId) {
          throw new Error('Archive registration did not return an immutable archive identity.')
        }
        updateItem(id, (candidate) => ({
          ...candidate,
          archiveNoteId: registration.archiveId,
          archiveVersionId: registration.versionId,
          archiveRegistrationStatus: 'registered',
          archiveRegistrationError: undefined,
          archiveSummaryText: undefined,
          draftNote: candidate.summarizeWithDeepSeek && !candidate.archiveSummaryText?.trim()
            ? candidate.draftNote
            : undefined,
          summaryStatus: candidate.summarizeWithDeepSeek
            ? candidate.archiveSummaryText?.trim() ? 'saved' : 'queued'
            : 'not-requested',
          updatedAt: now()
        }))
        sessionCompletedCount += 1
      } catch (error) {
        updateItem(id, (candidate) => ({
          ...candidate,
          archiveRegistrationStatus: 'failed',
          archiveRegistrationError: createErrorMessage(error),
          updatedAt: now()
        }))
      } finally {
        pendingArchiveRegistrationRetries.delete(id)
        publish()
        void processNextSummary()
      }
    })()

    return snapshotFromItems(items, sessionCompletedCount)
  }

  function retrySummary(id: string): VideoAudioTranscriptionQueueSnapshot {
    const item = items.find((candidate) => candidate.id === id)
    if (
      !item ||
      item.status !== 'completed' ||
      item.archiveRegistrationStatus !== 'registered' ||
      !item.archiveNoteId ||
      !item.archiveVersionId ||
      !['failed', 'generated'].includes(item.summaryStatus ?? '') ||
      !loadArchiveVersion ||
      !saveArchiveSummary
    ) return snapshotFromItems(items, sessionCompletedCount)

    const archivedNote = loadArchiveVersion(item.archiveNoteId, item.archiveVersionId)
    if (!archivedNote || !matchesQueueItemArchiveIdentity(item, archivedNote)) {
      updateItem(id, (candidate) => ({
        ...candidate,
        summaryStatus: 'failed',
        errorMessage: 'The archived transcript version could not be verified for summary retry.',
        updatedAt: now()
      }))
      return publish()
    }

    updateItem(id, (candidate) => ({
      ...candidate,
      draftNote: archivedNote,
      summaryStatus: 'queued',
      errorMessage: undefined,
      progress: { step: 'queue-completed', message: 'Queued transcription completed; summary is waiting.' },
      updatedAt: now()
    }))
    const snapshot = publish()
    void processNextSummary()

    return snapshot
  }

  function result(overrides: Partial<Omit<VideoTranscriptionQueueBatchResult, 'snapshot'>> = {}): VideoTranscriptionQueueBatchResult {
    return {
      snapshot: publish(), affected: 0, canceled: 0, stopped: 0, retried: 0, started: 0, removed: 0, skipped: 0, ...overrides
    }
  }

  function cancelWaitingBatch(ids: string[]): VideoTranscriptionQueueBatchResult {
    const selected = new Set(ids)
    let canceled = 0
    let skipped = 0
    items = items.map((item) => {
      if (!selected.has(item.id)) return item
      if (item.status !== 'pending') {
        skipped += 1
        return item
      }
      canceled += 1
      return { ...item, status: 'canceled', updatedAt: now() }
    })
    return result({ affected: canceled, canceled, skipped })
  }

  function cancelWaitingForVideos(accountMid: string, targets: Array<number | VideoTranscriptionQueueVideoTarget>): VideoTranscriptionQueueBatchResult {
    const selectedTargets = normalizeVideoTargets(targets)
    const ids = items
      .filter((item) => item.accountMid === accountMid && item.aid !== undefined && selectedTargets.some((target) =>
        target.aid === item.aid && (target.cid === undefined || target.cid === item.cid)
      ))
      .map((item) => item.id)
    return cancelWaitingBatch(ids)
  }

  function cancelSummary(id: string): VideoAudioTranscriptionQueueSnapshot {
    const active = activeSummaryController
    const item = items.find((candidate) => candidate.id === id)
    // The compatibility path still keeps the queue item in `running` while
    // DeepSeek is summarizing. The independent-summary path is `completed`
    // with a separate summary status. Both states can be canceled here.
    if (!item || !['completed', 'running'].includes(item.status)) {
      return snapshotFromItems(items, sessionCompletedCount)
    }
    if (item.summaryStatus === 'queued') {
      updateItem(id, (candidate) => ({
        ...candidate,
        summaryStatus: 'failed',
        errorMessage: 'DeepSeek summary canceled.',
        progress: { step: 'queue-completed', message: 'Queued transcription completed; summary needs retry.' },
        updatedAt: now()
      }))
      return publish()
    }
    if (!active || active.id !== id || item.summaryStatus !== 'generating') return snapshotFromItems(items, sessionCompletedCount)
    active.controller.abort()
    updateItem(id, (candidate) => ({
      ...candidate,
      progress: { step: 'canceling-summary', message: 'Canceling DeepSeek summary.' },
      updatedAt: now()
    }))
    return publish()
  }

  function retryBatch(ids: string[]): VideoTranscriptionQueueBatchResult {
    const selected = new Set(ids)
    let retried = 0
    let skipped = 0
    items = items.map((item) => {
      if (!selected.has(item.id)) return item
      if (!['failed', 'canceled', 'waiting-restart'].includes(item.status)) {
        skipped += 1
        return item
      }
      retried += 1
      return { ...item, status: 'pending', updatedAt: now(), errorMessage: undefined, errorDetails: undefined, progress: undefined }
    })
    const batch = result({ affected: retried, retried, started: retried, skipped })
    if (retried) void processNext()
    return batch
  }

  function removeBatch(ids: string[]): VideoTranscriptionQueueBatchResult {
    const selected = new Set(ids)
    let removed = 0
    let skipped = 0
    items = items.filter((item) => {
      if (!selected.has(item.id)) return true
      if (item.status === 'running') {
        skipped += 1
        return true
      }
      removed += 1
      return false
    })
    return result({ affected: removed, removed, skipped })
  }

  function clearAccount(accountMid: string): VideoAudioTranscriptionQueueSnapshot {
    const normalized = accountMid.trim()
    items = items.filter((item) => item.accountMid !== normalized || item.status === 'running')
    return publish()
  }

  function createRunningStopConfirmation(ids: string[]) {
    const runningIds = new Set(items.filter((item) => ids.includes(item.id) && item.status === 'running').map((item) => item.id))
    const confirmationToken = `transcription-stop:${now()}:${Math.random().toString(36).slice(2)}`
    runningStopConfirmations.set(confirmationToken, runningIds)
    return { confirmationToken, runningCount: runningIds.size }
  }

  function stopRunningBatch(ids: string[], confirmationToken: string): VideoTranscriptionQueueBatchResult {
    const confirmed = runningStopConfirmations.get(confirmationToken)
    runningStopConfirmations.delete(confirmationToken)
    const selected = new Set(ids)
    let stopped = 0
    let skipped = 0
    items = items.map((item) => {
      if (!selected.has(item.id)) return item
      if (item.status !== 'running' || !confirmed?.has(item.id)) {
        skipped += 1
        return item
      }
      stopped += 1
      return {
        ...item,
        cancelRequested: true,
        progress: { step: 'canceling', message: 'Canceling transcription.' },
        updatedAt: now()
      }
    })
    if (stopped) {
      activeController?.abort()
    }
    return result({ affected: stopped, stopped, canceled: stopped, skipped })
  }

  async function cancelAllAndWait(): Promise<VideoAudioTranscriptionQueueSnapshot> {
    const activeId = items.find((item) => item.status === 'running')?.id
    items = items.map((item) => item.status === 'pending'
      ? { ...item, status: 'canceled', updatedAt: now() }
      : item.status === 'running'
        ? {
            ...item,
            cancelRequested: true,
            progress: { step: 'canceling', message: 'Canceling transcription.' },
            updatedAt: now()
          }
        : item.status === 'completed' && item.summaryStatus === 'queued'
          ? {
              ...item,
              summaryStatus: 'failed',
              errorMessage: 'DeepSeek summary canceled.',
              progress: { step: 'queue-completed', message: 'Queued transcription completed; summary needs retry.' },
              updatedAt: now()
            }
        : item)
    if (activeId) {
      activeController?.abort()
    }
    activeSummaryController?.controller.abort()
    publish()
    await waitForIdle()
    return snapshotFromItems(items, sessionCompletedCount)
  }

  if (items.some((item) => item.status === 'pending' || item.summaryStatus === 'queued')) {
    publish()
    queueMicrotask(() => {
      void processNext()
      void processNextSummary()
    })
  }

  return {
    getSnapshot: () => snapshotFromItems(items, sessionCompletedCount),
    enqueue,
    cancel,
    retry,
    retryOnCpu,
    retryArchiveRegistration,
    retrySummary,
    cancelWaitingBatch,
    cancelWaitingForVideos,
    cancelSummary,
    retryBatch,
    removeBatch,
    clearAccount,
    createRunningStopConfirmation,
    stopRunningBatch,
    cancelAllAndWait
  }
}
