import type {
  ManualSourcePromptModel,
  NoteFallbackFlowInput,
  NoteFallbackFlowResult
} from './noteTypes'
import { collectNoteSources } from './noteSourceCollector'
import { createNoteSummary } from './noteSummarizer'
import { scoreNoteSourceBundle } from './sourceQualityScorer'
import { detectVideoDocument } from './videoDocumentDetector'

const MANUAL_SOURCE_PROMPT: ManualSourcePromptModel = {
  title: '未识得视频文档',
  message: '现有材料不足成札。若赐下字幕、文稿或观后零札，便可再拟一版。',
  acceptedMaterials: ['字幕或 AI 字幕', '视频文稿或简介', '观后零札']
}

export function runNoteFallbackFlow(input: NoteFallbackFlowInput): NoteFallbackFlowResult {
  const detection = detectVideoDocument(input.pageContext)
  const sourceBundle = collectNoteSources(input.pageContext, input.manualSupplement)
  const assessment = scoreNoteSourceBundle(sourceBundle)

  if (assessment.quality === 'insufficient') {
    return {
      mode: 'needs_manual_input',
      detection,
      sourceBundle,
      assessment,
      prompt: MANUAL_SOURCE_PROMPT
    }
  }

  return {
    mode: 'summary_ready',
    detection,
    sourceBundle,
    assessment,
    summary: createNoteSummary(sourceBundle, assessment)
  }
}
