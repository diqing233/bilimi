import type { DeepSeekConnectionTestResult, DeepSeekGenerateRequest, DeepSeekGenerateResult } from '../../src/shared/types'
import { DeepSeekServiceError, generateDeepSeekResult, type DeepSeekConfig } from './deepseekService'
import type { DeepSeekRetryProgress } from './deepseekRetry'

export const DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS = 20_000
export const DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS = [2_000] as const

type ConnectionTestGenerateOptions = {
  config: DeepSeekConfig
  request: Extract<DeepSeekGenerateRequest, { kind: 'pet-chat' }>
  requestTimeoutMs: number
  retryDelaysMs: readonly number[]
  onRetry?: (progress: DeepSeekRetryProgress) => void
  onResponseMetadata?: (metadata: { model?: string; finishReason?: string }) => void
}

type ConnectionTestGenerator = (options: ConnectionTestGenerateOptions) => Promise<DeepSeekGenerateResult>

export async function runDeepSeekConnectionTest(
  config: DeepSeekConfig,
  options: {
    generate?: ConnectionTestGenerator
    onRetry?: (progress: DeepSeekRetryProgress) => void
  } = {}
): Promise<DeepSeekConnectionTestResult> {
  const generate = options.generate ?? ((request: ConnectionTestGenerateOptions) => generateDeepSeekResult(request))
  let responseModel: string | undefined
  try {
    await generate({
      config,
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'Reply with OK.' }]
      },
      requestTimeoutMs: DEEPSEEK_CONNECTION_TEST_REQUEST_TIMEOUT_MS,
      retryDelaysMs: DEEPSEEK_CONNECTION_TEST_RETRY_DELAYS_MS,
      onRetry: options.onRetry,
      onResponseMetadata: (metadata) => {
        responseModel = metadata.model
      }
    })
    return {
      ok: true,
      message: 'DeepSeek connection succeeded.',
      requestedModel: config.model,
      responseModel
    }
  } catch (error) {
    if (error instanceof DeepSeekServiceError) {
      return { ok: false, message: error.message, requestedModel: config.model }
    }
    return {
      ok: false,
      message: 'DeepSeek connection failed.',
      requestedModel: config.model
    }
  }
}
