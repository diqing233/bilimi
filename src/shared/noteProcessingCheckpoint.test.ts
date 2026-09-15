import { describe, expect, it } from 'vitest'
import { createNoteProcessingCheckpointKey, isCompatibleNoteProcessingCheckpoint, pruneNoteProcessingCheckpoints } from './noteProcessingCheckpoint'

describe('note processing checkpoint', () => {
  const input = {
    accountMid: '42', videoId: 'BV1test', transcriptHash: 'abc', promptVersion: 'faithful-v1', model: 'deepseek-chat'
  }

  it('keys checkpoints by account, video, transcript, prompt version, and model', () => {
    expect(createNoteProcessingCheckpointKey(input)).toBe('42:BV1test:abc:faithful-v1:deepseek-chat')
  })

  it('rejects a checkpoint from a changed source transcript without changing its source text', () => {
    const checkpoint = { ...input, polishedTranscriptText: 'immutable polished text', completedBatchIds: ['batch-1'], updatedAt: '2026-07-01T00:00:00.000Z' }
    expect(isCompatibleNoteProcessingCheckpoint(checkpoint, { ...input, transcriptHash: 'changed' })).toBe(false)
    expect(checkpoint.polishedTranscriptText).toBe('immutable polished text')
  })

  it('retains only incomplete recent checkpoints within the capacity limit', () => {
    const checkpoints = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [String(index), {
      ...input,
      completedBatchIds: [],
      updatedAt: new Date(Date.UTC(2026, 6, 26, 0, 0, index)).toISOString()
    }]))
    checkpoints.completed = { ...input, completedBatchIds: [], summaryCompleted: true, updatedAt: '2026-07-26T00:00:00.000Z' }
    checkpoints.expired = { ...input, completedBatchIds: [], updatedAt: '2026-06-01T00:00:00.000Z' }

    const pruned = pruneNoteProcessingCheckpoints(checkpoints, Date.parse('2026-07-26T00:00:00.000Z'))

    expect(Object.keys(pruned)).toHaveLength(100)
    expect(pruned.completed).toBeUndefined()
    expect(pruned.expired).toBeUndefined()
  })
})
