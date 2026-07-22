import { describe, expect, it } from 'vitest'
import { toDeepSeekFeedbackView } from './oldFavoriteDeepSeekFeedbackModel'

describe('toDeepSeekFeedbackView', () => {
  const progress = {
    completedChunks: 1,
    totalChunks: 2,
    totalVideoCount: 21,
    successfulVideoCount: 20,
    failedVideoCount: 0
  }

  it('shows a running task with a cancel action and normalized progress', () => {
    expect(toDeepSeekFeedbackView({ status: 'running', message: 'Organizing', progress }, false)).toMatchObject({
      kind: 'running',
      action: 'cancel',
      summary: 'Organizing',
      progress: { completedChunks: 1, totalChunks: 2, completedVideos: 20, totalVideos: 21, value: 50 }
    })
  })

  it('shows cancelling while a running task is waiting for cancellation', () => {
    expect(toDeepSeekFeedbackView({ status: 'running', message: 'Organizing' }, true)).toMatchObject({
      kind: 'running',
      action: 'cancelling'
    })
  })

  it('keeps failed batch context available for retry', () => {
    const failure = { chunkIndex: 3, affectedVideoCount: 7, message: 'incomplete current-segment' }

    expect(toDeepSeekFeedbackView({ status: 'failed', message: 'Failed', failures: [failure] }, false)).toMatchObject({
      kind: 'failed',
      action: 'retry',
      failures: [failure]
    })
  })

  it('keeps canceled in-flight batch failures available for retry', () => {
    const failure = { chunkIndex: 4, affectedVideoCount: 2, message: 'Canceled after request started' }

    expect(toDeepSeekFeedbackView({ status: 'canceled', message: 'Canceled', failures: [failure] }, false)).toMatchObject({
      kind: 'completed',
      action: 'retry',
      failures: [failure]
    })
  })

  it('does not offer an action after successful completion', () => {
    expect(toDeepSeekFeedbackView({ status: 'completed', message: 'Completed', failures: [] }, false)).toMatchObject({
      kind: 'completed',
      action: 'none'
    })
  })
})
