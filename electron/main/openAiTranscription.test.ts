import { describe, expect, it, vi } from 'vitest'
import {
  buildOpenAiTranscriptionForm,
  mapVerboseTranscriptionToSegments,
  transcribeAudioSegment
} from './openAiTranscription'

describe('open ai transcription', () => {
  it('maps verbose transcription segments to transcript segments with offsets', () => {
    expect(
      mapVerboseTranscriptionToSegments(
        {
          segments: [
            { start: 0.5, end: 2.25, text: ' intro ' },
            { start: 3, end: 5, text: '' }
          ]
        },
        600
      )
    ).toEqual([{ start: 600.5, end: 602.25, text: 'intro' }])
  })

  it('builds a whisper-1 transcription form', () => {
    const form = buildOpenAiTranscriptionForm({
      file: new Blob(['audio']),
      filename: 'segment-000.mp3'
    })

    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('verbose_json')
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('throws an actionable authentication error for 401 responses', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'bad key'
    })

    await expect(
      transcribeAudioSegment({
        apiKey: 'sk-test',
        path: 'C:/tmp/segment.mp3',
        offsetSeconds: 0,
        readFile: vi.fn().mockResolvedValue(Buffer.from('audio')),
        fetch
      })
    ).rejects.toThrow('OpenAI API key is invalid or missing')
  })
})
