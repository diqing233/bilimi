import { describe, expect, it, vi } from 'vitest'
import { DeepSeekServiceError } from './deepseekService'
import { retryTransientDeepSeekRequest } from './deepseekRetry'

describe('retryTransientDeepSeekRequest', () => {
  it.each([429, 502, 503, 504])('retries transient HTTP %i failures twice', async (status) => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new DeepSeekServiceError('api-error', `DeepSeek API request failed: ${status} unavailable`))
      .mockRejectedValueOnce(new DeepSeekServiceError('api-error', `DeepSeek API request failed: ${status} unavailable`))
      .mockResolvedValue('ok')
    const delay = vi.fn().mockResolvedValue(undefined)

    await expect(retryTransientDeepSeekRequest(operation, { delay })).resolves.toBe('ok')

    expect(operation).toHaveBeenCalledTimes(3)
    expect(delay).toHaveBeenNthCalledWith(1, 2000, undefined)
    expect(delay).toHaveBeenNthCalledWith(2, 6000, undefined)
  })

  it('does not retry non-transient API failures, invalid output, or cancellation', async () => {
    const delay = vi.fn().mockResolvedValue(undefined)
    const cases = [
      new DeepSeekServiceError('api-error', 'DeepSeek API request failed: 401 Unauthorized'),
      new DeepSeekServiceError('invalid-output', 'invalid response'),
      new DOMException('The operation was aborted.', 'AbortError')
    ]

    for (const error of cases) {
      const operation = vi.fn().mockRejectedValue(error)
      await expect(retryTransientDeepSeekRequest(operation, { delay })).rejects.toBe(error)
      expect(operation).toHaveBeenCalledTimes(1)
    }
    expect(delay).not.toHaveBeenCalled()
  })

  it('honors a caller-provided empty retry policy', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new DeepSeekServiceError('api-error', 'DeepSeek API request failed: 503 unavailable'))
      .mockResolvedValue('unexpected retry')

    await expect(retryTransientDeepSeekRequest(operation, { retryDelaysMs: [] })).rejects.toThrow('503 unavailable')
    expect(operation).toHaveBeenCalledOnce()
  })
})
