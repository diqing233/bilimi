const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:(?:Error|DeepSeekServiceError):\s*)?/i

export function formatDeepSeekErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback

  const message = error.message.trim().replace(REMOTE_METHOD_ERROR_PREFIX, '').trim()
  if (/^Old favorite workspace has not been started\.$/i.test(message)) {
    return '整理收藏尚未开始，请返回整理收藏后重试。'
  }
  if (/^DeepSeek request timed out after \d+ seconds\.$/u.test(message)) {
    return 'DeepSeek 请求超时，请检查服务地址或网络后重试。'
  }
  return message || fallback
}

export function formatAssistantFeedbackMessage(message: string, fallback: string): string {
  const normalized = message.trim()
  if (!normalized) return fallback
  return formatDeepSeekErrorMessage(new Error(normalized), fallback)
}
