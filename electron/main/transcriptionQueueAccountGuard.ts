import type { VideoAudioTranscriptionQueueItem, VideoAudioTranscriptionQueueSnapshot } from '../../src/shared/types'

/** Rejects stale renderer IDs and prevents post-switch operations on another account's queue. */
export function assertCurrentAccountOwnsTranscriptionQueueItems(
  currentAccountMid: string,
  items: VideoAudioTranscriptionQueueItem[],
  ids: string[]
): void {
  if (!currentAccountMid) throw new Error('当前未登录，无法操作转写任务。')
  const requested = new Set(ids)
  if (requested.size === 0) throw new Error('未选择转写任务。')
  const selected = items.filter((item) => requested.has(item.id))
  if (selected.length !== requested.size) throw new Error('转写任务已过期，请刷新后重试。')
  if (selected.some((item) => item.accountMid !== currentAccountMid)) {
    throw new Error('当前账号已切换，无法操作原账号的转写任务。')
  }
}

export function assertCurrentAccountOwnsTranscriptionRequest(
  currentAccountMid: string,
  request: { accountMid?: string }
): void {
  if (!currentAccountMid || !request.accountMid || request.accountMid !== currentAccountMid) {
    throw new Error('当前账号已切换，无法创建原账号的转写任务。')
  }
}

export function filterTranscriptionQueueSnapshotForAccount(
  snapshot: VideoAudioTranscriptionQueueSnapshot,
  accountMid: string
): VideoAudioTranscriptionQueueSnapshot {
  const items = snapshot.items.filter((item) => item.accountMid === accountMid)
  return {
    items,
    activeItemId: items.some((item) => item.id === snapshot.activeItemId) ? snapshot.activeItemId : undefined,
    sessionCompletedCount: items.filter((item) => item.status === 'completed' && item.archiveRegistrationStatus === 'registered').length
  }
}
