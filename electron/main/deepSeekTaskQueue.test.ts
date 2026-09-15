import { describe, expect, it } from 'vitest'
import { createDeepSeekTaskQueue } from './deepSeekTaskQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('deep seek task queue', () => {
  it('runs DeepSeek requests one at a time', async () => {
    const queue = createDeepSeekTaskQueue()
    const first = deferred<string>()
    const order: string[] = []

    const firstResult = queue.run(async () => {
      order.push('first:start')
      const result = await first.promise
      order.push('first:end')
      return result
    })
    const secondResult = queue.run(async () => {
      order.push('second:start')
      order.push('second:end')
      return 'second'
    })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    first.resolve('first')
    await expect(firstResult).resolves.toBe('first')
    await expect(secondResult).resolves.toBe('second')
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('does not start a task aborted while waiting', async () => {
    const queue = createDeepSeekTaskQueue()
    const first = deferred<void>()
    const controller = new AbortController()
    let started = false

    const firstResult = queue.run(() => first.promise)
    const secondResult = queue.run(() => {
      started = true
      return Promise.resolve('never')
    }, controller.signal)
    controller.abort()
    first.resolve()

    await expect(firstResult).resolves.toBeUndefined()
    await expect(secondResult).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBe(false)
  })
})
