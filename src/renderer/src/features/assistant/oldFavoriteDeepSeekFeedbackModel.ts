import type { DeepSeekWorkspaceFeedback } from './useOldFavoriteWorkspace'

export type DeepSeekFeedbackView = {
  kind: 'running' | 'failed' | 'completed'
  action: 'cancel' | 'cancelling' | 'retry' | 'none'
  summary: string
  progress?: {
    settledGroups: number
    totalGroups: number
    appliedVideos: number
    pendingVideos: number
    failedVideos: number
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
  const progress = feedback.progress ? (() => {
    const appliedVideos = feedback.progress.successfulVideoCount
    const failedVideos = feedback.progress.failedVideoCount
    const pendingVideos = Math.max(0, feedback.progress.totalVideoCount - appliedVideos - failedVideos)
    return {
      settledGroups: feedback.progress.completedChunks,
      totalGroups: feedback.progress.totalChunks,
      appliedVideos,
      pendingVideos,
      failedVideos,
      totalVideos: feedback.progress.totalVideoCount,
      value: feedback.progress.totalVideoCount > 0
        ? Math.round((appliedVideos / feedback.progress.totalVideoCount) * 100)
        : 0
    }
  })() : undefined

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

  return { kind: 'completed', action: failures.length ? 'retry' : 'none', summary: feedback.message, progress, failures }
}
