import { describe, expect, it, vi } from 'vitest'
import { createFavoriteRepositoryQuitBarrier } from './favoriteRepositoryQuitBarrier'

describe('createFavoriteRepositoryQuitBarrier', () => {
  it('waits for pending repository writes before allowing Electron to quit', async () => {
    let resolveFlush!: () => void
    const flush = vi.fn(() => new Promise<void>((resolve) => { resolveFlush = resolve }))
    const quit = vi.fn()
    const barrier = createFavoriteRepositoryQuitBarrier({ hasPendingWrites: () => true, flush, quit })
    const event = { preventDefault: vi.fn() }

    barrier(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()

    resolveFlush()
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).toHaveBeenCalledOnce()
  })
})
