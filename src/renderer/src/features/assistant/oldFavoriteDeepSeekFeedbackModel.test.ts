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
      progress: { settledGroups: 1, totalGroups: 2, appliedVideos: 20, pendingVideos: 1, failedVideos: 0, totalVideos: 21, value: 95 }
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

  it('reports applied videos separately from failed videos', () => {
    const view = toDeepSeekFeedbackView({
      status: 'failed',
      message: 'Waiting for retry',
      progress: {
        completedChunks: 7,
        totalChunks: 7,
        totalVideoCount: 129,
        successfulVideoCount: 89,
        failedVideoCount: 40
      },
      failures: [{ chunkIndex: 5, affectedVideoCount: 40, message: 'timeout' }]
    }, false)

    expect(view.progress).toMatchObject({
      settledGroups: 7,
      totalGroups: 7,
      appliedVideos: 89,
      failedVideos: 40,
      pendingVideos: 0,
      totalVideos: 129,
      value: 69
    })
  })

  it('keeps the video denominator stable when timeout recovery adds request groups', () => {
    const view = toDeepSeekFeedbackView({
      status: 'running',
      message: 'Retrying split groups',
      progress: {
        completedChunks: 4,
        totalChunks: 9,
        totalVideoCount: 129,
        successfulVideoCount: 89,
        failedVideoCount: 0
      }
    }, false)

    expect(view.progress).toMatchObject({
      settledGroups: 4,
      totalGroups: 9,
      appliedVideos: 89,
      pendingVideos: 40,
      totalVideos: 129,
      value: 69
    })
  })
})
