import type {
  TranscriptSegment,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionQueueItem,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote
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
  summarizeNote?: (note: VideoNote, signal?: AbortSignal) => Promise<string>
  saveArchiveVersion: (note: VideoNote, summaryText: string) => unknown
  now?: () => string
  onSnapshot?: (snapshot: VideoAudioTranscriptionQueueSnapshot) => void
}

type QueueItem = VideoAudioTranscriptionQueueItem

type VideoTranscriptionQueue = {
  getSnapshot: () => VideoAudioTranscriptionQueueSnapshot
  enqueue: (request: VideoAudioTranscriptionRequest) => VideoAudioTranscriptionQueueSnapshot
  cancel: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retry: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retryArchiveRegistration: (id: string) => VideoAudioTranscriptionQueueSnapshot
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

function createErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Audio transcription failed.'
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
  now = () => new Date().toISOString(),
  onSnapshot
}: QueueDeps): VideoTranscriptionQueue {
  let items: QueueItem[] = loadItems()
  // A completed transcript with an unregistered archive is safe to resume without audio work.
  const resumableRegistrationItems = items.filter((item) =>
    item.status === 'waiting-restart' ||
    (item.status === 'completed' && item.archiveRegistrationStatus === 'failed' && item.draftNote)
  )
  if (items.length > 0 && resumableRegistrationItems.length !== items.length) {
    items = resumableRegistrationItems
    saveItems(items)
  }
  let sessionCompletedCount = 0
  let processing = false
  let activeController: AbortController | undefined

  function publish(): VideoAudioTranscriptionQueueSnapshot {
    const snapshot = snapshotFromItems(items, sessionCompletedCount)
    saveItems(items)
    onSnapshot?.(snapshot)
    return snapshot
  }

  function updateItem(
    id: string,
    updater: (item: QueueItem) => QueueItem
  ) {
    items = items.map((item) => (item.id === id ? updater(item) : item))
  }

  async function processNext() {
    if (processing || items.some((item) => item.status === 'running')) {
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
      errorMessage: undefined
    }))
    publish()

    try {
      const runningItem = items.find((item) => item.id === next.id) ?? next
      const result = await transcribe(runningItem, (progress) => {
        if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return
        updateItem(runningItem.id, (item) => ({
          ...item,
          progress,
          updatedAt: now()
        }))
        publish()
      }, activeController.signal)
      if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return
      const completedAt = now()
      const note = createNoteFromQueueItem(runningItem, result.transcript, completedAt)
      updateItem(runningItem.id, (item) => ({
        ...item,
        draftNote: note,
        progress: { step: 'generating-note', message: 'Generating note from transcript.' },
        updatedAt: now()
      }))
      publish()

      let summaryText = ''
      let summaryErrorMessage: string | undefined
      if (runningItem.summarizeWithDeepSeek && summarizeNote) {
        updateItem(runningItem.id, (item) => ({
          ...item,
          draftNote: note,
          progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' },
          updatedAt: now()
        }))
        publish()
        try {
          summaryText = await summarizeNote(note, activeController.signal)
        } catch (error) {
          if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return
          summaryErrorMessage = createErrorMessage(error)
        }
      }
      if (items.find((item) => item.id === runningItem.id)?.status !== 'running') return

      updateItem(runningItem.id, (item) => ({
        ...item,
        progress: { step: 'saving-archive', message: 'Saving note to archive.' },
        updatedAt: now()
      }))
      publish()

      try {
        saveArchiveVersion(note, summaryText)
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
          archiveSummaryText: summaryText
        }))
        sessionCompletedCount += 1
        return
      }
      updateItem(runningItem.id, (item) => ({
        ...item,
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        archiveNoteId: note.id,
        draftNote: undefined,
        progress: { step: 'queue-completed', message: 'Queued transcription completed.' },
        errorMessage: summaryErrorMessage,
        archiveRegistrationStatus: 'registered',
        archiveRegistrationError: undefined,
        archiveSummaryText: undefined
      }))
      sessionCompletedCount += 1
    } catch (error) {
      if (items.find((item) => item.id === next.id)?.status !== 'running') return
      const failedAt = now()
      updateItem(next.id, (item) => ({
        ...item,
        status: 'failed',
        updatedAt: failedAt,
        errorMessage: createErrorMessage(error)
      }))
    } finally {
      processing = false
      activeController = undefined
      publish()
      void processNext()
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
        errorMessage: undefined
      }))
    }

    const snapshot = publish()
    void processNext()
    return snapshot
  }

  function cancel(id: string): VideoAudioTranscriptionQueueSnapshot {
    const wasRunning = items.some((item) => item.id === id && item.status === 'running')
    updateItem(id, (item) =>
      item.status === 'pending' || item.status === 'running'
        ? {
            ...item,
            status: 'canceled',
            updatedAt: now()
          }
        : item
    )
    if (wasRunning && items.some((item) => item.id === id && item.status === 'canceled')) {
      activeController?.abort()
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
    if (!item || item.status !== 'completed' || item.archiveRegistrationStatus !== 'failed' || !item.draftNote) {
      return snapshotFromItems(items, sessionCompletedCount)
    }

    try {
      saveArchiveVersion(item.draftNote, item.archiveSummaryText ?? '')
      updateItem(id, (candidate) => ({
        ...candidate,
        archiveNoteId: item.draftNote?.id,
        archiveRegistrationStatus: 'registered',
        archiveRegistrationError: undefined,
        archiveSummaryText: undefined,
        draftNote: undefined,
        updatedAt: now()
      }))
    } catch (error) {
      updateItem(id, (candidate) => ({
        ...candidate,
        archiveRegistrationStatus: 'failed',
        archiveRegistrationError: createErrorMessage(error),
        updatedAt: now()
      }))
    }

    return publish()
  }

  if (items.some((item) => item.status === 'pending')) {
    publish()
    queueMicrotask(() => {
      void processNext()
    })
  }

  return {
    getSnapshot: () => snapshotFromItems(items, sessionCompletedCount),
    enqueue,
    cancel,
    retry,
    retryArchiveRegistration
  }
}
