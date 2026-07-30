import type { TranscriptSegment, VideoNoteArchiveEntry, VideoNoteArchiveVersion } from './types'
import { Document, ExternalHyperlink, HeadingLevel, Paragraph, TextRun } from 'docx'
import { createNotePosterCopyParts, normalizeNotePosterTextForDisplay } from './videoNoteArchive'

export type VideoNoteExportScope = 'current' | 'complete'
export type VideoNoteCurrentContent =
  | 'plain'
  | 'timed'
  | 'summary'
  | 'summary-precise'
  | 'summary-outline'
  | 'summary-polished'

export type VideoNoteMarkdownExportInput = {
  archive: VideoNoteArchiveEntry
  version: VideoNoteArchiveVersion
  scope: VideoNoteExportScope
  currentContent?: VideoNoteCurrentContent
  includeNotes?: boolean
}

function formatTimestamp(seconds: number): string {
  const normalized = Math.max(0, Math.floor(seconds))
  return `${Math.floor(normalized / 60).toString().padStart(2, '0')}:${(normalized % 60).toString().padStart(2, '0')}`
}

function buildTimestampUrl(url: string, seconds: number): string {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}t=${Math.floor(seconds)}`
}

function createTimedTranscript(segments: TranscriptSegment[], url: string): string {
  const lines = segments
    .map((segment) => {
      const text = segment.text.trim()
      if (!text) return ''
      if (segment.start === null || !Number.isFinite(segment.start) || segment.start < 0) {
        return `[--:--] ${text}`
      }
      return `[${formatTimestamp(segment.start)}](${buildTimestampUrl(url, segment.start)}) ${text}`
    })
    .filter(Boolean)

  return lines.join('\n\n') || '\u6682\u65e0\u751f\u6210'
}

function createSummary(summaryText: string): string {
  return normalizeNotePosterTextForDisplay(summaryText) || '\u6682\u65e0\u751f\u6210'
}

function createNotes(version: VideoNoteArchiveVersion): string {
  const memo = version.note.userMemo.trim()
  const annotations = version.note.annotations
    .map((annotation) => `- ${annotation.title}: ${annotation.body}`.trim())
    .filter(Boolean)
  if (!memo && annotations.length === 0) return ''

  return [
    '## \u5907\u6ce8',
    '',
    ...(memo ? [memo, ''] : []),
    ...annotations
  ].join('\n')
}

function createMetadata(input: VideoNoteMarkdownExportInput): string {
  const { source } = input.archive
  return [
    `# ${source.title}`,
    '',
    source.author ? `- UP: ${source.author}` : '',
    source.bvid ? `- BV: ${source.bvid}` : '',
    source.url ? `- \u94fe\u63a5: ${source.url}` : '',
    `- \u5b58\u6863\u65f6\u95f4: ${input.version.createdAt}`,
    source.tags.length > 0 ? `- \u6807\u7b7e: ${source.tags.join(', ')}` : '',
    source.description ? ['', '## \u7b80\u4ecb', '', source.description] : ''
  ]
    .flat()
    .filter(Boolean)
    .join('\n')
}

function createContent(input: VideoNoteMarkdownExportInput, content: VideoNoteCurrentContent): string {
  const { version } = input
  if (content === 'plain') return version.plainTranscript.trim() || '\u6682\u65e0\u751f\u6210'
  if (content === 'timed') return createTimedTranscript(version.note.transcript, input.archive.source.url)
  if (content !== 'summary') {
    const parts = createNotePosterCopyParts(version.summaryText)
    const section = content === 'summary-precise'
      ? parts.summaryText.replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '').trim()
      : content === 'summary-outline'
        ? parts.detailedOutlineText
        : parts.polishedTranscriptText
    return section || '\u6682\u65e0\u751f\u6210'
  }
  return createSummary(version.summaryText)
}

