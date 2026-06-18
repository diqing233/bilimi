import { createVideoNoteId } from '@shared/videoNotes'
import type {
  TranscriptChapter,
  TranscriptSegment,
  VideoNote,
  VideoNoteOverview,
  VideoNoteSourceMetadata,
  VideoNoteTimelineItem,
  VideoNoteTranscriptSource
} from '@shared/types'
import { normalizeTranscriptSegments } from './transcriptNormalizer'

type CreateLocalVideoNoteDraftInput = {
  now: string
  source: VideoNoteSourceMetadata
  transcriptSource: VideoNoteTranscriptSource
  transcript: TranscriptSegment[]
  userMemo?: string
}

const STOP_WORDS = new Set(['这个', '然后', '就是', '我们', '你们', '他们', '一个', '一些', '以及', '因为', '所以'])

function splitTextWords(value: string): string[] {
  return Array.from(value.matchAll(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2,6}/g)).map((match) => match[0])
}

function extractKeywords(source: VideoNoteSourceMetadata, transcript: TranscriptSegment[]): string[] {
  const scores = new Map<string, number>()
  const weightedText = [source.title, source.description, ...(source.tags ?? []), ...transcript.map((segment) => segment.text)].join(' ')

  for (const word of splitTextWords(weightedText)) {
    if (STOP_WORDS.has(word)) {
      continue
    }

    scores.set(word, (scores.get(word) ?? 0) + (source.title.includes(word) || source.tags.includes(word) ? 3 : 1))
  }

  return Array.from(scores.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([word]) => word)
}

function createChapters(transcript: TranscriptSegment[]): TranscriptChapter[] {
  if (transcript.length === 0) {
    return []
  }

  const chapters: TranscriptChapter[] = []
  let currentIndexes: number[] = []
  let currentStart = transcript[0].start

  transcript.forEach((segment, index) => {
    const previous = transcript[index - 1]
    const gap = previous?.end !== null && segment.start !== null && previous?.end !== undefined ? segment.start - previous.end : 0

    if (currentIndexes.length > 0 && (gap > 45 || currentIndexes.length >= 6)) {
      const firstIndex = currentIndexes[0]
      const firstSegment = transcript[firstIndex]
      chapters.push({
        start: currentStart,
        title: firstSegment.text.slice(0, 18),
        summary: transcript[currentIndexes[0]].text,
        segmentIndexes: currentIndexes
      })
      currentIndexes = []
      currentStart = segment.start
    }

    currentIndexes.push(index)
  })

  if (currentIndexes.length > 0) {
    const firstSegment = transcript[currentIndexes[0]]
    chapters.push({
      start: currentStart,
      title: firstSegment.text.slice(0, 18),
      summary: firstSegment.text,
      segmentIndexes: currentIndexes
    })
  }

  return chapters
}

function createOverview(chapters: TranscriptChapter[], keywords: string[]): VideoNoteOverview {
  if (chapters.length === 0) {
    return {
      shortSummary: ['尚未取得文稿，可先转写音频后再整理。'],
      keywords,
      timeline: [],
      highlights: []
    }
  }

  const timeline: VideoNoteTimelineItem[] = chapters.map((chapter) => ({
    start: chapter.start,
    title: chapter.title,
    detail: chapter.summary
  }))
  const keyChapters = chapters.slice(0, 2)
  const revisitChapters = chapters
    .filter((chapter) => chapter.start !== null)
    .slice(0, 2)
  const shortSummary = [
    `一句话：${chapters[0].summary}`,
    ...keyChapters.map((chapter) => `核心要点：${chapter.summary}`),
    ...(revisitChapters[0] ? [`值得复看：${revisitChapters[0].summary}`] : []),
    '待查问题：这些方法如何迁移到你的真实项目里？'
  ].slice(0, 5)

  return {
    shortSummary,
    keywords,
    timeline,
    highlights: revisitChapters.map((chapter) => ({
      start: chapter.start,
      title: '值得复看',
      detail: chapter.summary
    }))
  }
}

export function createLocalVideoNoteDraft(input: CreateLocalVideoNoteDraftInput): VideoNote {
  const transcript = normalizeTranscriptSegments(input.transcript)
  const chapters = createChapters(transcript)
  const keywords = extractKeywords(input.source, transcript)
  const overview = createOverview(chapters, keywords)

  return {
    id: createVideoNoteId(input.source),
    source: input.source,
    transcriptSource: input.transcriptSource,
    transcript,
    chapters,
    overview,
    annotations: [],
    userMemo: input.userMemo ?? '',
    createdAt: input.now,
    updatedAt: input.now
  }
}
