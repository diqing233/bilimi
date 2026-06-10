import type { NoteSourceBundle, SourceQualityAssessment } from './noteTypes'

const RICH_DESCRIPTION_MIN_LENGTH = 80

const PRIMARY_TEXT_TYPES = new Set(['structuredDocument', 'transcript', 'manualSupplement'])

export function scoreNoteSourceBundle(bundle: NoteSourceBundle): SourceQualityAssessment {
  if (bundle.items.length === 0) {
    return { quality: 'insufficient', reason: 'empty_source' }
  }

  const hasPrimaryText = bundle.items.some(
    (item) => PRIMARY_TEXT_TYPES.has(item.type) && item.text.trim().length > 0
  )

  if (hasPrimaryText) {
    return { quality: 'sufficient', reason: 'has_primary_text' }
  }

  const description = bundle.items.find((item) => item.type === 'description')

  if (description && description.text.length >= RICH_DESCRIPTION_MIN_LENGTH) {
    return { quality: 'sufficient', reason: 'has_rich_description' }
  }

  if (description && description.text.length > 0) {
    return { quality: 'partial', reason: 'has_limited_description' }
  }

  return { quality: 'insufficient', reason: 'metadata_only' }
}
