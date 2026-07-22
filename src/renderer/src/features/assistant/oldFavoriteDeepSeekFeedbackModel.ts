import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'

export type DeepSeekFeedbackView = {
  kind: 'running' | 'failed' | 'completed'
  action: 'cancel' | 'cancelling' | 'retry' | 'none'
  summary: string
  progress?: {
    completedChunks: number
    totalChunks: number
    completedVideos: number
    totalVideos: number
    value: number
  }
  failures: Array<{ chunkIndex: number; affectedVideoCount: number; message: string }>
}

export function toDeepSeekFeedbackView(
  feedback: DeepSeekWorkspaceFeedback,
  cancelRequested: boolean
): DeepSeekFeedbackView {
  const failures = feedback.failures ?? []
  const progress = feedback.progress ? {
    completedChunks: feedback.progress.completedChunks,
    totalChunks: feedback.progress.totalChunks,
    completedVideos: feedback.progress.successfulVideoCount + feedback.progress.failedVideoCount,
    totalVideos: feedback.progress.totalVideoCount,
    value: feedback.progress.totalChunks > 0
      ? Math.round((feedback.progress.completedChunks / feedback.progress.totalChunks) * 100)
      : 0
  } : undefined

  if (feedback.status === 'running') {
    return {
      kind: 'running',
      action: cancelRequested ? 'cancelling' : 'cancel',
      summary: feedback.message,
      progress,
      failures
    }
  }

  if (feedback.status === 'failed') {
    return {
      kind: 'failed',
      action: failures.length ? 'retry' : 'none',
      summary: feedback.message,
      progress,
      failures
    }
  }

  return { kind: 'completed', action: 'none', summary: feedback.message, progress, failures }
}
