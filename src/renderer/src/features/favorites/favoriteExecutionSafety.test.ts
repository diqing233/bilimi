import { describe, expect, it } from 'vitest'
import { evaluateFavoriteExecutionSafety } from './favoriteExecutionSafety'

describe('evaluateFavoriteExecutionSafety', () => {
  it('blocks execution when any formal membership snapshot is incomplete', () => {
    expect(evaluateFavoriteExecutionSafety({
      expectedFormalTargetIds: ['game'],
      targetResults: [],
      formalMembershipComplete: false,
      stagingFolderIds: ['staging']
    })).toEqual({
      canExecute: false,
      status: 'blocked',
      reason: 'formal-membership-incomplete',
      removeFromStagingFolderIds: []
    })
  })

  it('keeps staging when every formal target fails', () => {
    expect(evaluateFavoriteExecutionSafety({
      expectedFormalTargetIds: ['game', 'knowledge'],
      targetResults: [
        { targetId: 'game', state: 'failed' },
        { targetId: 'knowledge', state: 'failed' }
      ],
      formalMembershipComplete: true,
      stagingFolderIds: ['staging', 'staging-2']
    })).toMatchObject({
      canExecute: true,
      status: 'failed',
      removeFromStagingFolderIds: []
    })
  })

  it('removes all staging shards after at least one formal target lands and reports partial completion', () => {
    expect(evaluateFavoriteExecutionSafety({
      expectedFormalTargetIds: ['game', 'knowledge'],
      targetResults: [
        { targetId: 'game', state: 'succeeded' },
        { targetId: 'knowledge', state: 'failed' }
      ],
      formalMembershipComplete: true,
      stagingFolderIds: ['staging', 'staging-2']
    })).toEqual({
      canExecute: true,
      status: 'partial',
      landedFormalTargetIds: ['game'],
      failedFormalTargetIds: ['knowledge'],
      removeFromStagingFolderIds: ['staging', 'staging-2']
    })
  })

  it('treats existing formal membership as a successful landing and preserves unknown results for reconciliation', () => {
    expect(evaluateFavoriteExecutionSafety({
      expectedFormalTargetIds: ['game', 'knowledge'],
      targetResults: [
        { targetId: 'game', state: 'already-member' },
        { targetId: 'knowledge', state: 'unknown' }
      ],
      formalMembershipComplete: true,
      stagingFolderIds: ['staging']
    })).toEqual({
      canExecute: true,
      status: 'result-unknown',
      landedFormalTargetIds: ['game'],
      unknownFormalTargetIds: ['knowledge'],
      removeFromStagingFolderIds: []
    })
  })
})
