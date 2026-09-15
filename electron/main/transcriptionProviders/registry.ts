import type { TranscriptionModelId, TranscriptionRuntimeFamily } from './types'

export type TranscriptionProviderDescriptor = {
  id: TranscriptionModelId
  runtimeFamily: TranscriptionRuntimeFamily
}

const PROVIDERS: Record<TranscriptionModelId, TranscriptionProviderDescriptor> = {
  'sensevoice-small': { id: 'sensevoice-small', runtimeFamily: 'sensevoice' },
  'whisper-small': { id: 'whisper-small', runtimeFamily: 'whisper.cpp' },
  'faster-whisper-large-v3-turbo': { id: 'faster-whisper-large-v3-turbo', runtimeFamily: 'faster-whisper' },
  'faster-whisper-large-v3': { id: 'faster-whisper-large-v3', runtimeFamily: 'faster-whisper' }
}

export function resolveTranscriptionProvider(id: TranscriptionModelId): TranscriptionProviderDescriptor {
  return PROVIDERS[id]
}
