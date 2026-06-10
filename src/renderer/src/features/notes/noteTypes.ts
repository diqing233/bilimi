export type VideoDocumentDetectionStatus = 'found' | 'low_confidence' | 'not_found'

export type VideoDocumentProbe = {
  title?: string
  url?: string
  description?: string
  structuredDocumentText?: string
  transcriptText?: string
}

export type VideoDocumentDetectionResult =
  | {
      status: 'found'
      confidence: 0.95
      reason: 'structured_document_detected'
      documentText: string
    }
  | {
      status: 'low_confidence'
      confidence: 0.5
      reason: 'partial_material_detected'
    }
  | {
      status: 'not_found'
      confidence: 0
      reason: 'no_structured_video_document'
    }

export type NoteSourceType =
  | 'structuredDocument'
  | 'transcript'
  | 'description'
  | 'partTitle'
  | 'tag'
  | 'metadata'
  | 'url'
  | 'manualSupplement'

export type NoteSourceItem = {
  type: NoteSourceType
  label: string
  text: string
}

export type NotePageContext = {
  title?: string
  uploaderName?: string
  description?: string
  partTitles?: string[]
  tags?: string[]
  publishedAt?: string
  category?: string
  transcriptText?: string
  structuredDocumentText?: string
  url?: string
}

export type NoteSourceBundle = {
  items: NoteSourceItem[]
}

export type SourceQuality = 'sufficient' | 'partial' | 'insufficient'

export type SourceQualityAssessment = {
  quality: SourceQuality
  reason:
    | 'has_primary_text'
    | 'has_rich_description'
    | 'has_limited_description'
    | 'metadata_only'
    | 'empty_source'
}

export type NoteSummaryStatus = 'complete' | 'limited' | 'needs_supplement'

export type NoteSummary = {
  status: NoteSummaryStatus
  oneSentence: string
  keyPoints: string[]
  worthRevisiting: string[]
  openQuestions: string[]
  tags: string[]
  sourceNotice: '据视频文档拟札' | '据页面材料拟札' | '据补充材料拟札' | '材料有限，待补后再拟'
}

export type ManualSourcePromptModel = {
  readonly title: '未识得视频文档'
  readonly message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。'
  readonly acceptedMaterials: readonly ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
}

export type NoteFallbackFlowInput = {
  pageContext: NotePageContext
  manualSupplement?: string
}

export type NoteFallbackFlowResult =
  | {
      mode: 'summary_ready'
      detection: VideoDocumentDetectionResult
      sourceBundle: NoteSourceBundle
      assessment: SourceQualityAssessment
      summary: NoteSummary
    }
  | {
      mode: 'needs_manual_input'
      detection: VideoDocumentDetectionResult
      sourceBundle: NoteSourceBundle
      assessment: SourceQualityAssessment
      prompt: ManualSourcePromptModel
    }
