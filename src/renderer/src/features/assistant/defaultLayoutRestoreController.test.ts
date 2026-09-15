import { describe, expect, it, vi } from 'vitest'
import { createDefaultLayoutRestoreController } from './defaultLayoutRestoreController'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe('createDefaultLayoutRestoreController', () => {
  it('starts layout restoration immediately without waiting for preference persistence', async () => {
    const save = deferred<void>()
    const restoreLayout = vi.fn().mockResolvedValue(undefined)
    const persistSidebarWidthReset = vi.fn(() => save.promise)
    const onSuccess = vi.fn()
    const restore = createDefaultLayoutRestoreController({
      restoreLayout,
      persistSidebarWidthReset,
      onSuccess,
      onFailure: vi.fn()
    })

    const pending = restore()

    expect(restoreLayout).toHaveBeenCalledOnce()
    expect(persistSidebarWidthReset).toHaveBeenCalledOnce()
    expect(onSuccess).not.toHaveBeenCalled()

    save.resolve()
    await pending
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('coalesces repeated clicks while the layout transaction is active', async () => {
    const layout = deferred<void>()
    const restoreLayout = vi.fn(() => layout.promise)
    const restore = createDefaultLayoutRestoreController({
      restoreLayout,
      persistSidebarWidthReset: vi.fn().mockResolvedValue(undefined),
      onSuccess: vi.fn(),
      onFailure: vi.fn()
    })

    const first = restore()
    const second = restore()

    expect(second).toBe(first)
    expect(restoreLayout).toHaveBeenCalledOnce()
    layout.resolve()
    await first
  })

  it('reports layout and preference failures after both independent operations settle', async () => {
    const layout = deferred<void>()
    const save = deferred<void>()
    const onFailure = vi.fn()
    const restore = createDefaultLayoutRestoreController({
      restoreLayout: () => layout.promise,
      persistSidebarWidthReset: () => save.promise,
      onSuccess: vi.fn(),
      onFailure
    })

    const pending = restore()
    layout.reject(new Error('layout failed'))
    await Promise.resolve()
    expect(onFailure).not.toHaveBeenCalled()
    save.reject(new Error('save failed'))

    await pending
    expect(onFailure).toHaveBeenCalledWith('layout-and-preference')
  })
})
