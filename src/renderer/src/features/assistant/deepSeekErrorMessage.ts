const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i

export function formatDeepSeekErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback

  const message = error.message.trim().replace(REMOTE_METHOD_ERROR_PREFIX, '').trim()
  if (/^DeepSeek request timed out after \d+ seconds\.$/u.test(message)) {
    return 'DeepSeek 请求超时，请检查服务地址或网络后重试。'
  }
  return message || fallback
}
