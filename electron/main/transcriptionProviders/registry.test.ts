import { describe, expect, it } from 'vitest'
import { resolveTranscriptionProvider } from './registry'

describe('transcription provider registry', () => {
  it('keeps each queued model bound to one provider family', () => {
    expect(resolveTranscriptionProvider('sensevoice-small')).toMatchObject({ id: 'sensevoice-small', runtimeFamily: 'sensevoice' })
    expect(resolveTranscriptionProvider('whisper-small')).toMatchObject({ id: 'whisper-small', runtimeFamily: 'whisper.cpp' })
    expect(resolveTranscriptionProvider('faster-whisper-large-v3-turbo')).toMatchObject({ runtimeFamily: 'faster-whisper' })
    expect(resolveTranscriptionProvider('faster-whisper-large-v3')).toMatchObject({ runtimeFamily: 'faster-whisper' })
  })
})
