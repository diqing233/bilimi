import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteRendererFlushCoordinator } from './oldFavoriteRendererFlushCoordinator'

describe('OldFavoriteRendererFlushCoordinator', () => {
  it('does not contact the renderer when no overlay is dirty', async () => {
    const coordinator = new OldFavoriteRendererFlushCoordinator()
    const send = vi.fn()

    await expect(coordinator.requestFlush(send)).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('returns to the clean fast path after the normal debounced flush completes', async () => {
    const coordinator = new OldFavoriteRendererFlushCoordinator()
    coordinator.markDirty()
    coordinator.markClean()

    const send = vi.fn()
    await expect(coordinator.requestFlush(send)).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('waits for the renderer to flush the last debounced overlay before becoming clean', async () => {
    const coordinator = new OldFavoriteRendererFlushCoordinator()
    const send = vi.fn()
    coordinator.markDirty()

    const flushing = coordinator.requestFlush(send)
    expect(send).toHaveBeenCalledWith(expect.any(String))
    const requestId = send.mock.calls[0][0]
    expect(coordinator.complete(requestId)).toBe(true)

    await expect(flushing).resolves.toBe(true)
    await expect(coordinator.requestFlush(send)).resolves.toBe(false)
    expect(send).toHaveBeenCalledOnce()
  })

  it('stays dirty when the renderer reports a failed flush', async () => {
    const coordinator = new OldFavoriteRendererFlushCoordinator()
    const send = vi.fn()
    coordinator.markDirty()

    const flushing = coordinator.requestFlush(send)
    const requestId = send.mock.calls[0][0]
    coordinator.complete(requestId, false)

    await expect(flushing).resolves.toBe(false)
    const retry = coordinator.requestFlush(send)
    expect(send).toHaveBeenCalledTimes(2)
    coordinator.complete(send.mock.calls[1][0])
    await expect(retry).resolves.toBe(true)
  })
})
