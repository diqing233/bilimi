import type { VideoDocumentDetectionResult, VideoDocumentProbe } from './noteTypes'

const RICH_DESCRIPTION_MIN_LENGTH = 120

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

export function detectVideoDocument(probe: VideoDocumentProbe): VideoDocumentDetectionResult {
  const structuredDocumentText = normalizeText(probe.structuredDocumentText)

  if (structuredDocumentText.length > 0) {
    return {
      status: 'found',
      confidence: 0.95,
      reason: 'structured_document_detected',
      documentText: structuredDocumentText
    }
  }

  const transcriptText = normalizeText(probe.transcriptText)
  const description = normalizeText(probe.description)

  if (transcriptText.length > 0 || description.length >= RICH_DESCRIPTION_MIN_LENGTH) {
    return {
      status: 'low_confidence',
      confidence: 0.5,
      reason: 'partial_material_detected'
    }
  }

  return {
    status: 'not_found',
    confidence: 0,
    reason: 'no_structured_video_document'
  }
}
