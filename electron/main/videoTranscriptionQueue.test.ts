import { describe, expect, it, vi } from 'vitest'
import type {
  TranscriptSegment,
  VideoAudioTranscriptionQueueItem,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoNote
} from '../../src/shared/types'
import { createVideoTranscriptionQueue } from './videoTranscriptionQueue'

function createRequest(overrides: Partial<VideoAudioTranscriptionRequest> = {}): VideoAudioTranscriptionRequest {
  return {
    url: 'https://www.bilibili.com/video/BV1queue',
    title: 'Queue video',
    bvid: 'BV1queue',
    ...overrides
  }
}

function createTranscript(text: string): TranscriptSegment[] {
  return [{ start: 0, end: 8, text }]
}

function createStore(initial: VideoAudioTranscriptionQueueItem[] = []) {
  let items = initial

  return {
    load: vi.fn(() => items),
    save: vi.fn((nextItems: VideoAudioTranscriptionQueueItem[]) => {
      items = nextItems
    }),
    current: () => items
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('video transcription queue', () => {
  it('returns the current running snapshot when enqueue starts processing immediately', () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn(() => new Promise<never>(() => undefined)),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    const snapshot = queue.enqueue(createRequest())

    expect(snapshot).toEqual(queue.getSnapshot())
    expect(snapshot).toMatchObject({
      activeItemId: 'bvid:BV1queue',
      items: [expect.objectContaining({ status: 'running' })]
    })
  })

  it('runs enqueued jobs serially and saves completed notes into the archive', async () => {
    const first = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const saveArchiveVersion = vi.fn()
    const store = createStore()
    const snapshots: VideoAudioTranscriptionQueueSnapshot[] = []
    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe,
      saveArchiveVersion,
      now: vi
        .fn()
        .mockReturnValueOnce('2026-06-25T00:00:00.000Z')
        .mockReturnValueOnce('2026-06-25T00:00:01.000Z')
        .mockReturnValueOnce('2026-06-25T00:00:02.000Z')
        .mockReturnValueOnce('2026-06-25T00:00:03.000Z'),
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    const firstSnapshot = queue.enqueue(createRequest())
    const secondSnapshot = queue.enqueue(
      createRequest({
        url: 'https://www.bilibili.com/video/BV2queue',
        title: 'Second video',
        bvid: 'BV2queue'
      })
    )

    expect(firstSnapshot.items[0]).toMatchObject({ status: 'running', title: 'Queue video' })
    expect(secondSnapshot.items).toHaveLength(2)

    await flushMicrotasks()

    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Queue video' }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'pending'])

    first.resolve({ transcript: createTranscript('first transcript'), transcriptSource: 'audio' })
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue',
        transcript: createTranscript('first transcript'),
        transcriptSource: 'audio'
      }),
      ''
    )
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['completed', 'running'])

    second.resolve({ transcript: createTranscript('second transcript'), transcriptSource: 'audio' })
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['completed', 'completed'])
    expect(queue.getSnapshot().sessionCompletedCount).toBe(2)
    expect(store.save).toHaveBeenCalled()
    expect(snapshots.at(-1)?.activeItemId).toBeUndefined()
    expect(snapshots.at(-1)?.sessionCompletedCount).toBe(2)
  })

  it('keeps the request author on queued archive notes', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('author transcript'),
      transcriptSource: 'audio'
    })
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ author: '李老师讲AI' }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        source: expect.objectContaining({
          author: '李老师讲AI'
        })
      }),
      ''
    )
  })

  it('generates and saves DeepSeek summary text only for jobs that request auto summary', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('summary transcript'),
      transcriptSource: 'audio'
    })
    const summarizeNote = vi.fn().mockResolvedValue('DeepSeek summary text')
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(summarizeNote).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue',
        transcript: createTranscript('summary transcript')
      }),
      expect.any(AbortSignal)
    )
    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue'
      }),
      'DeepSeek summary text'
    )
  })

  it('saves the transcript and completes the job when DeepSeek summary fails', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('transcript survives summary failure'),
      transcriptSource: 'audio'
    })
    const summarizeNote = vi.fn().mockRejectedValue(new Error('DeepSeek is not configured.'))
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue',
        transcript: createTranscript('transcript survives summary failure')
      }),
      ''
    )
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      errorMessage: 'DeepSeek is not configured.',
      progress: { step: 'queue-completed' }
    })
  })

  it('publishes progress through DeepSeek summary and queue completion stages', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('summary transcript'),
      transcriptSource: 'audio'
    })
    const summarizeNote = vi.fn().mockResolvedValue('DeepSeek summary text')
    const snapshots: VideoAudioTranscriptionQueueSnapshot[] = []
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z',
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(snapshots.map((snapshot) => snapshot.items[0]?.progress?.step)).toContain(
      'summarizing-deepseek'
    )
    const summarizingSnapshot = snapshots.find(
      (snapshot) => snapshot.items[0]?.progress?.step === 'summarizing-deepseek'
    )
    expect(summarizingSnapshot?.items[0]?.draftNote).toMatchObject({
      id: 'bvid:BV1queue',
      transcript: createTranscript('summary transcript'),
      transcriptSource: 'audio'
    })
    expect(snapshots.at(-1)?.items[0]).toMatchObject({
      status: 'completed',
      progress: { step: 'queue-completed' }
    })
  })

  it('starts the session completion count at zero instead of deriving it from loaded items', () => {
    const transcribe = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore([
      {
        ...createRequest(),
        id: 'bvid:BV1queue',
        status: 'completed',
        createdAt: '2026-06-25T00:00:00.000Z',
        completedAt: '2026-06-25T00:00:05.000Z',
        updatedAt: '2026-06-25T00:00:05.000Z',
        progress: { step: 'queue-completed', message: 'Queued transcription completed.' }
      }
      ]).load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn()
    })

    expect(queue.getSnapshot()).toMatchObject({
      sessionCompletedCount: 0,
      items: [expect.objectContaining({ status: 'completed' })]
    })
    expect(transcribe).not.toHaveBeenCalled()
  })

  it('saves queued notes without summary text when auto summary is not requested', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('plain transcript'),
      transcriptSource: 'audio'
    })
    const summarizeNote = vi.fn()
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(summarizeNote).not.toHaveBeenCalled()
    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue'
      }),
      ''
    )
  })

  it('marks failed jobs and continues with the next pending item', async () => {
    const first = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    queue.enqueue(
      createRequest({
        url: 'https://www.bilibili.com/video/BV2queue',
        title: 'Second',
        bvid: 'BV2queue'
      })
    )
    await flushMicrotasks()

    first.reject(new Error('Audio download failed.'))
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'Audio download failed.'
    })
    expect(queue.getSnapshot().items[1].status).toBe('running')

    second.resolve({ transcript: createTranscript('second'), transcriptSource: 'audio' })
    await flushMicrotasks()

    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['failed', 'completed'])
    expect(queue.getSnapshot().sessionCompletedCount).toBe(1)
  })

  it('counts only jobs that finish after their archive is saved successfully', async () => {
    const saveArchiveVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Archive save failed.')
      })
      .mockImplementationOnce(() => undefined)
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('retry transcript'),
        transcriptSource: 'audio'
      }),
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
    queue.enqueue(createRequest())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot()).toMatchObject({
      sessionCompletedCount: 0,
      items: [expect.objectContaining({ status: 'failed' })]
    })

    queue.retry('bvid:BV1queue')
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot()).toMatchObject({
      sessionCompletedCount: 1,
      items: [expect.objectContaining({ status: 'completed' })]
    })
  })

  it('counts a new successful job for the same video again within the session', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('repeat transcript'),
        transcriptSource: 'audio'
      }),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    await flushMicrotasks()
    await flushMicrotasks()
    queue.enqueue(createRequest())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot().sessionCompletedCount).toBe(2)
  })

  it('aborts a running job, marks it canceled, and continues with the next pending item', async () => {
    const firstStarted = createDeferred<void>()
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi
      .fn()
      .mockImplementationOnce(
        (_request, _progress, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')))
            firstStarted.resolve()
          })
      )
      .mockReturnValueOnce(second.promise)
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    queue.enqueue(
      createRequest({
        url: 'https://www.bilibili.com/video/BV2queue',
        title: 'Second',
        bvid: 'BV2queue'
      })
    )
    await firstStarted.promise

    queue.cancel('bvid:BV1queue')
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled' })
    expect(queue.getSnapshot().items[1]).toMatchObject({ status: 'running' })
    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
    expect(transcribe).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'bvid:BV1queue' }),
      expect.any(Function),
      expect.any(AbortSignal)
    )

    second.resolve({ transcript: createTranscript('second'), transcriptSource: 'audio' })
    await flushMicrotasks()
  })

  it('cancels a running DeepSeek summary without archiving the canceled item', async () => {
    const summaryStarted = createDeferred<void>()
    const summarizeNote = vi.fn(
      (_note: VideoNote, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError')))
          summaryStarted.resolve()
        })
    )
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('summary transcript'),
        transcriptSource: 'audio'
      }),
      summarizeNote,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await summaryStarted.promise

    queue.cancel('bvid:BV1queue')
    await flushMicrotasks()

    expect(summarizeNote).toHaveBeenCalledWith(expect.any(Object), expect.any(AbortSignal))
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled' })
    expect(saveArchiveVersion).not.toHaveBeenCalled()
  })

  it('does not duplicate a video that is already pending or running', async () => {
    const first = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi.fn().mockReturnValue(first.promise)
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    queue.enqueue(createRequest())
    await flushMicrotasks()
    queue.enqueue(createRequest())

    expect(queue.getSnapshot().items).toHaveLength(1)
    expect(queue.getSnapshot().items[0]).toMatchObject({
      id: 'bvid:BV1queue',
      status: 'running'
    })
    expect(transcribe).toHaveBeenCalledOnce()

    first.resolve({ transcript: createTranscript('first'), transcriptSource: 'audio' })
    await flushMicrotasks()
  })
})
