import type { NoteSourceBundle, NoteSourceItem, NoteSummary, SourceQualityAssessment } from './noteTypes'

const PRIMARY_TYPES: NoteSourceItem['type'][] = ['structuredDocument', 'transcript', 'manualSupplement', 'description']

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function pickPrimaryText(bundle: NoteSourceBundle): NoteSourceItem | undefined {
  return PRIMARY_TYPES.map((type) => bundle.items.find((item) => item.type === type)).find(Boolean)
}

function collectTags(bundle: NoteSourceBundle): string[] {
  return bundle.items
    .filter((item) => item.type === 'tag')
    .map((item) => item.text)
    .slice(0, 6)
}

function sourceNoticeFor(primary: NoteSourceItem | undefined, quality: SourceQualityAssessment): NoteSummary['sourceNotice'] {
  if (quality.quality !== 'sufficient') {
    return '材料有限，待补后再拟'
  }

  if (primary?.type === 'structuredDocument') {
    return '据视频文档拟札'
  }

  if (primary?.type === 'manualSupplement') {
    return '据补充材料拟札'
  }

  return '据页面材料拟札'
}

export function createNoteSummary(bundle: NoteSourceBundle, assessment: SourceQualityAssessment): NoteSummary {
  if (assessment.quality === 'insufficient') {
    return {
      status: 'needs_supplement',
      oneSentence: '材料不足，待补字幕、文稿或观后零札。',
      keyPoints: [],
      worthRevisiting: [],
      openQuestions: ['需要补充视频主体内容后才能生成可靠札记。'],
      tags: [],
      sourceNotice: '材料有限，待补后再拟'
    }
  }

  const primary = pickPrimaryText(bundle)
  const sentences = splitSentences(primary?.text ?? '')
  const keyPoints = sentences.slice(0, 5)
  const tags = collectTags(bundle)

  if (assessment.quality === 'partial') {
    return {
      status: 'limited',
      oneSentence: keyPoints[0] ?? '现有材料只够形成轻量札记。',
      keyPoints: keyPoints.slice(0, 3),
      worthRevisiting: [],
      openQuestions: ['现有材料不足，需补充字幕、文稿或观后记录后再确认细节。'],
      tags,
      sourceNotice: '材料有限，待补后再拟'
    }
  }

  return {
    status: 'complete',
    oneSentence: keyPoints[0] ?? '已据现有材料拟成札记。',
    keyPoints,
    worthRevisiting: keyPoints.slice(0, 2),
    openQuestions: [],
    tags,
    sourceNotice: sourceNoticeFor(primary, assessment)
  }
}
