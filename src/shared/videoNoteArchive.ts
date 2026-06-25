import type {
  TranscriptSegment,
  VideoNote,
  VideoNoteArchiveEntry,
  VideoNoteArchiveSearchFilters,
  VideoNoteArchiveVersion,
  VideoNoteTimelineItem,
  NotePosterSummary
} from './types'
import { createVideoNoteId, normalizeVideoNote } from './videoNotes'

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) {
    return '--:--'
  }

  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

function createVersionId(note: VideoNote, createdAt: string): string {
  return `${note.id}:version:${createdAt}`
}

function timelineText(items: VideoNoteTimelineItem[], emptyText: string): string {
  if (items.length === 0) {
    return emptyText
  }

  return items
    .map((item) => `- [${formatTimestamp(item.start)}] ${item.title}：${item.detail}`)
    .join('\n')
}

function transcriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

export function createPlainTranscriptText(note: VideoNote): string {
  return transcriptText(note.transcript)
}

export function createSummaryText(note: VideoNote): string {
  return [
    '## 速览',
    '',
    ...(note.overview.shortSummary.length > 0
      ? note.overview.shortSummary.map((summary) => `- ${summary}`)
      : ['暂无速览。']),
    '',
    note.overview.keywords.length > 0 ? `关键词：${note.overview.keywords.join('、')}` : '关键词：暂无',
    '',
    '## 时间线',
    '',
    timelineText(note.overview.timeline, '暂无时间线。'),
    '',
    '## 高光',
    '',
    timelineText(note.overview.highlights, '暂无高光片段。')
  ].join('\n')
}

function normalizeArchiveVersion(version: VideoNoteArchiveVersion): VideoNoteArchiveVersion {
  const note = normalizeVideoNote(version.note)

  return {
    ...version,
    note,
    plainTranscript: version.plainTranscript ?? createPlainTranscriptText(note),
    summaryText: version.summaryText ?? createSummaryText(note)
  }
}

export function normalizeVideoNoteArchiveEntry(
  archive: VideoNoteArchiveEntry
): VideoNoteArchiveEntry {
  const versions = Array.isArray(archive.versions)
    ? archive.versions.map(normalizeArchiveVersion)
    : []
  const lastVersion = versions.at(-1)

  return {
    ...archive,
    source: archive.source ?? lastVersion?.note.source,
    versions,
    createdAt: archive.createdAt ?? lastVersion?.createdAt ?? new Date(0).toISOString(),
    updatedAt: archive.updatedAt ?? lastVersion?.createdAt ?? new Date(0).toISOString()
  }
}

export function normalizeVideoNoteArchives(
  archives: VideoNoteArchiveEntry[]
): VideoNoteArchiveEntry[] {
  return archives.map(normalizeVideoNoteArchiveEntry)
}

export function appendVideoNoteArchiveVersion(
  archives: VideoNoteArchiveEntry[],
  note: VideoNote,
  createdAt: string,
  summaryText = ''
): VideoNoteArchiveEntry[] {
  const normalizedArchives = normalizeVideoNoteArchives(archives)
  const normalizedNote = normalizeVideoNote(note)
  const archiveId = createVideoNoteId(normalizedNote.source)
  const version: VideoNoteArchiveVersion = {
    id: createVersionId(normalizedNote, createdAt),
    note: normalizedNote,
    plainTranscript: createPlainTranscriptText(normalizedNote),
    summaryText,
    createdAt
  }
  const existingArchive = normalizedArchives.find((archive) => archive.id === archiveId)

  if (!existingArchive) {
    return [
      ...normalizedArchives,
      {
        id: archiveId,
        source: normalizedNote.source,
        versions: [version],
        createdAt,
        updatedAt: createdAt
      }
    ]
  }

  return normalizedArchives.map((archive) =>
    archive.id === archiveId
      ? {
          ...archive,
          source: normalizedNote.source,
          versions: [...archive.versions, version],
          updatedAt: createdAt
        }
      : archive
  )
}

export function deleteVideoNoteArchiveEntry(
  archives: VideoNoteArchiveEntry[],
  archiveId: string
): VideoNoteArchiveEntry[] {
  return normalizeVideoNoteArchives(archives).filter((archive) => archive.id !== archiveId)
}

export function deleteVideoNoteArchiveVersion(
  archives: VideoNoteArchiveEntry[],
  archiveId: string,
  versionId: string
): VideoNoteArchiveEntry[] {
  return normalizeVideoNoteArchives(archives)
    .map((archive) =>
      archive.id === archiveId
        ? {
            ...archive,
            versions: archive.versions.filter((version) => version.id !== versionId)
          }
        : archive
    )
    .filter((archive) => archive.versions.length > 0)
}

export function createNotePosterText(poster: NotePosterSummary): string {
  return [
    poster.title,
    poster.subtitle,
    '',
    ...poster.keyPoints.map((point) => '- ' + point),
    poster.keywords.length > 0 ? '关键词：' + poster.keywords.join('、') : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function updateVideoNoteArchiveVersion(
  archives: VideoNoteArchiveEntry[],
  archiveId: string,
  versionId: string,
  note: VideoNote
): VideoNoteArchiveEntry[] {
  const normalizedNote = normalizeVideoNote(note)

  return normalizeVideoNoteArchives(archives).map((archive) =>
    archive.id === archiveId
      ? {
          ...archive,
          source: normalizedNote.source,
          versions: archive.versions.map((version) =>
            version.id === versionId
              ? {
                  ...version,
                  note: normalizedNote,
                  plainTranscript: createPlainTranscriptText(normalizedNote),
                  summaryText: version.summaryText
                }
              : version
          ),
          updatedAt: normalizedNote.updatedAt || archive.updatedAt
        }
      : archive
  )
}

function archiveMatchesQuery(archive: VideoNoteArchiveEntry, query: string): boolean {
  if (!query) {
    return true
  }

  const normalizedQuery = query.toLocaleLowerCase()
  const searchableText = [
    archive.source.title,
    archive.source.author,
    archive.source.bvid,
    archive.source.url,
    ...archive.versions.flatMap((version) => [
      version.plainTranscript,
      version.summaryText,
      version.note.userMemo,
      ...version.note.annotations.map((annotation) => `${annotation.title} ${annotation.body}`)
    ])
  ]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase()

  return searchableText.includes(normalizedQuery)
}

function archiveHasMemo(archive: VideoNoteArchiveEntry): boolean {
  return archive.versions.some((version) => version.note.userMemo.trim().length > 0)
}

function archiveHasStarred(archive: VideoNoteArchiveEntry): boolean {
  return archive.versions.some((version) => Boolean(version.note.starred))
}

export function searchVideoNoteArchives(
  archives: VideoNoteArchiveEntry[],
  filters: VideoNoteArchiveSearchFilters
): VideoNoteArchiveEntry[] {
  const query = filters.query.trim()

  return normalizeVideoNoteArchives(archives)
    .filter((archive) => archiveMatchesQuery(archive, query))
    .filter((archive) => !filters.hasMemo || archiveHasMemo(archive))
    .filter((archive) => !filters.hasStarred || archiveHasStarred(archive))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}
