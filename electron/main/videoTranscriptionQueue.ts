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
    progress: (progress: VideoAudioTranscriptionProgress) => void
  ) => Promise<VideoAudioTranscriptionResult>
  saveArchiveVersion: (note: VideoNote) => unknown
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
  return request.bvid ? `bvid:${request.bvid}` : `url:${request.url}`
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
      title: item.title,
      bvid: item.bvid,
      url: item.url,
      tags: []
    },
    transcript,
    transcriptSource: 'audio'
  })
}

function snapshotFromItems(items: VideoAudioTranscriptionQueueItem[]): VideoAudioTranscriptionQueueSnapshot {
  return {
    items,
    activeItemId: items.find((item) => item.status === 'running')?.id
  }
}

export function createVideoTranscriptionQueue({
  loadItems,
  saveItems,
  transcribe,
  saveArchiveVersion,
  now = () => new Date().toISOString(),
  onSnapshot
}: QueueDeps): VideoTranscriptionQueue {
  let items = loadItems()
  let processing = false

  function publish(): VideoAudioTranscriptionQueueSnapshot {
    const snapshot = snapshotFromItems(items)
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
        updateItem(runningItem.id, (item) => ({
          ...item,
          progress,
          updatedAt: now()
        }))
        publish()
      })
      const completedAt = now()
      const note = createNoteFromQueueItem(runningItem, result.transcript, completedAt)

      saveArchiveVersion(note)
      updateItem(runningItem.id, (item) => ({
        ...item,
        status: 'completed',
        completedAt,
        updatedAt: completedAt,
        archiveNoteId: note.id,
        progress: { step: 'generating-note', message: 'Saved note to archive.' },
        errorMessage: undefined
      }))
    } catch (error) {
      const failedAt = now()
      updateItem(next.id, (item) => ({
        ...item,
        status: 'failed',
        updatedAt: failedAt,
        errorMessage: createErrorMessage(error)
      }))
    } finally {
      processing = false
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
    updateItem(id, (item) =>
      item.status === 'pending'
        ? {
            ...item,
            status: 'canceled',
            updatedAt: now()
          }
        : item
    )

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

  return {
    getSnapshot: () => snapshotFromItems(items),
    enqueue,
    cancel,
    retry
  }
}

