import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishDeepSeekTask, subscribeDeepSeekTask } from './deepSeekTaskSignal'

class FakeBroadcastChannel {
  static channels = new Map<string, Set<FakeBroadcastChannel>>()
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(public readonly name: string) {
    const channels = FakeBroadcastChannel.channels.get(name) ?? new Set<FakeBroadcastChannel>()
    channels.add(this)
    FakeBroadcastChannel.channels.set(name, channels)
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel !== this) {
        channel.onmessage?.({ data } as MessageEvent)
      }
    }
  }

  close() {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

describe('deepSeekTaskSignal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeBroadcastChannel.channels.clear()
  })

  it('broadcasts DeepSeek task changes across renderer windows', () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const received: Array<string | null> = []
    const unsubscribe = subscribeDeepSeekTask((task) => received.push(task))

    publishDeepSeekTask('pet-chat')
    publishDeepSeekTask(null)

    expect(received).toEqual(['pet-chat', null])
    unsubscribe()
  })
})
