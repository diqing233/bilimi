import type { TranscriptSegment } from '../../../src/shared/types'

export type TranscriptionModelId =
  | 'sensevoice-small'
  | 'whisper-small'
  | 'faster-whisper-large-v3-turbo'
  | 'faster-whisper-large-v3'

export type TranscriptionRuntimeFamily = 'sensevoice' | 'whisper.cpp' | 'faster-whisper'

export type TranscriptionProvider = {
  id: TranscriptionModelId
  runtimeFamily: TranscriptionRuntimeFamily
  transcribeSegment(input: { path: string; offsetSeconds: number; signal?: AbortSignal }): Promise<TranscriptSegment[]>
}
