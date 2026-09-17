import type { TranscriptSegment, VideoNoteArchiveEntry, VideoNoteArchiveVersion } from './types'
import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, OnOffElement, Paragraph, ParagraphProperties, TextRun } from 'docx'
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

type WordHeadingLevel = (typeof HeadingLevel)[keyof typeof HeadingLevel]

const WORD_EXPORT_TEXT_COLOR = '263446'

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
  return separateSummaryListItems(normalizeNotePosterTextForDisplay(summaryText)) || '\u6682\u65e0\u751f\u6210'
}

function separateSummaryListItems(summaryText: string): string {
  const lines: string[] = []
  let relaxedSection = false
  let previousWasListItem = false

  for (const line of summaryText.split(/\r?\n/u)) {
    const isSpacedHeading = /^##\s+(?:\u7cbe\u51c6\u603b\u7ed3|\u8be6\u7ec6\u5185\u5bb9\u63d0\u8981|\u5f85\u4eba\u5de5\u786e\u8ba4)(?:\uff08\d+\uff09)?\s*$/u.test(line)
    if (/^##\s+/u.test(line)) {
      relaxedSection = isSpacedHeading
      previousWasListItem = false
      lines.push(line)
      continue
    }

    const isListItem = relaxedSection && /^\s*[-*+]\s+\S/u.test(line)
    if (isListItem && previousWasListItem) lines.push('')
    lines.push(line)
    previousWasListItem = isListItem
  }

  return lines.join('\n').trim()
}

function separateListItems(value: string): string {
  const lines: string[] = []
  let previousWasListItem = false

  for (const line of value.split(/\r?\n/u)) {
    const isListItem = /^\s*[-*+]\s+\S/u.test(line)
    if (isListItem && previousWasListItem) lines.push('')
    lines.push(line)
    previousWasListItem = isListItem
  }

  return lines.join('\n').trim()
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
      ? separateListItems(parts.summaryText.replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '').trim())
      : content === 'summary-outline'
        ? separateListItems(parts.detailedOutlineText)
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

function wordTitleParagraph(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
    autoSpaceEastAsianText: false,
    spacing: { before: 0, after: 120, line: 360 },
    children: [new TextRun({ text, bold: true, color: WORD_EXPORT_TEXT_COLOR, size: 32 })]
  })
}

function wordHeadingParagraph(text: string, heading: WordHeadingLevel, before = 120): Paragraph {
  const size = heading === HeadingLevel.HEADING_1 ? 30 : heading === HeadingLevel.HEADING_2 ? 26 : 24
  return new Paragraph({
    heading,
    alignment: AlignmentType.LEFT,
    autoSpaceEastAsianText: false,
    spacing: { before, after: 80, line: 276 },
    children: [new TextRun({ text, bold: true, color: WORD_EXPORT_TEXT_COLOR, size })]
  })
}

function compactMetadataParagraph(text: string): Paragraph {
  const paragraph = new Paragraph({
    text,
    alignment: AlignmentType.LEFT,
    autoSpaceEastAsianText: false,
    spacing: { before: 0, after: 0, line: 276 },
    run: { color: WORD_EXPORT_TEXT_COLOR, size: 22 }
  })
  // docx exposes the East Asian/number switch as autoSpaceDN, but WPS also
  // applies the separate East Asian/Latin spacing rule unless autoSpaceDE is
  // explicitly disabled. Add the valid OOXML flag so `UP:名称` stays tight.
  const properties = (paragraph as unknown as { properties: ParagraphProperties }).properties
  properties.push(new OnOffElement('w:autoSpaceDE', false))
  return paragraph
}

function wordHeadingLevel(depth: number) {
  if (depth <= 1) return HeadingLevel.HEADING_1
  if (depth === 2) return HeadingLevel.HEADING_2
  if (depth === 3) return HeadingLevel.HEADING_3
  if (depth === 4) return HeadingLevel.HEADING_4
  if (depth === 5) return HeadingLevel.HEADING_5
  return HeadingLevel.HEADING_6
}

function isStructuredDeepSeekSummary(value: string): boolean {
  return /^##\s+(?:\u7cbe\u51c6\u603b\u7ed3|\u7cbe\u4fee\u6587\u7a3f|\u8be6\u7ec6\u5185\u5bb9\u63d0\u8981|\u5f85\u4eba\u5de5\u786e\u8ba4)/mu.test(value)
}

