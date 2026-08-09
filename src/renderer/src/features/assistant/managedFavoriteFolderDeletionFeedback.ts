export { applyManagedFavoriteLedgerDeletion as applyManagedFavoriteFolderDeletionToLedgers } from '@shared/favoriteLedgerDeletion'

/** Keeps the two backup-folder deletion confirmations honest about remote failures. */
export function managedFavoriteFolderDeletionFailureMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : ''
  const httpStatus = detail.match(/\bhttp-status=(\d{3})\b/i)?.[1]
  const bilibiliCode = detail.match(/\bbilibili-code=(-?\d+)\b/i)?.[1]
  const responseCategory = detail.match(/\bresponse-category=([a-z-]+)\b/i)?.[1]?.toLowerCase()
  if (/csrf-missing/i.test(detail)) return 'B 站登录凭证已失效，请刷新已登录的 B 站页面后重试。'
  if (/account-mismatch|account changed|remote account mismatch/i.test(detail)) return '当前 B 站账号与备册账号不一致，请确认已登录页面后重试。'
  if (/page target is unavailable|target-unavailable/i.test(detail)) return '无法连接当前 B 站页面，请保持已登录页面打开后重试。'
  if (/remote folder verification failed/i.test(detail)) return 'B 站收藏夹状态已变化，已停止删除；请重新打开删除确认后再试。'
  if (responseCategory === 'html') return `B 站返回了非 JSON 页面${httpStatus ? `（HTTP ${httpStatus}）` : ''}，可能是登录或验证页面；未继续执行其他删除。`
  if (/network-failure|remote-timeout/i.test(detail)) return 'B 站请求未完成，未继续执行其他删除；请检查网络和登录状态后重试。'
  if (/invalid-response|remote-ambiguous|http-status=/i.test(detail)) {
    const diagnostics = [httpStatus ? `HTTP ${httpStatus}` : '', bilibiliCode ? `B 站错误码 ${bilibiliCode}` : ''].filter(Boolean)
    return `B 站拒绝或未返回可确认的删除结果${diagnostics.length ? `（${diagnostics.join('，')}）` : ''}；未继续执行其他删除。`
  }
  return detail ? `删除失败：${detail}` : '删除收藏夹失败，请稍后重试。'
}

/** A deletion call is successful only when it returns a normal folder list or an explicit succeeded status. */
export function managedFavoriteFolderDeletionSucceeded(result: unknown): boolean {
  if (Array.isArray(result)) return true
  return Boolean(result && typeof result === 'object' && (result as { status?: unknown }).status === 'succeeded')
}
