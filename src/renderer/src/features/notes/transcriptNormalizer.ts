import type { TranscriptSegment } from '@shared/types'

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseTimestamp(value: string): number | null {
  const match = value.match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(.*)$/)

  if (!match) {
    return null
  }

  const first = Number(match[1])
  const second = Number(match[2])
  const third = match[3] ? Number(match[3]) : null

  return third === null ? first * 60 + second : first * 3600 + second * 60 + third
}

function removeTimestamp(value: string): string {
  return value.replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*/, '').trim()
}

export function normalizeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized: TranscriptSegment[] = []

  for (const segment of segments) {
    const text = cleanText(segment.text)

    if (!text || normalized.at(-1)?.text === text) {
      continue
    }

    normalized.push({
      start: segment.start,
      end: segment.end,
      text
    })
  }

  return normalized
}

export function parseManualTranscript(value: string): TranscriptSegment[] {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)

  return normalizeTranscriptSegments(
    lines.map((line) => ({
      start: parseTimestamp(line),
      end: null,
      text: cleanText(removeTimestamp(line))
    }))
  )
}