function structuredSummaryParagraphs(summaryText: string): Paragraph[] {
  const normalizedSummary = normalizeNotePosterTextForDisplay(summaryText)
  if (!isStructuredDeepSeekSummary(normalizedSummary)) return paragraphLines(createSummary(summaryText))

  const paragraphs: Paragraph[] = []
  let activeSection = ''
  let sectionHasContent = false
  let firstHeading = true
  for (const rawLine of createSummary(summaryText).split(/\r?\n/u)) {
    const line = rawLine.trim()
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (headingMatch) {
      if (headingMatch[1]!.length === 2) {
        activeSection = headingMatch[2]!
        sectionHasContent = false
      }
      paragraphs.push(wordHeadingParagraph(
        headingMatch[2]!,
        wordHeadingLevel(headingMatch[1]!.length),
        firstHeading ? 360 : 120
      ))
      firstHeading = false
      continue
    }

    const hasSectionSpacing = /^(?:\u7cbe\u51c6\u603b\u7ed3|\u8be6\u7ec6\u5185\u5bb9\u63d0\u8981|\u5f85\u4eba\u5de5\u786e\u8ba4)/u.test(activeSection)
    const listMatch = /^[-*+]\s+(.+)$/u.exec(line)
    if (listMatch) {
      paragraphs.push(new Paragraph({
        text: listMatch[1]!.trim(),
        bullet: { level: 0 },
        ...(hasSectionSpacing ? { spacing: { after: 160 } } : {})
      }))
      sectionHasContent = true
      continue
    }

    if (!line) {
      if (activeSection === '\u7cbe\u4fee\u6587\u7a3f' && sectionHasContent) paragraphs.push(new Paragraph(' '))
      continue
    }

    paragraphs.push(new Paragraph({
      text: rawLine,
      ...(hasSectionSpacing ? { spacing: { after: 160 } } : {})
    }))
    sectionHasContent = true
  }
  return paragraphs.length > 0 ? paragraphs : [new Paragraph('\u6682\u65e0\u751f\u6210')]
}

function detailedOutlineParagraphs(summaryText: string): Paragraph[] {
  const content = separateListItems(createNotePosterCopyParts(summaryText).detailedOutlineText)
  if (!content) return [new Paragraph('\u6682\u65e0\u751f\u6210')]

  return content.split(/\r?\n/u).flatMap((rawLine) => {
    const line = rawLine.trim()
    if (!line) return []
    const listMatch = /^[-*+]\s+(.+)$/u.exec(line)
    return [new Paragraph({
      text: listMatch ? listMatch[1]!.trim() : rawLine,
      ...(listMatch ? { bullet: { level: 0 } } : {}),
      spacing: { after: 160 }
    })]
  })
}

function preciseSummaryParagraphs(summaryText: string): Paragraph[] {
  const content = separateListItems(
    createNotePosterCopyParts(summaryText).summaryText
      .replace(/(?:^|\n)##\s+详细内容提要[\s\S]*$/u, '')
      .trim()
  )
  if (!content) return [new Paragraph('\u6682\u65e0\u751f\u6210')]

  let firstHeading = true
  return content.split(/\r?\n/u).flatMap((rawLine) => {
    const line = rawLine.trim()
    if (!line) return []
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/u.exec(line)
    if (headingMatch) {
      const heading = wordHeadingParagraph(
        headingMatch[2]!,
        wordHeadingLevel(headingMatch[1]!.length),
        firstHeading ? 360 : 120
      )
      firstHeading = false
      return [heading]
    }
    const listMatch = /^[-*+]\s+(.+)$/u.exec(line)
    return [new Paragraph({
      text: listMatch ? listMatch[1]!.trim() : rawLine,
      ...(listMatch ? { bullet: { level: 0 } } : {}),
      spacing: { after: 160 }
    })]
  })
}

function metadataParagraphs(input: VideoNoteMarkdownExportInput): Paragraph[] {
  const { source } = input.archive
  const author = source.author?.trim()
  const paragraphs = [wordTitleParagraph(source.title)]
  if (author) paragraphs.push(compactMetadataParagraph(`UP:${author}`))
  if (source.bvid) paragraphs.push(compactMetadataParagraph(`BV: ${source.bvid}`))
  if (source.url) paragraphs.push(compactMetadataParagraph(`链接: ${source.url}`))
  paragraphs.push(compactMetadataParagraph(`存档时间: ${input.version.createdAt}`))
  if (source.tags.length > 0) paragraphs.push(compactMetadataParagraph(`标签: ${source.tags.join(', ')}`))
  if (source.description) {
    paragraphs.push(wordHeadingParagraph('简介', HeadingLevel.HEADING_1), ...paragraphLines(source.description))
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
  if (content === 'summary') return structuredSummaryParagraphs(input.version.summaryText)
  if (content === 'summary-precise') return preciseSummaryParagraphs(input.version.summaryText)
  if (content === 'summary-outline') return detailedOutlineParagraphs(input.version.summaryText)
  return paragraphLines(createContent(input, content))
}

function notesParagraphs(version: VideoNoteArchiveVersion): Paragraph[] {
  const notes = createNotes(version)
  return notes ? [wordHeadingParagraph('\u5907\u6ce8', HeadingLevel.HEADING_1), ...paragraphLines(notes.replace(/^## \u5907\u6ce8\r?\n\r?\n?/, ''))] : []
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
      wordHeadingParagraph('\u7eaf\u6587\u7a3f\u8f6c\u5199', HeadingLevel.HEADING_1),
      ...contentParagraphs(input, 'plain'),
      wordHeadingParagraph('\u5e26\u65f6\u95f4\u8f74\u8f6c\u5199', HeadingLevel.HEADING_1),
      ...contentParagraphs(input, 'timed'),
      wordHeadingParagraph('DeepSeek \u603b\u7ed3', HeadingLevel.HEADING_1),
      ...contentParagraphs(input, 'summary')
    )
    if (input.includeNotes) children.push(...notesParagraphs(input.version))
  }
  return new Document({ sections: [{ children }] })
}
