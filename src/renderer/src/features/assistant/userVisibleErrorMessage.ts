const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:(?:Error|DeepSeekServiceError):\s*)?/i

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message.trim().replace(REMOTE_METHOD_ERROR_PREFIX, '').trim() : ''
}

function isChineseUserMessage(message: string): boolean {
  if (!/[\u3400-\u9fff]/u.test(message)) return false
  const withoutAllowedTerms = message
    .replace(/B\s*站/gu, '')
    .replace(/bilimi/giu, '')
    .replace(/DeepSeek/giu, '')
    .replace(/SenseVoice(?:Small)?/giu, '')
    .replace(/faster-whisper/giu, '')
    .replace(/Whisper/giu, '')
    .replace(/HTTP\s*\d+/giu, '')
  return !/[A-Za-z]/u.test(withoutAllowedTerms)
}

/**
 * Converts low-level renderer, preload, and IPC failures into text safe to show
 * in bilimi's UI. It deliberately never exposes an unrecognized English
 * exception: callers provide the operation-specific Chinese fallback instead.
 */
export function formatUserVisibleErrorMessage(error: unknown, fallback: string): string {
  const detail = errorDetail(error)
  if (!detail) return fallback

  if (/favorite repository remote folder inventory is unavailable/i.test(detail)) {
    return '无法读取 B 站收藏夹列表，请检查网络并保持已登录的 B 站页面打开后重试。'
  }
  if (/response-category=html|returned html instead of json|non-json response/i.test(detail)) {
    return 'B 站返回了登录或验证页面，请确认已登录后重试。'
  }
  if (/csrf-missing|authentication|not logged in|login required/i.test(detail)) {
    return 'B 站登录状态已失效，请保持已登录的 B 站页面打开后重试。'
  }
  if (/network-failure|remote-timeout|fetch failed|failed to fetch|network(?: request)? failed|network error|net::err_(?:internet_disconnected|name_not_resolved|connection|timed_out)|econn(?:reset|refused)|enotfound/i.test(detail)) {
    return '网络连接失败，请检查网络并保持已登录的 B 站页面打开后重试。'
  }
  if (isChineseUserMessage(detail)) return detail
  return fallback
}
