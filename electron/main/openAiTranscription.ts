import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { TranscriptSegment } from '../../src/shared/types'

type VerboseTranscription = {
  segments?: Array<{
    start?: number
    end?: number
    text?: string
  }>
}

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function mapVerboseTranscriptionToSegments(
  payload: VerboseTranscription,
  offsetSeconds: number
): TranscriptSegment[] {
  return (payload.segments ?? [])
    .map((segment) => ({
      start: typeof segment.start === 'number' ? segment.start + offsetSeconds : null,
      end: typeof segment.end === 'number' ? segment.end + offsetSeconds : null,
      text: cleanText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function buildOpenAiTranscriptionForm({
  file,
  filename
}: {
  file: Blob
  filename: string
}): FormData {
  const form = new FormData()
  form.set('model', 'whisper-1')
  form.set('response_format', 'verbose_json')
  form.set('file', new File([file], filename, { type: 'audio/mpeg' }))
  return form
}

function openAiErrorMessage(status: number): string {
  if (status === 401) {
    return 'OpenAI API key is invalid or missing.'
  }

  return 'Transcription request failed. Check network, quota, or retry later.'
}

export async function transcribeAudioSegment({
  apiKey,
  path,
  offsetSeconds,
  readFile: read = readFile,
  fetch: fetchImpl = fetch
}: {
  apiKey: string
  path: string
  offsetSeconds: number
  readFile?: typeof readFile
  fetch?: typeof fetch
}): Promise<TranscriptSegment[]> {
  const bytes = await read(path)
  const form = buildOpenAiTranscriptionForm({
    file: new Blob([bytes]),
    filename: basename(path)
  })
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  })

  if (!response.ok) {
    throw new Error(openAiErrorMessage(response.status))
  }

  return mapVerboseTranscriptionToSegments(await response.json(), offsetSeconds)
}
