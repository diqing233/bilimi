import type { VideoNote, VideoNoteTimelineItem, TranscriptSegment } from '@shared/types'

function formatTimestamp(seconds: number | null): string {
  if (seconds === null) {
    return '--:--'
  }

  const normalizedSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(normalizedSeconds / 60)
  const remainder = normalizedSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

function listOrEmpty(items: string[], emptyText: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : emptyText
}

function timelineItems(items: VideoNoteTimelineItem[], emptyText: string): string {
  if (items.length === 0) {
    return emptyText
  }

  return items
    .map((item) => `- [${formatTimestamp(item.start)}] ${item.title}：${item.detail}`)
    .join('\n')
}

function transcriptItems(items: TranscriptSegment[]): string {
  if (items.length === 0) {
    return '暂无文稿。'
  }

  return items
    .map((segment) => `- [${formatTimestamp(segment.start)}] ${segment.text}`)
    .join('\n')
}

export function createVideoNoteMarkdown(note: VideoNote): string {
  const annotations = note.annotations ?? []
  const author = note.source.author?.trim() || '未署名'
  const bvid = note.source.bvid?.trim() || '未识别'
  const annotationText =
    annotations.length > 0
      ? annotations
          .map((annotation) => {
            const title = annotation.title.trim() || '未命名批注'
            const body = annotation.body.trim()
            return `- [${formatTimestamp(annotation.start)}] **${title}**${body ? `：${body}` : ''}`
          })
          .join('\n')
      : '暂无批注。'

  return [
    `# ${note.source.title}`,
    '',
    `- UP：${author}`,
    `- BV：${bvid}`,
    `- 链接：${note.source.url}`,
    `- 整理时间：${note.updatedAt}`,
    '',
    '## 速览',
    '',
    listOrEmpty(note.overview.shortSummary, '暂无速览。'),
    '',
    note.overview.keywords.length > 0 ? `关键词：${note.overview.keywords.join('、')}` : '关键词：暂无',
    '',
    '## 时间线',
    '',
    timelineItems(note.overview.timeline, '暂无时间线。'),
    '',
    '## 高光',
    '',
    timelineItems(note.overview.highlights, '暂无高光片段。'),
    '',
    '## 批注',
    '',
    annotationText,
    '',
    '## 文稿',
    '',
    transcriptItems(note.transcript),
    '',
    '## 备注',
    '',
    note.userMemo.trim() || '暂无备注。'
  ].join('\n')
}
