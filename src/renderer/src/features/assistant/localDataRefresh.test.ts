import { describe, expect, it, vi } from 'vitest'
import { readLocalDataInfoWithRetry } from './localDataRefresh'

describe('readLocalDataInfoWithRetry', () => {
  it('recovers from a transient post-cleanup IPC failure', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('renderer reset race'))
      .mockResolvedValue({ path: 'C:\\empty', accounts: [] })
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(readLocalDataInfoWithRetry(read, { attempts: 3, wait }))
      .resolves.toEqual({ path: 'C:\\empty', accounts: [] })
    expect(read).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })

  it('reports the final error only after all bounded attempts fail', async () => {
    const error = new Error('service unavailable')
    const read = vi.fn().mockRejectedValue(error)

    await expect(readLocalDataInfoWithRetry(read, { attempts: 3, wait: async () => undefined }))
      .rejects.toBe(error)
    expect(read).toHaveBeenCalledTimes(3)
  })
})
