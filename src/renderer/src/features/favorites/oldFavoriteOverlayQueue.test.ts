import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteOverlayQueue } from './oldFavoriteOverlayQueue'

describe('OldFavoriteOverlayQueue', () => {
  it('isolates coalesced patches by account and batch and retries after a failed write', async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined)
    const queue = new OldFavoriteOverlayQueue(write)

    queue.enqueue('42', 'batch-a', 'user', { aid: 1, value: 'first' })
    queue.enqueue('42', 'batch-a', 'user', { aid: 1, value: 'final' })
    queue.enqueue('43', 'batch-b', 'deepseek', { aid: 1, value: 'other' })
    expect(queue.hasPending('42', 'batch-a')).toBe(true)

    await expect(queue.flush('42', 'batch-a')).rejects.toThrow('disk full')
    await queue.flush('42', 'batch-a')
    await queue.flush('43', 'batch-b')
    expect(queue.hasPending()).toBe(false)

    expect(write).toHaveBeenNthCalledWith(2, '42', 'batch-a', 'user', [{ aid: 1, value: 'final' }])
    expect(write).toHaveBeenNthCalledWith(3, '43', 'batch-b', 'deepseek', [{ aid: 1, value: 'other' }])
  })

  it('does not delete a newer patch enqueued while an older write is in flight', async () => {
    let release!: () => void
    const write = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const queue = new OldFavoriteOverlayQueue(write)
    queue.enqueue('42', 'batch-a', 'user', { aid: 1, value: 'old' })

    const flushing = queue.flush('42', 'batch-a')
    await Promise.resolve()
    queue.enqueue('42', 'batch-a', 'user', { aid: 1, value: 'new' })
    release()
    await flushing

    expect(queue.hasPending('42', 'batch-a')).toBe(true)
  })
})
