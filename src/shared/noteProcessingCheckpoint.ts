export type NoteProcessingCorrection = {
  segmentId: string
  originalText: string
  replacementText: string
  changeType: 'punctuation' | 'sentence-boundary' | 'transcription-error' | 'formatting'
  reason: string
  confidence: number
  highRisk: boolean
}

export type NoteProcessingReviewItem = {
  segmentId: string
  originalText: string
  reason: string
  possibleInterpretation?: string
}

export type NoteProcessingCheckpointIdentity = {
  accountMid: string
  videoId: string
  transcriptHash: string
  promptVersion: string
  model: string
}

export type NoteProcessingCheckpoint = NoteProcessingCheckpointIdentity & {
  completedBatchIds: string[]
  polishedTextBySegmentId?: Record<string, string>
  polishedTranscriptText?: string
  corrections?: NoteProcessingCorrection[]
  reviewItems?: NoteProcessingReviewItem[]
  proofreadingCompleted?: boolean
  summaryCompleted?: boolean
  updatedAt: string
}

export function createNoteProcessingCheckpointKey(identity: NoteProcessingCheckpointIdentity): string {
  return [identity.accountMid, identity.videoId, identity.transcriptHash, identity.promptVersion, identity.model].join(':')
}

export const NOTE_PROCESSING_CHECKPOINT_MAX_ENTRIES = 100
export const NOTE_PROCESSING_CHECKPOINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function pruneNoteProcessingCheckpoints(
  checkpoints: Record<string, NoteProcessingCheckpoint>,
  now = Date.now()
): Record<string, NoteProcessingCheckpoint> {
  return Object.fromEntries(
    Object.entries(checkpoints)
      .filter(([, checkpoint]) => !checkpoint.summaryCompleted &&
        Number.isFinite(Date.parse(checkpoint.updatedAt)) &&
        now - Date.parse(checkpoint.updatedAt) <= NOTE_PROCESSING_CHECKPOINT_MAX_AGE_MS)
      .sort(([, left], [, right]) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, NOTE_PROCESSING_CHECKPOINT_MAX_ENTRIES)
  )
}

export function isCompatibleNoteProcessingCheckpoint(
  checkpoint: NoteProcessingCheckpointIdentity,
  identity: NoteProcessingCheckpointIdentity
): boolean {
  return createNoteProcessingCheckpointKey(checkpoint) === createNoteProcessingCheckpointKey(identity)
}
