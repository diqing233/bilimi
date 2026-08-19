import { describe, expect, it, vi } from 'vitest'
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
import { createVideoTranscriptionQueue } from './videoTranscriptionQueue'
import { createTranscriptionProviderResolver } from './transcriptionProviderResolver'
import {
  createFasterWhisperHelperSessionPool,
  transcribeAudioSegmentWithFasterWhisper
} from './fasterWhisperTranscription'
import type { SegmentTranscriber } from './transcriptionProviderResolver'

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

function createSnapshot(
  snapshot: Omit<VideoAudioTranscriptionQueueSnapshot, 'sessionCompletedCount'> & {
    sessionCompletedCount?: number
  }
): VideoAudioTranscriptionQueueSnapshot {
  return {
    sessionCompletedCount: 0,
    ...snapshot
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

async function flushNestedMicrotasks(): Promise<void> {
  for (let count = 0; count < 8; count += 1) await Promise.resolve()
}

describe('video transcription queue', () => {
  it('removes only the settled records belonging to one deleted account', () => {
    const store = createStore([
      { ...createRequest({ accountMid: '100', aid: 1 }), id: 'account:100:aid:1', status: 'completed', createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z' },
      { ...createRequest({ accountMid: '200', aid: 2 }), id: 'account:200:aid:2', status: 'completed', createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z' }
    ])
    const queue = createVideoTranscriptionQueue({
      loadItems: store.load, saveItems: store.save,
      transcribe: vi.fn(), saveArchiveVersion: vi.fn()
    })

    const snapshot = queue.clearAccount('100')

    expect(snapshot.items.map((item) => item.accountMid)).toEqual(['200'])
    expect(store.current().map((item) => item.accountMid)).toEqual(['200'])
  })
  it('completes and archives an empty transcript without asking DeepSeek to summarize it', async () => {
    const summarizeNote = vi.fn().mockResolvedValue('must not run')
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: 'archive-no-speech', versionId: 'version-no-speech' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: [], transcriptSource: 'audio' }),
      summarizeNote,
      saveArchiveVersion,
      now: () => '2026-07-29T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushNestedMicrotasks()

    expect(summarizeNote).not.toHaveBeenCalled()
    expect(saveArchiveVersion).toHaveBeenCalledWith(expect.objectContaining({ transcript: [] }), '')
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      transcriptOutcome: 'no-speech',
      summaryStatus: 'not-requested',
      archiveRegistrationStatus: 'registered'
    })
  })

  it('starts the next local transcription while the previous archived part is summarized', async () => {
    const firstSummary = createDeferred<string>()
    const transcribe = vi.fn()
      .mockResolvedValueOnce({ transcript: createTranscript('P1 文稿'), transcriptSource: 'audio' as const })
      .mockResolvedValueOnce({ transcript: createTranscript('P2 文稿'), transcriptSource: 'audio' as const })
    const saveArchiveVersion = vi.fn()
      .mockReturnValueOnce({ archiveId: 'account:42:aid:7:cid:70', versionId: 'p1-version' })
      .mockReturnValueOnce({ archiveId: 'account:42:aid:7:cid:71', versionId: 'p2-version' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote: vi.fn(() => firstSummary.promise),
      saveArchiveVersion,
      loadArchiveVersion: vi.fn(),
      saveArchiveSummary: vi.fn(),
      now: () => '2026-08-19T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70, summarizeWithDeepSeek: true }))
    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 71 }))
    await flushNestedMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ aid: 7, cid: 70 }) }),
      ''
    )
    expect(transcribe).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'account:42:aid:7:cid:70', status: 'completed', summaryStatus: 'generating' }),
      expect.objectContaining({ id: 'account:42:aid:7:cid:71', status: 'completed' })
    ]))

    firstSummary.resolve('P1 DeepSeek 总结')
    await flushNestedMicrotasks()
  })

  it('coalesces durable writes for consecutive raw progress updates', async () => {
    vi.useFakeTimers()
    try {
      const running = createDeferred<VideoAudioTranscriptionResult>()
      let reportProgress: ((progress: VideoAudioTranscriptionProgress) => void) | undefined
      const saveItems = vi.fn()
      const queue = createVideoTranscriptionQueue({
        loadItems: createStore().load,
        saveItems,
        transcribe: vi.fn((_request, progress) => {
          reportProgress = progress
          return running.promise
        }),
        saveArchiveVersion: vi.fn()
      })

      queue.enqueue(createRequest())
      await flushMicrotasks()
      saveItems.mockClear()

      reportProgress?.({ step: 'downloading-audio', message: 'first' })
      reportProgress?.({ step: 'preparing-segments', message: 'latest' })

      expect(saveItems).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(saveItems).toHaveBeenCalledTimes(1)
      expect(saveItems).toHaveBeenLastCalledWith([
        expect.objectContaining({ progress: { step: 'preparing-segments', message: 'latest' } })
      ])

      running.reject(new Error('stop test job'))
      await flushMicrotasks()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels only waiting items in a batch and leaves running work untouched', async () => {
    const running = createDeferred<VideoAudioTranscriptionResult>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(running.promise),
      saveArchiveVersion: vi.fn().mockReturnValue({ archiveId: 'archive-second', versionId: 'version-second' }),
      now: () => '2026-07-26T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ bvid: 'BV1running' }))
    queue.enqueue(createRequest({ bvid: 'BV1waiting' }))
    await flushMicrotasks()

    const result = queue.cancelWaitingBatch(['bvid:BV1running', 'bvid:BV1waiting'])

    expect(result).toMatchObject({ affected: 1, canceled: 1, stopped: 0, skipped: 1 })
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'canceled'])
    running.resolve({ transcript: createTranscript('done'), transcriptSource: 'audio' })
  })

  it('records a CUDA OOM as a failed job that can only be retried with an explicit CPU override', async () => {
    const gpuOutOfMemory = Object.assign(new Error('CUDA out of memory.'), { kind: 'cuda-oom' })
    const transcribe = vi.fn()
      .mockRejectedValueOnce(gpuOutOfMemory)
      .mockResolvedValueOnce({ transcript: createTranscript('CPU retry'), transcriptSource: 'audio' as const })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-27T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'failed', failureKind: 'cuda-oom' })

    const retryOnCpu = (queue as unknown as { retryOnCpu: (id: string) => VideoAudioTranscriptionQueueSnapshot }).retryOnCpu
    retryOnCpu('bvid:BV1queue')
    expect(transcribe).toHaveBeenLastCalledWith(
      expect.objectContaining({ transcriptionDeviceOverride: 'cpu' }),
      expect.any(Function),
      expect.any(AbortSignal)
    )
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      transcriptionDeviceOverride: undefined
    })
  })

  it('cancels only pending records for one account and selected library video ids', async () => {
    const running = createDeferred<VideoAudioTranscriptionResult>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(running.promise),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-26T00:00:00.000Z'
    })
    queue.enqueue(createRequest({ accountMid: '100', aid: 1, bvid: 'BV1running' }))
    queue.enqueue(createRequest({ accountMid: '100', aid: 2, bvid: 'BV2pending' }))
    queue.enqueue(createRequest({ accountMid: '200', aid: 2, bvid: 'BV2other-account' }))
    await flushMicrotasks()

    expect(queue.cancelWaitingForVideos('100', [1, 2])).toMatchObject({ canceled: 1, skipped: 1 })
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'canceled', 'pending'])
    running.resolve({ transcript: createTranscript('done'), transcriptSource: 'audio' })
  })

  it('cancels only the selected account, video, and part identity', async () => {
    const running = createDeferred<VideoAudioTranscriptionResult>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(running.promise),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-27T00:00:00.000Z'
    })
    queue.enqueue(createRequest({ accountMid: '100', aid: 1, cid: 10, bvid: 'BV1part10' }))
    queue.enqueue(createRequest({ accountMid: '100', aid: 1, cid: 11, bvid: 'BV1part11' }))
    queue.enqueue(createRequest({ accountMid: '100', aid: 1, cid: 12, bvid: 'BV1part12' }))
    await flushMicrotasks()

    expect((queue as unknown as {
      cancelWaitingForVideos(accountMid: string, targets: Array<{ aid: number; cid: number }>): unknown
    }).cancelWaitingForVideos('100', [{ aid: 1, cid: 11 }])).toMatchObject({ canceled: 1, skipped: 0 })
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'canceled', 'pending'])
    running.resolve({ transcript: createTranscript('done'), transcriptSource: 'audio' })
  })

  it('cancels only DeepSeek summary generation and retains the generated transcript', async () => {
    const summary = createDeferred<string>()
    let summarySignal: AbortSignal | undefined
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: 'account:42:aid:7', versionId: 'version-recovered' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('keep this transcript'), transcriptSource: 'audio' }),
      summarizeNote: vi.fn((_note: VideoNote, signal?: AbortSignal) => {
        summarySignal = signal
        return summary.promise
      }),
      saveArchiveVersion,
      now: () => '2026-07-27T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'running', progress: { step: 'summarizing-deepseek' } })

    ;(queue as unknown as { cancelSummary(id: string): unknown }).cancelSummary('bvid:BV1queue')
    expect(summarySignal?.aborted).toBe(true)
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'running',
      progress: { step: 'canceling-summary', message: 'Canceling DeepSeek summary.' }
    })
    summary.reject(new Error('aborted'))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(expect.objectContaining({ transcript: createTranscript('keep this transcript') }), '')
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      errorMessage: 'DeepSeek summary canceled.'
    })
  })

  it('requires a separate token before stopping a running batch task and removes records without archives', async () => {
    const running = createDeferred<VideoAudioTranscriptionResult>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(running.promise),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-26T00:00:00.000Z'
    })
    queue.enqueue(createRequest({ bvid: 'BV1running' }))
    queue.enqueue(createRequest({ bvid: 'BV1removable' }))
    await flushMicrotasks()

    expect(queue.stopRunningBatch(['bvid:BV1running'], 'invalid')).toMatchObject({ stopped: 0, skipped: 1 })
    const confirmation = queue.createRunningStopConfirmation(['bvid:BV1running'])
    expect(confirmation.runningCount).toBe(1)
    expect(queue.stopRunningBatch(['bvid:BV1running'], confirmation.confirmationToken)).toMatchObject({ stopped: 1, canceled: 1 })
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'running',
      cancelRequested: true,
      progress: { step: 'canceling', message: 'Canceling transcription.' }
    })
    queue.cancelWaitingBatch(['bvid:BV1removable'])
    expect(queue.removeBatch(['bvid:BV1removable'])).toMatchObject({ removed: 1, affected: 1 })
    expect(queue.getSnapshot().items).not.toContainEqual(expect.objectContaining({ id: 'bvid:BV1removable' }))
    running.resolve({ transcript: createTranscript('done'), transcriptSource: 'audio' })
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled', cancelRequested: undefined })
  })
  it('runs enqueued jobs serially and saves completed notes into the archive', async () => {
    const first = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: 'archive-serial', versionId: 'version-serial' })
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
    expect(store.save).toHaveBeenCalled()
    expect(snapshots.at(-1)?.activeItemId).toBeUndefined()
    expect(queue.getSnapshot().sessionCompletedCount).toBe(2)
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
      expect.any(AbortSignal),
      expect.any(Function)
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

  it('treats an empty DeepSeek response as a summary failure while preserving the archived transcript', async () => {
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: 'archive-empty-summary', versionId: 'version-empty-summary' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('transcript remains available'), transcriptSource: 'audio' }),
      summarizeNote: vi.fn().mockResolvedValue('   '),
      saveArchiveVersion,
      now: () => '2026-07-23T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70, summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(expect.anything(), '')
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'registered',
      archiveNoteId: 'archive-empty-summary',
      archiveVersionId: 'version-empty-summary',
      errorMessage: 'DeepSeek summary returned empty content.'
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

  it('publishes faithful proofreading progress while summarizing a queued note', async () => {
    const snapshots: VideoAudioTranscriptionQueueSnapshot[] = []
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('summary transcript'), transcriptSource: 'audio' }),
      summarizeNote: vi.fn().mockImplementation(async (_note, _signal, onProgress) => {
        onProgress?.({ step: 'summarizing-deepseek', message: '正在保真校对 1/2' })
        return 'summary'
      }),
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-26T00:00:00.000Z',
      onSnapshot: (snapshot) => snapshots.push(snapshot)
    })

    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(snapshots.some((snapshot) => snapshot.items[0]?.progress?.message === '正在保真校对 1/2')).toBe(true)
  })

  it('does not resume unfinished persisted jobs after a restart', () => {
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
    const transcribe = vi.fn()
    const saveArchiveVersion = vi.fn()

    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:10.000Z'
    })

    expect(queue.getSnapshot()).toEqual(createSnapshot({ items: [] }))
    expect(transcribe).not.toHaveBeenCalled()
    expect(saveArchiveVersion).not.toHaveBeenCalled()
    expect(store.current()).toEqual([])
  })

  it('keeps completed records across restart until they are explicitly removed', () => {
    const store = createStore([{
      ...createRequest(),
      id: 'bvid:BV1queue',
      status: 'completed',
      createdAt: '2026-07-26T00:00:00.000Z',
      completedAt: '2026-07-26T00:01:00.000Z',
      updatedAt: '2026-07-26T00:01:00.000Z',
      archiveNoteId: 'bvid:BV1queue'
    }])

    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe: vi.fn(),
      saveArchiveVersion: vi.fn().mockReturnValue({ archiveId: 'archive-before-restart', versionId: 'version-before-restart' })
    })

    expect(queue.getSnapshot().items).toEqual([
      expect.objectContaining({ id: 'bvid:BV1queue', status: 'completed' })
    ])
    expect(queue.removeBatch(['bvid:BV1queue'])).toMatchObject({ removed: 1 })
    expect(store.current()).toEqual([])
  })

  it('requires an explicit retry before an imported waiting-restart job is resumed', async () => {
    const request = createRequest()
    const store = createStore([{
      ...request,
      id: 'bvid:BV1queue',
      status: 'waiting-restart',
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:01:00.000Z'
    }])
    const transcribe = vi.fn().mockResolvedValue({ transcript: createTranscript('resumed') })
    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-24T00:02:00.000Z'
    })

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'waiting-restart' })
    expect(transcribe).not.toHaveBeenCalled()

    queue.retry('bvid:BV1queue')
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1))
  })

  it('keeps a completed transcript with failed archive registration across restart for registration-only retry', async () => {
    const draftNote = {
      id: 'account:42:aid:7:cid:70',
      source: {
        accountMid: '42', aid: 7, cid: 70, bvid: 'BV1queue',
        title: 'Queue video', url: 'https://www.bilibili.com/video/BV1queue', tags: []
      },
      transcriptSource: 'audio' as const, transcript: createTranscript('persisted transcript'), chapters: [],
      overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] }, annotations: [], userMemo: '',
      createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z'
    }
    const store = createStore([{
      ...createRequest({ accountMid: '42', aid: 7, cid: 70 }), id: 'account:42:aid:7:cid:70',
      status: 'completed', createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:01.000Z',
      completedAt: '2026-07-23T00:00:01.000Z', draftNote, archiveSummaryText: 'persisted summary',
      archiveRegistrationStatus: 'failed', archiveRegistrationError: 'Archive storage is unavailable.'
    }])
    const transcribe = vi.fn()
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: draftNote.id, versionId: 'version-recovered' })
    const queue = createVideoTranscriptionQueue({
      loadItems: store.load, saveItems: store.save, transcribe, saveArchiveVersion,
      now: () => '2026-07-23T00:00:02.000Z'
    })

    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed', archiveRegistrationStatus: 'failed', draftNote
    })
    queue.retryArchiveRegistration('account:42:aid:7:cid:70')
    await flushNestedMicrotasks()

    expect(transcribe).not.toHaveBeenCalled()
    expect(saveArchiveVersion).toHaveBeenCalledWith(draftNote, 'persisted summary')
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed', archiveRegistrationStatus: 'registered', draftNote: undefined
    })
  })

  it('cancels a running job with an abort signal and does not continue failed processing', async () => {
    let runningSignal: AbortSignal | undefined
    let reportProgress: ((progress: VideoAudioTranscriptionProgress) => void) | undefined
    const running = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi.fn(
      (
        _request: VideoAudioTranscriptionRequest,
        progress: (progress: VideoAudioTranscriptionProgress) => void,
        signal?: AbortSignal
      ) => {
        runningSignal = signal
        reportProgress = progress
        return running.promise
      }
    )
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion,
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'running' })
    const canceled = queue.cancel('bvid:BV1queue')

    expect(runningSignal?.aborted).toBe(true)
    expect(canceled.items[0]).toMatchObject({
      status: 'running',
      cancelRequested: true,
      progress: { step: 'canceling', message: 'Canceling transcription.' }
    })
    reportProgress?.({ step: 'transcribing-segment', message: 'Late worker progress.' })
    expect(queue.getSnapshot().items[0]).toMatchObject({
      progress: { step: 'canceling', message: 'Canceling transcription.' }
    })

    running.reject(new Error('Process canceled.'))
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled' })
    expect(saveArchiveVersion).not.toHaveBeenCalled()
    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
  })

  it('treats a completion that races a requested cancellation as canceled', async () => {
    const running = createDeferred<VideoAudioTranscriptionResult>()
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(running.promise),
      saveArchiveVersion
    })
    queue.enqueue(createRequest())
    await flushMicrotasks()

    queue.cancel('bvid:BV1queue')
    running.resolve({ transcript: createTranscript('late result'), transcriptSource: 'audio' })
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled', cancelRequested: undefined })
    expect(saveArchiveVersion).not.toHaveBeenCalled()
  })

  it('does not archive a note when full cancellation races DeepSeek summary work', async () => {
    const summary = createDeferred<string>()
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('saved draft'), transcriptSource: 'audio' }),
      summarizeNote: vi.fn().mockReturnValue(summary.promise),
      saveArchiveVersion
    })
    queue.enqueue(createRequest({ summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()

    queue.cancel('bvid:BV1queue')
    summary.resolve('late summary')
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'canceled', cancelRequested: undefined })
    expect(saveArchiveVersion).not.toHaveBeenCalled()
  })

  it('cancels active and queued jobs before destructive maintenance completes', async () => {
    let runningSignal: AbortSignal | undefined
    const running = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi.fn((_request: VideoAudioTranscriptionRequest, _progress: (progress: never) => void, signal?: AbortSignal) => {
      runningSignal = signal
      return running.promise
    })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load, saveItems: vi.fn(), transcribe, saveArchiveVersion: vi.fn()
    })
    queue.enqueue(createRequest())
    queue.enqueue(createRequest({ bvid: 'BV2maintenance', title: 'Queued', url: 'https://www.bilibili.com/video/BV2maintenance' }))
    await flushMicrotasks()

    const maintenance = queue.cancelAllAndWait()
    expect(runningSignal?.aborted).toBe(true)
    expect(queue.getSnapshot().items).toMatchObject([
      {
        status: 'running',
        cancelRequested: true,
        progress: { step: 'canceling', message: 'Canceling transcription.' }
      },
      { status: 'canceled' }
    ])
    running.reject(new Error('Process canceled.'))
    await expect(maintenance).resolves.toMatchObject({ items: [{ status: 'canceled' }, { status: 'canceled' }] })
    expect(transcribe).toHaveBeenCalledTimes(1)
  })

  it('does not abort the running job when canceling a pending job', async () => {
    let runningSignal: AbortSignal | undefined
    const running = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi.fn(
      (
        _request: VideoAudioTranscriptionRequest,
        _progress: (progress: never) => void,
        signal?: AbortSignal
      ) => {
        runningSignal = signal
        return running.promise
      }
    )
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-06-25T00:00:00.000Z'
    })

    queue.enqueue(createRequest())
    queue.enqueue(createRequest({ bvid: 'BV2queue', title: 'Second', url: 'https://www.bilibili.com/video/BV2queue' }))
    await flushMicrotasks()

    queue.cancel('bvid:BV2queue')

    expect(runningSignal?.aborted).toBe(false)
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'canceled'])

    running.resolve({ transcript: createTranscript('first'), transcriptSource: 'audio' })
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

  it('captures the selected model when a job is enqueued and preserves it on retry', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockRejectedValue(new Error('failed')),
      saveArchiveVersion: vi.fn(),
      modelForRequest: () => 'faster-whisper-large-v3-turbo',
      now: () => '2026-07-27T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42' }))
    await flushMicrotasks()
    queue.retry(queue.getSnapshot().items[0]!.id)

    expect(queue.getSnapshot().items[0]).toMatchObject({ transcriptionModelId: 'faster-whisper-large-v3-turbo' })
  })

  it('runs mixed captured models serially while reusing the matching model runtime', async () => {
    type HelperOutput = { segments: Array<{ start?: number; end?: number; text?: string }> }
    const pendingHelperRequests: Array<ReturnType<typeof createDeferred<HelperOutput>>> = []
    const helperSessions: Array<{ transcribe: (audioPath: string, signal?: AbortSignal) => Promise<HelperOutput>; close: () => void; closed: Promise<void> }> = []
    const startSession: NonNullable<NonNullable<Parameters<typeof createFasterWhisperHelperSessionPool>[0]>['startSession']> = () => {
      const transcribe = vi.fn((..._args: [string, AbortSignal?]): Promise<HelperOutput> => {
        const pending = createDeferred<HelperOutput>()
        pendingHelperRequests.push(pending)
        return pending.promise
      })
      const session = {
        transcribe,
        close: () => undefined,
        closed: new Promise<void>(() => {})
      }
      helperSessions.push(session)
      return session
    }
    const helperPool = createFasterWhisperHelperSessionPool({
      startSession,
      idleTimeoutMs: 60_000
    })
    const resolveProvider = createTranscriptionProviderResolver({
      resolveFasterWhisperPaths: (model) => ({ helperPath: 'faster-whisper.exe', modelDirectory: `C:/models/${model}` }),
      resolveFasterWhisperRuntime: async () => ({ device: 'cpu', computeType: 'int8' }),
      transcribeFasterWhisper: (input) => transcribeAudioSegmentWithFasterWhisper({ ...input, helperSessionPool: helperPool })
    })
    const runs: TranscriptionModelId[] = []
    const transcribe = vi.fn(async (request: VideoAudioTranscriptionRequest) => {
      const model = request.transcriptionModelId
      if (!model) throw new Error('The queue must capture a transcription model before execution.')
      runs.push(model)
      const runner = resolveProvider(model) as SegmentTranscriber
      const transcript = await runner({ path: `${request.bvid}.wav`, offsetSeconds: 0 })
      return { transcript, transcriptSource: 'audio' as const, runtime: await runner.runtime }
    })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-27T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ bvid: 'BV1turbo-one', transcriptionModelId: 'faster-whisper-large-v3-turbo' }))
    queue.enqueue(createRequest({ bvid: 'BV1large', transcriptionModelId: 'faster-whisper-large-v3' }))
    queue.enqueue(createRequest({ bvid: 'BV1turbo-two', transcriptionModelId: 'faster-whisper-large-v3-turbo' }))
    await flushMicrotasks()

    expect(runs).toEqual(['faster-whisper-large-v3-turbo'])
    expect(helperSessions).toHaveLength(1)
    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['running', 'pending', 'pending'])

    pendingHelperRequests.shift()?.resolve({ segments: [{ start: 0, end: 8, text: 'first' }] })
    await flushNestedMicrotasks()
    expect(runs).toEqual(['faster-whisper-large-v3-turbo', 'faster-whisper-large-v3'])
    expect(helperSessions).toHaveLength(2)

    pendingHelperRequests.shift()?.resolve({ segments: [{ start: 0, end: 8, text: 'second' }] })
    await flushNestedMicrotasks()
    expect(runs).toEqual([
      'faster-whisper-large-v3-turbo',
      'faster-whisper-large-v3',
      'faster-whisper-large-v3-turbo'
    ])
    expect(helperSessions).toHaveLength(2)
    expect(helperSessions[0]?.transcribe).toHaveBeenCalledTimes(2)

    pendingHelperRequests.shift()?.resolve({ segments: [{ start: 0, end: 8, text: 'third' }] })
    await flushNestedMicrotasks()

    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['completed', 'completed', 'completed'])
    helperPool.dispose()
  })

  it('marks failed jobs and continues with the next pending item', async () => {
    const first = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const second = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
      saveArchiveVersion: vi.fn().mockReturnValue({ archiveId: 'archive-second', versionId: 'version-second' }),
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
      errorMessage: '音频下载失败，请检查网络后重试。'
    })
    expect(queue.getSnapshot().items[1].status).toBe('running')

    second.resolve({ transcript: createTranscript('second'), transcriptSource: 'audio' })
    await flushMicrotasks()

    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(['failed', 'completed'])
    expect(queue.getSnapshot().sessionCompletedCount).toBe(1)
  })

  it('keeps audio preparation diagnostics while showing a concise format-conversion failure', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockRejectedValue(new Error(
        'Audio preparation failed: ffmpeg exited with 1. input=C:/tmp/source.m4a size=42. Invalid data found when processing input'
      )),
      saveArchiveVersion: vi.fn()
    })

    queue.enqueue(createRequest())
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'failed',
      errorMessage: '音频格式转换失败',
      errorDetails: 'Audio preparation failed: ffmpeg exited with 1. input=[redacted-path] size=42. Invalid data found when processing input'
    })
  })

  it('resets the completed session count when a new app-process queue is created', async () => {
    const firstQueue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('completed before restart'),
        transcriptSource: 'audio'
      }),
      saveArchiveVersion: vi.fn().mockReturnValue({ archiveId: 'archive-before-restart', versionId: 'version-before-restart' })
    })
    firstQueue.enqueue(createRequest())
    await flushMicrotasks()
    await flushMicrotasks()

    expect(firstQueue.getSnapshot().sessionCompletedCount).toBe(1)

    const restartedQueue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn(),
      saveArchiveVersion: vi.fn()
    })

    expect(restartedQueue.getSnapshot().sessionCompletedCount).toBe(0)
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

  it('retains a successful transcript when archive registration fails and retries only registration', async () => {
    const store = createStore()
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('transcript survives archive registration failure'),
      transcriptSource: 'audio'
    })
    const saveArchiveVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Archive storage is unavailable.')
      })
      .mockReturnValueOnce({ archiveId: 'account:42:aid:7:cid:70', versionId: 'version-recovered' })
    const queue = createVideoTranscriptionQueue({
      loadItems: store.load,
      saveItems: store.save,
      transcribe,
      saveArchiveVersion,
      now: () => '2026-07-23T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70, metadataRevision: 3 }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'failed',
      archiveRegistrationError: 'Archive storage is unavailable.',
      draftNote: expect.objectContaining({ transcript: createTranscript('transcript survives archive registration failure') })
    })
    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
    expect(transcribe).toHaveBeenCalledOnce()

    queue.retryArchiveRegistration('account:42:aid:7:cid:70')
    await flushMicrotasks()

    expect(transcribe).toHaveBeenCalledOnce()
    expect(saveArchiveVersion).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'registered',
      archiveNoteId: 'account:42:aid:7:cid:70',
      draftNote: undefined
    })
    expect(queue.getSnapshot().sessionCompletedCount).toBe(1)
  })

  it('does not retry archive registration after the owning account changes', async () => {
    const accountCheck = createDeferred<boolean>()
    const draftNote = {
      id: 'account:42:aid:7:cid:70',
      source: { accountMid: '42', aid: 7, cid: 70, bvid: 'BV1queue', title: 'Queue video', url: 'https://www.bilibili.com/video/BV1queue', tags: [] },
      transcriptSource: 'audio', transcript: createTranscript('retryable transcript'), chapters: [],
      overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
      annotations: [], userMemo: '', starred: false,
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
    } as VideoNote
    const saveArchiveVersion = vi.fn().mockReturnValue({
      archiveId: 'account:42:aid:7:cid:70',
      versionId: 'version-1'
    })
    const queue = createVideoTranscriptionQueue({
      loadItems: () => [{
        ...createRequest({ accountMid: '42', aid: 7, cid: 70 }),
        id: 'account:42:aid:7:cid:70', status: 'completed', archiveRegistrationStatus: 'failed', draftNote,
        createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }],
      saveItems: vi.fn(), transcribe: vi.fn(), saveArchiveVersion,
      isAccountStillCurrent: () => accountCheck.promise
    })

    queue.retryArchiveRegistration('account:42:aid:7:cid:70')
    await flushMicrotasks()
    accountCheck.resolve(false)
    await flushNestedMicrotasks()

    expect(saveArchiveVersion).not.toHaveBeenCalled()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'failed',
      archiveRegistrationError: 'The signed-in account changed before the archive could be saved.'
    })
    expect(queue.getSnapshot().items[0].archiveNoteId).toBeUndefined()
    expect(queue.getSnapshot().items[0].archiveVersionId).toBeUndefined()
    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
  })

  it('serializes concurrent archive registration retries while account verification is pending', async () => {
    const accountCheck = createDeferred<boolean>()
    const draftNote = {
      id: 'account:42:aid:7:cid:70',
      source: { accountMid: '42', aid: 7, cid: 70, bvid: 'BV1queue', title: 'Queue video', url: 'https://www.bilibili.com/video/BV1queue', tags: [] },
      transcriptSource: 'audio', transcript: createTranscript('retryable transcript'), chapters: [],
      overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
      annotations: [], userMemo: '', starred: false,
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
    } as VideoNote
    const saveArchiveVersion = vi.fn().mockReturnValue({
      archiveId: 'account:42:aid:7:cid:70',
      versionId: 'version-1'
    })
    const queue = createVideoTranscriptionQueue({
      loadItems: () => [{
        ...createRequest({ accountMid: '42', aid: 7, cid: 70 }),
        id: 'account:42:aid:7:cid:70', status: 'completed', archiveRegistrationStatus: 'failed', draftNote,
        createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }],
      saveItems: vi.fn(), transcribe: vi.fn(), saveArchiveVersion,
      isAccountStillCurrent: () => accountCheck.promise
    })

    queue.retryArchiveRegistration('account:42:aid:7:cid:70')
    queue.retryArchiveRegistration('account:42:aid:7:cid:70')
    await flushMicrotasks()
    accountCheck.resolve(true)
    await flushNestedMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledOnce()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      archiveRegistrationStatus: 'registered',
      archiveNoteId: 'account:42:aid:7:cid:70',
      archiveVersionId: 'version-1'
    })
    expect(queue.getSnapshot().sessionCompletedCount).toBe(1)
  })

  it('does not publish archive registration as successful when persistence returns no immutable identity', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('a transcript that must remain retryable'),
        transcriptSource: 'audio'
      }),
      saveArchiveVersion: vi.fn().mockReturnValue(undefined),
      now: () => '2026-07-23T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70 }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'failed',
      archiveRegistrationError: 'Archive registration did not return an immutable archive identity.',
      draftNote: expect.objectContaining({ transcript: createTranscript('a transcript that must remain retryable') })
    })
  })

  it('retries only a failed DeepSeek summary after its transcript has a fixed archive identity', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('already archived transcript'),
      transcriptSource: 'audio'
    })
    const summarizeNote = vi.fn()
      .mockRejectedValueOnce(new Error('DeepSeek is temporarily unavailable.'))
      .mockResolvedValueOnce('recovered summary')
    const saveArchiveVersion = vi.fn().mockReturnValue({ archiveId: 'bvid:BV1queue', versionId: 'version-1' })
    const archivedNote = {
      id: 'account:42:aid:7:cid:70',
      source: {
        accountMid: '42', aid: 7, cid: 70, bvid: 'BV1queue',
        title: 'Queue video', url: 'https://www.bilibili.com/video/BV1queue', tags: []
      },
      transcriptSource: 'audio', transcript: createTranscript('already archived transcript'), chapters: [],
      overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
      annotations: [], userMemo: '', starred: false, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
    } as VideoNote
    const saveArchiveSummary = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      summarizeNote,
      saveArchiveVersion,
      loadArchiveVersion: vi.fn(() => archivedNote),
      saveArchiveSummary,
      now: () => '2026-07-27T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70, summarizeWithDeepSeek: true }))
    await flushNestedMicrotasks()

    expect(queue.getSnapshot().items[0]).toMatchObject({
      archiveRegistrationStatus: 'registered',
      archiveNoteId: 'bvid:BV1queue',
      archiveVersionId: 'version-1',
      summaryStatus: 'failed'
    })

    const retrySummary = (queue as unknown as { retrySummary: (id: string) => void }).retrySummary
    retrySummary('account:42:aid:7:cid:70')
    await flushNestedMicrotasks()

    expect(transcribe).toHaveBeenCalledOnce()
    expect(summarizeNote).toHaveBeenCalledTimes(2)
    expect(saveArchiveVersion).toHaveBeenCalledOnce()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      archiveRegistrationStatus: 'registered',
      archiveNoteId: 'bvid:BV1queue',
      archiveVersionId: 'version-1',
      summaryStatus: 'saved'
    })
    expect(saveArchiveSummary).toHaveBeenCalledWith('bvid:BV1queue', 'version-1', archivedNote, 'recovered summary')
  })

  it('refuses a summary-only retry when the reread archive version belongs to a different video identity', async () => {
    const summarizeNote = vi.fn().mockResolvedValue('must not run')
    const saveArchiveSummary = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: () => [{
        ...createRequest({ accountMid: '42', aid: 7, cid: 70, summarizeWithDeepSeek: true }),
        id: 'account:42:aid:7:cid:70', status: 'completed', archiveRegistrationStatus: 'registered',
        archiveNoteId: 'bvid:BV1queue', archiveVersionId: 'version-1', summaryStatus: 'failed',
        createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }],
      saveItems: vi.fn(), transcribe: vi.fn(), summarizeNote, saveArchiveVersion: vi.fn(), saveArchiveSummary,
      loadArchiveVersion: vi.fn(() => ({
        id: 'wrong-note', source: { accountMid: '99', aid: 7, cid: 71, bvid: 'BV1wrong', title: 'Wrong video', url: '', tags: [] },
        transcriptSource: 'audio', transcript: createTranscript('wrong'), chapters: [],
        overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
        annotations: [], userMemo: '', starred: false,
        createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }) as VideoNote)
    })

    queue.retrySummary('account:42:aid:7:cid:70')

    expect(summarizeNote).not.toHaveBeenCalled()
    expect(saveArchiveSummary).not.toHaveBeenCalled()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'completed', summaryStatus: 'failed' })
  })

  it('does not save a generated summary after the owning account changes during retry', async () => {
    const summary = createDeferred<string>()
    const archivedNote = {
      id: 'account:42:aid:7:cid:70',
      source: { accountMid: '42', aid: 7, cid: 70, bvid: 'BV1queue', title: 'Queue video', url: 'https://www.bilibili.com/video/BV1queue', tags: [] },
      transcriptSource: 'audio', transcript: createTranscript('already archived transcript'), chapters: [],
      overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
      annotations: [], userMemo: '', starred: false,
      createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
    } as VideoNote
    let accountStillCurrent = true
    const saveArchiveSummary = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: () => [{
        ...createRequest({ accountMid: '42', aid: 7, cid: 70, summarizeWithDeepSeek: true }),
        id: 'account:42:aid:7:cid:70', status: 'completed', archiveRegistrationStatus: 'registered',
        archiveNoteId: 'bvid:BV1queue', archiveVersionId: 'version-1', summaryStatus: 'failed',
        createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z'
      }],
      saveItems: vi.fn(), transcribe: vi.fn(), saveArchiveVersion: vi.fn(),
      summarizeNote: vi.fn(() => summary.promise),
      loadArchiveVersion: vi.fn(() => archivedNote), saveArchiveSummary,
      isAccountStillCurrent: () => accountStillCurrent
    })

    queue.retrySummary('account:42:aid:7:cid:70')
    await flushMicrotasks()
    accountStillCurrent = false
    summary.resolve('summary generated before account switch')
    await flushNestedMicrotasks()

    expect(saveArchiveSummary).not.toHaveBeenCalled()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: 'completed', summaryStatus: 'generated' })
  })

  it('does not register an archive after the owning account changes during transcription', async () => {
    const transcription = createDeferred<VideoAudioTranscriptionResult>()
    let accountStillCurrent = true
    const saveArchiveVersion = vi.fn().mockReturnValue({
      archiveId: 'account:42:aid:7:cid:70',
      versionId: 'version-1'
    })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockReturnValue(transcription.promise),
      saveArchiveVersion,
      isAccountStillCurrent: () => accountStillCurrent
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70 }))
    await flushMicrotasks()
    accountStillCurrent = false
    transcription.resolve({ transcript: createTranscript('transcribed before account switch'), transcriptSource: 'audio' })
    await flushNestedMicrotasks()

    expect(saveArchiveVersion).not.toHaveBeenCalled()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: 'completed',
      archiveRegistrationStatus: 'failed',
      archiveRegistrationError: 'The signed-in account changed before the archive could be saved.'
    })
    expect(queue.getSnapshot().items[0].archiveNoteId).toBeUndefined()
    expect(queue.getSnapshot().items[0].archiveVersionId).toBeUndefined()
    expect(queue.getSnapshot().sessionCompletedCount).toBe(0)
  })

  it('retries archive registration instead of retranscribing when the same request is enqueued again', async () => {
    const transcribe = vi.fn().mockResolvedValue({
      transcript: createTranscript('already transcribed'),
      transcriptSource: 'audio'
    })
    const saveArchiveVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Archive storage is unavailable.')
      })
      .mockReturnValueOnce({ archiveId: 'account:42:aid:7:cid:70', versionId: 'version-recovered' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion,
      now: () => '2026-07-23T00:00:00.000Z'
    })
    const request = createRequest({ accountMid: '42', aid: 7, cid: 70, metadataRevision: 3 })

    queue.enqueue(request)
    await flushMicrotasks()
    await flushMicrotasks()
    queue.enqueue(request)
    await flushNestedMicrotasks()

    expect(transcribe).toHaveBeenCalledOnce()
    expect(saveArchiveVersion).toHaveBeenCalledTimes(2)
    expect(queue.getSnapshot().items).toHaveLength(1)
    expect(queue.getSnapshot().items[0]).toMatchObject({ archiveRegistrationStatus: 'registered' })
  })

  it('keeps the generated summary for archive registration retry', async () => {
    const saveArchiveVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('Archive storage is unavailable.')
      })
      .mockReturnValueOnce({ archiveId: 'account:42:aid:7', versionId: 'version-recovered' })
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({
        transcript: createTranscript('summary survives registration failure'),
        transcriptSource: 'audio'
      }),
      summarizeNote: vi.fn().mockResolvedValue('summary survives registration failure'),
      saveArchiveVersion,
      now: () => '2026-07-23T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, summarizeWithDeepSeek: true }))
    await flushMicrotasks()
    await flushMicrotasks()
    queue.retryArchiveRegistration('account:42:aid:7')
    await flushNestedMicrotasks()

    expect(saveArchiveVersion).toHaveBeenLastCalledWith(expect.anything(), 'summary survives registration failure')
  })

  it('deduplicates the same account, aid, cid, and metadata revision', async () => {
    const running = createDeferred<{ transcript: TranscriptSegment[]; transcriptSource: 'audio' }>()
    const transcribe = vi.fn().mockReturnValue(running.promise)
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe,
      saveArchiveVersion: vi.fn(),
      now: () => '2026-07-23T00:00:00.000Z'
    })

    const request = createRequest({ accountMid: '42', aid: 7, cid: 70, metadataRevision: 3 })
    queue.enqueue(request)
    queue.enqueue(request)
    await flushMicrotasks()

    expect(queue.getSnapshot().items).toHaveLength(1)
    expect(queue.getSnapshot().items[0]?.id).toBe('account:42:aid:7:cid:70')

    queue.enqueue({ ...request, metadataRevision: 4 })

    expect(queue.getSnapshot().items).toHaveLength(2)
    expect(queue.getSnapshot().items[1]).toMatchObject({ metadataRevision: 4, status: 'pending' })

    running.resolve({ transcript: createTranscript('first'), transcriptSource: 'audio' })
    await flushMicrotasks()
  })

  it('persists the queued video and part identity into its saved archive note', async () => {
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('part identity'), transcriptSource: 'audio' }),
      saveArchiveVersion,
      now: () => '2026-07-23T00:00:00.000Z'
    })

    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70 }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ accountMid: '42', aid: 7, cid: 70 })
    }), '')
  })

  it('normalizes numeric request identities before saving an archive note', async () => {
    const saveArchiveVersion = vi.fn()
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('numeric identity'), transcriptSource: 'audio' }),
      saveArchiveVersion
    })
    queue.enqueue(createRequest({ accountMid: '42', aid: '7', cid: '70' }))
    await flushMicrotasks()
    await flushMicrotasks()

    expect(saveArchiveVersion).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ aid: 7, cid: 70 })
    }), '')
  })

  it('pins the archive version registered by a completed queue item', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('pinned version'), transcriptSource: 'audio' }),
      saveArchiveVersion: vi.fn().mockReturnValue({ archiveId: 'account:42:aid:7:cid:70', versionId: 'version-1' })
    })
    queue.enqueue(createRequest({ accountMid: '42', aid: 7, cid: 70 }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      archiveNoteId: 'account:42:aid:7:cid:70', archiveVersionId: 'version-1'
    })
  })

  it('records the actual runtime device selected for a completed job', async () => {
    const queue = createVideoTranscriptionQueue({
      loadItems: createStore().load,
      saveItems: vi.fn(),
      transcribe: vi.fn().mockResolvedValue({ transcript: createTranscript('runtime'), transcriptSource: 'audio', runtime: { device: 'cuda', computeType: 'float16' } }),
      saveArchiveVersion: vi.fn()
    })
    queue.enqueue(createRequest({ transcriptionModelId: 'faster-whisper-large-v3' }))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(queue.getSnapshot().items[0]).toMatchObject({ actualDevice: 'cuda', actualComputeType: 'float16' })
  })
})
