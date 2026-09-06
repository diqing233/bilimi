import { describe, expect, it, vi } from 'vitest'
import { loadStartupModuleWithRetry } from './startupModuleLoader'

describe('loadStartupModuleWithRetry', () => {
  it('retries the module request once when its first startup load fails', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: 'App' })

    await expect(loadStartupModuleWithRetry(loader)).resolves.toEqual({ default: 'App' })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('keeps the final load failure for the startup recovery screen', async () => {
    const failure = new TypeError('Failed to fetch dynamically imported module')
    const loader = vi.fn().mockRejectedValue(failure)

    await expect(loadStartupModuleWithRetry(loader)).rejects.toBe(failure)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('does not retry a module evaluation error that is unrelated to the startup request', async () => {
    const failure = new Error('App module failed while evaluating')
    const loader = vi.fn().mockRejectedValue(failure)

    await expect(loadStartupModuleWithRetry(loader)).rejects.toBe(failure)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
