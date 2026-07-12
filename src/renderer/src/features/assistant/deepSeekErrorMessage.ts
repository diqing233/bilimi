const REMOTE_METHOD_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i

export function formatDeepSeekErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback

  const message = error.message.trim().replace(REMOTE_METHOD_ERROR_PREFIX, '').trim()
  return message || fallback
}