export function createVideoNoteMarkdown(input: VideoNoteMarkdownExportInput): string {
  const currentContent = input.currentContent ?? 'plain'
  if (input.scope === 'current') {
    return [createMetadata(input), createContent(input, currentContent), input.includeNotes ? createNotes(input.version) : ''].filter(Boolean).join('\n\n') + '\n'
  }

  const sections = [
    createMetadata(input),
    '## \u7eaf\u6587\u7a3f\u8f6c\u5199\n\n' + createContent(input, 'plain'),
    '## \u5e26\u65f6\u95f4\u8f74\u8f6c\u5199\n\n' + createContent(input, 'timed'),
    '## DeepSeek \u603b\u7ed3\n\n' + createContent(input, 'summary'),
    input.includeNotes ? createNotes(input.version) : ''
  ].filter(Boolean)

  return sections.join('\n\n') + '\n'
}

function paragraphLines(text: string): Paragraph[] {
  return text.split(/\r?\n/).map((line) => new Paragraph({ text: line || ' ' }))
}

function metadataParagraphs(input: VideoNoteMarkdownExportInput): Paragraph[] {
  const { source } = input.archive
  const paragraphs = [new Paragraph({ text: source.title, heading: HeadingLevel.TITLE })]
  if (source.author) paragraphs.push(new Paragraph(`UP: ${source.author}`))
  if (source.bvid) paragraphs.push(new Paragraph(`BV: ${source.bvid}`))
  if (source.url) paragraphs.push(new Paragraph(`链接: ${source.url}`))
  paragraphs.push(new Paragraph(`存档时间: ${input.version.createdAt}`))
  if (source.tags.length > 0) paragraphs.push(new Paragraph(`标签: ${source.tags.join(', ')}`))
  if (source.description) {
    paragraphs.push(new Paragraph({ text: '简介', heading: HeadingLevel.HEADING_1 }), ...paragraphLines(source.description))
  }
  return paragraphs
}

function timedTranscriptParagraphs(segments: TranscriptSegment[], url: string): Paragraph[] {
  const paragraphs = segments.flatMap((segment) => {
    const text = segment.text.trim()
    if (!text) return []
    if (segment.start === null || !Number.isFinite(segment.start) || segment.start < 0) {
      return [new Paragraph(`[--:--] ${text}`)]
    }
    const timestamp = `[${formatTimestamp(segment.start)}]`
    return [new Paragraph({
      children: [
        new ExternalHyperlink({
          link: buildTimestampUrl(url, segment.start),
          children: [new TextRun({ text: timestamp, style: 'Hyperlink' })]
        }),
        new TextRun(` ${text}`)
      ]
    })]
  })
  return paragraphs.length > 0 ? paragraphs : [new Paragraph('\u6682\u65e0\u751f\u6210')]
}

function contentParagraphs(input: VideoNoteMarkdownExportInput, content: VideoNoteCurrentContent): Paragraph[] {
  if (content === 'timed') return timedTranscriptParagraphs(input.version.note.transcript, input.archive.source.url)
  return paragraphLines(createContent(input, content))
}

function notesParagraphs(version: VideoNoteArchiveVersion): Paragraph[] {
  const notes = createNotes(version)
  return notes ? [new Paragraph({ text: '\u5907\u6ce8', heading: HeadingLevel.HEADING_1 }), ...paragraphLines(notes.replace(/^## \u5907\u6ce8\r?\n\r?\n?/, ''))] : []
}

/** Builds a self-contained document exclusively from an already saved archive version. */
export function createVideoNoteWord(input: VideoNoteMarkdownExportInput): Document {
  const currentContent = input.currentContent ?? 'plain'
  const children = metadataParagraphs(input)
  if (input.scope === 'current') {
    children.push(...contentParagraphs(input, currentContent))
    if (input.includeNotes) children.push(...notesParagraphs(input.version))
  } else {
    children.push(
      new Paragraph({ text: '\u7eaf\u6587\u7a3f\u8f6c\u5199', heading: HeadingLevel.HEADING_1 }),
      ...contentParagraphs(input, 'plain'),
      new Paragraph({ text: '\u5e26\u65f6\u95f4\u8f74\u8f6c\u5199', heading: HeadingLevel.HEADING_1 }),
      ...contentParagraphs(input, 'timed'),
      new Paragraph({ text: 'DeepSeek \u603b\u7ed3', heading: HeadingLevel.HEADING_1 }),
      ...contentParagraphs(input, 'summary')
    )
    if (input.includeNotes) children.push(...notesParagraphs(input.version))
  }
  return new Document({ sections: [{ children }] })
}
