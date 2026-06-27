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

    expect(firstSnapshot.items[0]).toMatchObject({ status: 'pending', title: 'Queue video' })
    expect(secondSnapshot.items).toHaveLength(2)

    await flushMicrotasks()

    expect(transcribe).toHaveBeenCalledTimes(1)
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ title: 'Queue video' }), expect.any(Function))
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
    expect(store.save).toHaveBeenCalled()
    expect(snapshots.at(-1)?.activeItemId).toBeUndefined()
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
      })
    )
    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue'
      }),
      'DeepSeek summary text'
    )
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

  it('resumes unfinished persisted jobs after a restart', async () => {
    const restartedAt = '2026-06-25T00:00:10.000Z'
    const store = createStore([
      {
        ...createRequest(),
        id: 'bvid:BV1queue',
        status: 'running',
        createdAt: '2026-06-25T00:00:00.000Z',
        startedAt: '2026-06-25T00:00:01.000Z',
        updatedAt: '2026-06-25T00:00:05.000Z',
        progress: { step: 'transcribing-segment', message: 'Transcribing segment.' }
      },
      {
        ...createRequest({
          url: 'https://www.bilibili.com/video/BV2queue',
          title: 'Second video',
          bvid: 'BV2queue'
        }),
        id: 'bvid:BV2queue',
        status: 'pending',
        createdAt: '2026-06-25T00:00:06.000Z',
        updatedAt: '2026-06-25T00:00:06.000Z'
      }
    ])
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        transcript: createTranscript('resumed transcript'),
        transcriptSource: 'audio'
      })
      .mockReturnValueOnce(second.promise)
    const saveArchiveVersion = vi.fn()

    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe,
      saveArchiveVersion,
      now: () => restartedAt
    })

    expect(queue.getSnapshot().items[0]).toMatchObject({
      id: 'bvid:BV1queue',
      status: 'pending',
      updatedAt: restartedAt,
      progress: undefined,
      errorMessage: undefined
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ id: 'bvid:BV1queue' }), expect.any(Function))
    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining<Partial<VideoNote>>({
        id: 'bvid:BV1queue',
        transcript: createTranscript('resumed transcript')
      }),
      ''
    )
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      progress: { step: 'queue-completed' }
    })
    expect(queue.getSnapshot().items[1].status).toBe('running')

    second.resolve({ transcript: createTranscript('second transcript'), transcriptSource: 'audio' })
    await flushMicrotasks()
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
