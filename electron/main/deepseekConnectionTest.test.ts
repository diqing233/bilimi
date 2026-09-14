import { describe, expect, it, vi } from 'vitest'
import { DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS, DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS, runDeepSeekConnectionTest } from './deepseekConnectionTest'

const config = {
  enabled: true,
  apiKey: 'test-key',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.example.test/v1'
}

describe('runDeepSeekConnectionTest', () => {
  it('uses two bounded attempts and reports the only allowed retry', async () => {
    const onRetry = vi.fn()
    const generate = vi.fn(async (options: { onRetry?: (progress: { attempt: number; totalAttempts: number; delayMs: number }) => void }) => {
      options.onRetry?.({ attempt: 2, totalAttempts: 2, delayMs: 2_000 })
      return { kind: 'pet-chat' as const, message: 'OK' }
    })

    const result = await runDeepSeekConnectionTest(config, { generate, onRetry })

    expect(result).toMatchObject({ ok: true, requestedModel: config.model })
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      requestTimeoutMs: DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS,
      retryDelaysMs: DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS,
      request: { kind: 'pet-chat', messages: [{ role: 'user', content: 'Reply with OK.' }] }
    }))
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, totalAttempts: 2, delayMs: 2_000 })
  })
})
