import type { VideoNote, VideoNoteArchiveEntry } from '../../src/shared/types'

function hasPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Renderer requests never get to select an archive identity by title or URL.
 * A verified Bilibili archive write is only valid for the account and exact
 * video part that are still active in the main process.
 */
export function assertCurrentAccountOwnsVerifiedArchiveNote(
  currentAccountMid: string | undefined,
  note: VideoNote
): void {
  const source = note.source
  const accountMid = source.accountMid?.trim()
  if (!accountMid || !hasPositiveSafeInteger(source.aid) || !hasPositiveSafeInteger(source.cid) || !source.bvid?.trim()) {
    throw new Error('无法保存档案：缺少完整视频身份。')
  }
  if (!currentAccountMid?.trim() || accountMid !== currentAccountMid.trim()) {
    throw new Error('当前账号已切换，无法保存到原视频档案。')
  }
}

function versionBelongsToAccount(version: VideoNoteArchiveEntry['versions'][number], accountMid: string): boolean {
  return version.note.source.accountMid === accountMid
}

/** Projects only versions the current Bilibili account owns; entries can be shared by legacy BV keys. */
export function filterVideoNoteArchivesForAccount(
  archives: VideoNoteArchiveEntry[],
  accountMid: string | undefined
): VideoNoteArchiveEntry[] {
  if (!accountMid?.trim()) return []
  return archives.flatMap((archive) => {
    const versions = archive.versions.filter((version) => versionBelongsToAccount(version, accountMid))
    if (versions.length === 0) return []
    return [{ ...archive, source: versions[0].note.source, versions }]
  })
}

export function assertCurrentAccountOwnsArchiveVersion(
  archives: VideoNoteArchiveEntry[],
  accountMid: string | undefined,
  archiveId: string,
  versionId: string
): VideoNoteArchiveEntry['versions'][number] {
  const version = archives.find((archive) => archive.id === archiveId)?.versions.find((candidate) => candidate.id === versionId)
  if (!version || !accountMid?.trim() || !versionBelongsToAccount(version, accountMid)) {
    throw new Error('当前账号无权访问该档案版本。')
  }
  return version
}

/** Archive edits may change content, never the account/video/part identity pinned by the version. */
export function assertArchiveVersionMatchesReplacementNote(
  existingVersion: VideoNoteArchiveEntry['versions'][number],
  replacement: VideoNote
): void {
  const existing = existingVersion.note.source
  const next = replacement.source
  if (
    !existing.accountMid?.trim() || !next.accountMid?.trim() ||
    existing.accountMid.trim() !== next.accountMid.trim() ||
    !hasPositiveSafeInteger(existing.aid) || !hasPositiveSafeInteger(next.aid) || existing.aid !== next.aid ||
    !hasPositiveSafeInteger(existing.cid) || !hasPositiveSafeInteger(next.cid) || existing.cid !== next.cid ||
    !existing.bvid?.trim() || !next.bvid?.trim() || existing.bvid.trim() !== next.bvid.trim()
  ) {
    throw new Error('不能用其他视频的内容替换同一视频的档案版本。')
  }
}

/** Whole-entry deletion is rejected if a legacy entry contains another account's versions. */
export function assertCurrentAccountOwnsArchiveEntry(
  archives: VideoNoteArchiveEntry[],
  accountMid: string | undefined,
  archiveId: string
): VideoNoteArchiveEntry {
  const archive = archives.find((candidate) => candidate.id === archiveId)
  if (!archive || !accountMid?.trim() || archive.versions.length === 0 || archive.versions.some((version) => !versionBelongsToAccount(version, accountMid))) {
    throw new Error('该档案包含其他账号的数据，不能整体删除。')
  }
  return archive
}
