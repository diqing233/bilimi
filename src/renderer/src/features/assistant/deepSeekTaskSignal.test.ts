import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDeepSeekTask, subscribeDeepSeekTasks } from './deepSeekTaskSignal'

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()
  static queuedDelivery = false
  onmessage: ((event: MessageEvent) => void) | null = null
  closed = false

  constructor(public readonly name: string) {
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>()
    channels.add(this)
    FakeBroadcastChannel.channels.set(name, channels)
  }

  postMessage(data: unknown) {
    if (this.closed) return
    const deliver = () => {
      if (this.closed) return
      for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
        if (channel !== this) {
          channel.onmessage?.({ data } as MessageEvent)
        }
      }
    }
    if (FakeBroadcastChannel.queuedDelivery) setTimeout(deliver, 0)
    else deliver()
  }

  close() {
    this.closed = true
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

describe('deepSeekTaskSignal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeBroadcastChannel.channels.clear()
    FakeBroadcastChannel.queuedDelivery = false
  })

  it('keeps concurrent DeepSeek tasks until their matching request finishes', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const received: string[][] = []
    const unsubscribe = subscribeDeepSeekTasks((tasks) =>
      received.push(tasks.map((task) => `${task.kind}:${task.detail ?? ''}`))
    )

    const finishSummary = publishDeepSeekTask({
      id: 'summary:BV1',
      kind: 'summary',
      detail: '文稿总结：视频一'
    })
    const finishClassification = publishDeepSeekTask({
      id: 'classification:BV2',
      kind: 'classification',
      detail: '分类二判：视频二'
    })
    finishSummary()

    expect(received).toEqual([
      ['summary:文稿总结：视频一'],
      ['summary:文稿总结：视频一', 'classification:分类二判：视频二'],
      ['classification:分类二判：视频二']
    ])

    finishClassification()
    expect(received.at(-1)).toEqual([])
    unsubscribe()
  })

  it('reports an already-running task to subscribers that open later', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const finishTask = publishDeepSeekTask({
      id: 'summary:late',
      kind: 'summary',
      detail: '文稿总结：先开始的视频'
    })
    const received: string[][] = []

    const unsubscribe = subscribeDeepSeekTasks((tasks) =>
      received.push(tasks.map((task) => task.id))
    )

    expect(received.at(-1)).toEqual(['summary:late'])
    finishTask()
    unsubscribe()
  })

  it('expires tasks whose publishing window disappears without finishing', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
      publishDeepSeekTask({ id: 'summary:orphan', kind: 'summary' })
      const received: string[][] = []
      const unsubscribe = subscribeDeepSeekTasks((tasks) =>
        received.push(tasks.map((task) => task.id))
      )

      const taskChannels = [...(FakeBroadcastChannel.channels.get('bilimi.deepseek-task') ?? [])]
      taskChannels[0]?.close()
      await vi.advanceTimersByTimeAsync(20_000)

      expect(received.at(-1)).toEqual([])
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('delivers the final task state before closing a queued Electron channel', async () => {
    vi.useFakeTimers()
    try {
      FakeBroadcastChannel.queuedDelivery = true
      vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
      const received: string[][] = []
      const unsubscribe = subscribeDeepSeekTasks((tasks) => received.push(tasks.map((task) => task.id)))
      const finishTask = publishDeepSeekTask({ id: 'archive-organize:100', kind: 'archive-organize' })

      await vi.advanceTimersByTimeAsync(0)
      expect(received.at(-1)).toEqual(['archive-organize:100'])

      finishTask()
      await vi.advanceTimersByTimeAsync(0)

      expect(received.at(-1)).toEqual([])
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })
})
