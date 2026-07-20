import type { VideoAudioTranscriptionQueueItem, VideoNoteArchiveEntry } from '../../src/shared/types'
import type { FavoriteLibraryArchiveSummary, FavoriteLibraryTranscriptionSummary } from './favoriteRepositoryIpc'

function sourceMatchesAid(url: string, aid: number) {
  return new RegExp(`/video/av${aid}(?:[/?#]|$)`, 'i').test(url)
}

export function createFavoriteLibraryArchiveSummary(
  accountMid: string,
  aid: number,
  archives: readonly VideoNoteArchiveEntry[]
): FavoriteLibraryArchiveSummary {
  const archive = archives
    .filter((candidate) => candidate.source.accountMid === accountMid && sourceMatchesAid(candidate.source.url, aid))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  if (!archive) return { status: '未入档', versionCount: 0, starred: false, hasMemo: false, hasSummary: false }
  const latest = archive.versions.at(-1)
  const memo = latest?.note.userMemo.trim() ?? ''
  return {
    status: '已入档',
    versionCount: archive.versions.length,
    starred: archive.versions.some((version) => Boolean(version.note.starred)),
    hasMemo: Boolean(memo),
    ...(memo ? { memoPreview: memo.slice(0, 80) } : {}),
    hasSummary: archive.versions.some((version) => Boolean(version.summaryText.trim())),
    updatedAt: archive.updatedAt
  }
}

export function createFavoriteLibraryTranscriptionSummary(
  accountMid: string,
  aid: number,
  items: readonly VideoAudioTranscriptionQueueItem[]
): FavoriteLibraryTranscriptionSummary {
  const statuses = items
    .filter((item) => item.accountMid === accountMid && Number(item.aid) === aid)
    .map((item) => item.status)
  if (statuses.includes('running')) return { status: '正在转写' }
  if (statuses.includes('pending')) return { status: '等待转写' }
  if (statuses.includes('completed')) return { status: '转写完成' }
  if (statuses.includes('failed')) return { status: '转写失败' }
  return { status: '未转写' }
}
