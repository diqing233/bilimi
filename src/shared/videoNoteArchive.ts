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

function createVersionId(note: VideoNote, createdAt: string, existingVersionIds: ReadonlySet<string>): string {
  const baseId = `${note.id}:version:${createdAt}`
  if (!existingVersionIds.has(baseId)) return baseId

  let suffix = 2
  while (existingVersionIds.has(`${baseId}:${suffix}`)) suffix += 1
  return `${baseId}:${suffix}`
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
    .join('\n')
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

export function createPolishedTranscriptText(poster: NotePosterSummary): string {
  return poster.polishedTranscriptText?.replace(/^#+\s*精修文稿\s*/u, '').trim() ?? ''
}

export type NotePosterCopyParts = {
  summaryText: string
  detailedOutlineText: string
  polishedTranscriptText: string
}

const POSTER_HEADINGS = ['详细内容提要', '精修文稿', '内容核对清单', '待人工确认'] as const

function textBeforeHeading(value: string, heading: string) {
  const index = value.search(new RegExp(`^##\\s+${heading}(?:（\\d+）)?\\s*$`, 'mu'))
  return index >= 0 ? value.slice(0, index).trim() : value.trim()
}

function textBetweenHeadings(value: string, startHeading: string, endHeadings: readonly string[]) {
  const startMatch = new RegExp(`^##\\s+${startHeading}(?:（\\d+）)?\\s*$`, 'mu').exec(value)

  if (!startMatch) {
    return ''
  }

  const start = startMatch.index + startMatch[0].length
  const rest = value.slice(start)
  const endIndex = rest.search(new RegExp(`^##\\s+(?:${endHeadings.join('|')})(?:（\\d+）)?\\s*$`, 'mu'))

  return (endIndex >= 0 ? rest.slice(0, endIndex) : rest).trim()
}

export function createNotePosterCopyParts(summaryText: string): NotePosterCopyParts {
  const legacyDetail = textBetweenHeadings(summaryText, '内容核对清单', ['待人工确认'])
    .replace(/(?:^|\n)精修记录：[\s\S]*$/u, '')
    .trim()
  const currentDetail = textBetweenHeadings(summaryText, '详细内容提要', ['精修文稿', '待人工确认'])
  const summary = textBeforeHeading(textBeforeHeading(textBeforeHeading(summaryText, '精修文稿'), '待人工确认'), '内容核对清单')
  const summaryWithLegacyDetail = !currentDetail && legacyDetail
    ? [summary, '## 详细内容提要', legacyDetail].join('\n\n')
    : summary
  return {
    summaryText: summaryWithLegacyDetail,
    detailedOutlineText: currentDetail || legacyDetail,
    polishedTranscriptText: textBetweenHeadings(summaryText, '精修文稿', ['详细内容提要', '内容核对清单', '待人工确认'])
  }
}

/** Makes legacy poster text safe for display/export without mutating its saved archive value. */
export function normalizeNotePosterTextForDisplay(summaryText: string): string {
  if (!/##\s+(?:精准总结|精修文稿|内容核对清单|详细内容提要|待人工确认)/u.test(summaryText)) {
    return summaryText.trim()
  }
  const copyParts = createNotePosterCopyParts(summaryText)
  const reviewText = textBetweenHeadings(summaryText, '待人工确认', [])
    .replace(/(?:^|\n)精修记录：[\s\S]*$/u, '')
    .replace(/(^|\n)(\s*(?:[-*+]\s*)?)segment-\d+\s*[：:]\s*/giu, '$1$2')
    .trim()
  return [
    copyParts.summaryText,
    copyParts.polishedTranscriptText ? `## 精修文稿\n\n${copyParts.polishedTranscriptText}` : '',
    reviewText ? `## 待人工确认\n\n${reviewText}` : ''
  ].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeArchiveVersion(version: VideoNoteArchiveVersion): VideoNoteArchiveVersion {
  const note = normalizeVideoNote(version.note)

  return {
    ...version,
    note,
    plainTranscript: createPlainTranscriptText(note),
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
  const existingArchive = normalizedArchives.find((archive) => archive.id === archiveId)
  const existingVersionIds = new Set(existingArchive?.versions.map((version) => version.id) ?? [])
  const version: VideoNoteArchiveVersion = {
    id: createVersionId(normalizedNote, createdAt, existingVersionIds),
    note: normalizedNote,
    plainTranscript: createPlainTranscriptText(normalizedNote),
    summaryText,
    createdAt
  }
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

export function createNotePosterSummaryText(poster: NotePosterSummary): string {
  return [
    '## 精准总结',
    '',
    poster.title ? `### ${poster.title}` : '',
    poster.subtitle,
    '',
    ...poster.keyPoints.map((point) => '- ' + point)
  ]
    .filter((line) => line !== undefined && line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function createNotePosterText(poster: NotePosterSummary): string {
  const polishedTranscriptText = createPolishedTranscriptText(poster)
  const reviewItems = poster.reviewItems?.map((item) => ({ text: item.text.trim(), reason: item.reason.trim() }))
    .filter((item) => item.text && item.reason) ?? []
  const detailedOutline = poster.detailedOutline?.map((item) => item.trim()).filter(Boolean) ?? []
  for (const reviewItem of reviewItems) {
    const index = detailedOutline.findIndex((item) => item.includes(reviewItem.text))
    const marker = `${reviewItem.text}（待确认：${reviewItem.reason}）`
    if (index >= 0) detailedOutline[index] = detailedOutline[index].replace(reviewItem.text, marker).replace(/）\s+/gu, '）')
    else detailedOutline.push(`待确认：${reviewItem.text}（${reviewItem.reason}）`)
  }
  const legacyDetail = poster.auditChecklistText?.trim()
    .replace(/^#+\s*内容核对清单\s*/u, '')
    .replace(/(?:^|\n)精修记录：[\s\S]*$/u, '')
    .trim()
  return [
    createNotePosterSummaryText(poster),
    detailedOutline.length ? ['', '## 详细内容提要', '', ...detailedOutline.map((item) => `- ${item}`)]
      : legacyDetail ? ['', '## 详细内容提要', '', legacyDetail] : '',
    polishedTranscriptText ? ['', '## 精修文稿', '', polishedTranscriptText] : ''
  ]
    .flat()
    .filter((line) => line !== undefined && line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function updateVideoNoteArchiveVersion(
  archives: VideoNoteArchiveEntry[],
  archiveId: string,
  versionId: string,
  note: VideoNote,
  summaryText?: string
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
                  summaryText: summaryText ?? version.summaryText
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
