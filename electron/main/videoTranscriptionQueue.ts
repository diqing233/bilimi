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

type VideoTranscriptionQueue = {
  getSnapshot: () => VideoAudioTranscriptionQueueSnapshot
  enqueue: (request: VideoAudioTranscriptionRequest) => VideoAudioTranscriptionQueueSnapshot
  cancel: (id: string) => VideoAudioTranscriptionQueueSnapshot
  retry: (id: string) => VideoAudioTranscriptionQueueSnapshot
}

function createQueueItemId(request: VideoAudioTranscriptionRequest): string {
  const account = request.accountMid?.trim() ? `account:${request.accountMid.trim()}:` : ''
  return request.bvid ? `${account}bvid:${request.bvid}` : `${account}url:${request.url}`
}

function createErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Audio transcription failed.'
}

function createNoteFromQueueItem(
  item: VideoAudioTranscriptionQueueItem,
  transcript: TranscriptSegment[],
  now: string
): VideoNote {
  return createLocalVideoNoteDraft({
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
}

function snapshotFromItems(
  items: VideoAudioTranscriptionQueueItem[],
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
  let items = loadItems()
  if (items.length > 0) {
    items = []
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
    updater: (item: VideoAudioTranscriptionQueueItem) => VideoAudioTranscriptionQueueItem
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

      saveArchiveVersion(note, summaryText)
      updateItem(runningItem.id, (item) => ({
        ...item,
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        archiveNoteId: note.id,
        draftNote: undefined,
        progress: { step: 'queue-completed', message: 'Queued transcription completed.' },
        errorMessage: summaryErrorMessage
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
    const existing = items.find((item) => item.id === id)

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
      item.status === 'failed' || item.status === 'canceled'
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
    retry
  }
}

