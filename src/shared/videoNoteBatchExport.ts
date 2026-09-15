export type VideoNoteBatchExportFormat = 'markdown' | 'word'
export type VideoNoteBatchExportScope = 'current' | 'complete'
export type VideoNoteBatchExportCurrentContent =
  | 'plain'
  | 'timed'
  | 'summary'
  | 'summary-precise'
  | 'summary-outline'
  | 'summary-polished'

export type VideoNoteBatchArchiveSelection = { archiveId: string; versionId: string }

export type VideoNoteBatchExportRequest = {
  accountMid: string
  selections: VideoNoteBatchArchiveSelection[]
  formats: VideoNoteBatchExportFormat[]
  scope?: VideoNoteBatchExportScope
  currentContent?: VideoNoteBatchExportCurrentContent
  includeNotes?: boolean
}

export type VideoNoteBatchExportStartRequest = VideoNoteBatchExportRequest & { batchId: string }
export type VideoNoteBatchExportPreview = {
  selectedCount: number
  exportableCount: number
  skippedCount: number
  hasNotes?: boolean
}
export type VideoNoteBatchExportItemResult = {
  archiveId: string
  versionId: string
  title?: string
  status: 'succeeded' | 'skipped' | 'failed' | 'canceled'
  files: string[]
  error?: string
}
export type VideoNoteBatchExportResult = {
  batchId?: string
  folderPath?: string
  selectedCount?: number
  exportableCount?: number
  succeededCount: number
  skippedCount: number
  failedCount: number
  canceled?: boolean
  items?: VideoNoteBatchExportItemResult[]
}
export type VideoNoteBatchExportProgress = {
  batchId: string
  selectedCount: number
  completedCount: number
  succeededCount: number
  skippedCount: number
  failedCount: number
}
export type VideoNoteBatchFolderRequest = { batchId: string; accountMid: string }
