import type { NotePageContext, NoteSourceBundle, NoteSourceItem } from './noteTypes'

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

function pushText(items: NoteSourceItem[], type: NoteSourceItem['type'], label: string, text: string | undefined) {
  const normalized = normalizeText(text)
  if (normalized.length > 0) {
    items.push({ type, label, text: normalized })
  }
}

export function collectNoteSources(context: NotePageContext, manualSupplement?: string): NoteSourceBundle {
  const items: NoteSourceItem[] = []

  pushText(items, 'structuredDocument', '视频文档', context.structuredDocumentText)
  pushText(items, 'transcript', '字幕', context.transcriptText)
  pushText(items, 'description', '简介', context.description)
  pushText(items, 'metadata', '标题', context.title)
  pushText(items, 'metadata', 'UP 主', context.uploaderName)
  pushText(items, 'metadata', '分区', context.category)
  pushText(items, 'metadata', '发布时间', context.publishedAt)

  for (const partTitle of context.partTitles ?? []) {
    pushText(items, 'partTitle', '分P', partTitle)
  }

  for (const tag of context.tags ?? []) {
    pushText(items, 'tag', '标签', tag)
  }

  pushText(items, 'url', '页面', context.url)
  pushText(items, 'manualSupplement', '补充材料', manualSupplement)

  return { items }
}
