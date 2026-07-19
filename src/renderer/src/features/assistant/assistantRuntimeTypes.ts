import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekArchiveMode,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  FavoriteArchiveMultiMode,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote
} from '@shared/types'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'
import type { OldFavoriteBatchCommitToken } from '../favorites/favoriteLedgerApi'
import type { VideoContentContext } from '../recommendation/videoClassifier'

export type AssistantSnapshot = {
  accountMid?: string
  preferences: AssistantPreferences
  favoriteLedgerStatus: FavoriteLedgerStatus | null
  videoContentContext: VideoContentContext
  videoTitle: string
  activeTabUrl?: string
  runtimeFeedback?: string
  runtimeFeedbackId?: number
}

export type FloatingAssistantActionOptions = {
  coinCount?: 1 | 2
  commentDraft?: string
  submitComment?: boolean
  pageClickOnly?: boolean
}

export type FloatingAssistantWorkspaceTab = 'review' | 'notes' | 'ledger' | 'settings'

export type FloatingAssistantWorkspaceRequest = {
  tab: FloatingAssistantWorkspaceTab
  action?: AssistantAction
  anchor?: { screenX: number; screenY: number }
  openNoteArchive?: boolean
  organizeOldFavorites?: boolean
}

export type AssistantRuntimeRequest =
  | { id: string; type: 'snapshot' }
  | {
      id: string
      type: 'run-action'
      action: AssistantAction
      options?: FloatingAssistantActionOptions
    }
  | { id: string; type: 'generate-video-note'; manualTranscript?: string }
  | { id: string; type: 'generate-video-note-from-audio' }
  | { id: string; type: 'enqueue-current-video-audio'; summarizeWithDeepSeek?: boolean }
  | { id: string; type: 'save-video-note'; note: VideoNote }
  | { id: string; type: 'get-current-video-time' }
  | { id: string; type: 'seek-video-time'; seconds: number }
  | { id: string; type: 'ensure-ledgers' }
  | { id: string; type: 'save-ledgers'; ledgers: FavoriteLedger[]; options?: FavoriteLedgerSaveOptions }
  | { id: string; type: 'open-bilibili-favorites' }
  | {
      id: string
      type: 'scan-old-favorites'
      multiArchiveMode?: FavoriteArchiveMultiMode
    }
  | { id: string; type: 'commit-old-favorite-batch'; token: OldFavoriteBatchCommitToken }
  | { id: string; type: 'read-old-favorite-batch-status' }
  | { id: string; type: 'prepare-old-favorite-scan' }
  | { id: string; type: 'old-favorite-tag-enrichment'; action?: 'read' | 'progress' | 'pause' | 'resume' | 'cancel' | 'cancel-scan' }
  | { id: string; type: 'rejudge-old-favorite'; item: FavoriteLedgerPreviewItem }
  | {
      id: string
      type: 'execute-old-favorite-plan'
      items: FavoriteLedgerPreviewItem[]
      expectedAccountMid?: string
    }
  | {
      id: string
      type: 'organize-old-favorites-with-deepseek'
      mode: DeepSeekArchiveMode
      request: DeepSeekGenerateRequest
    }
  | {
      id: string
      type: 'favorite-repository-bind-page-target'
      accountMid: string
      runId: string
    }
  | {
      id: string
      type: 'favorite-repository-page-operation'
      accountMid: string
      runId: string
      target: FavoriteRepositoryPageTarget
      action: 'append' | 'remove' | 'read-members'
      input: FavoriteRepositoryPageOperationInput
    }
  | { id: string; type: 'old-favorite-workspace-bind-scan-target'; accountMid: string }
  | {
      id: string
      type: 'old-favorite-workspace-inventory'
      accountMid: string
      target: FavoriteRepositoryPageTarget
    }
  | {
      id: string
      type: 'old-favorite-workspace-read-source-page'
      accountMid: string
      target: FavoriteRepositoryPageTarget
      folderId: string
      page: number
      pageSize: number
    }
  | {
      id: string
      type: 'old-favorite-workspace-read-managed-members'
      accountMid: string
      target: FavoriteRepositoryPageTarget
      folderIds: string[]
    }

export type AssistantRuntimeRequestInput = AssistantRuntimeRequest extends infer Request
  ? Request extends { id: string }
    ? Omit<Request, 'id'>
    : never
  : never

export type AssistantRuntimeResponsePayload =
  | AssistantSnapshot
  | AssistantAutomationResult
  | FavoriteLedgerStatus
  | FavoriteLedgerPreview
  | FavoriteLedgerPreviewItem
  | DeepSeekGenerateResult
  | VideoAudioTranscriptionQueueSnapshot
  | VideoNote
  | VideoNote[]
  | number
  | boolean
  | OldFavoriteBatchCommitResult
  | FavoriteRepositoryPageOperationResult
  | { pending: boolean }
  | null

export type FavoriteRepositoryPageOperationInput = {
  accountMid: string
  operationKey: string
  aid: number
  folderIds: string[]
}

export type FavoriteRepositoryPageTarget = {
  webContentsId: number
  instanceId: string
  navigationEpoch: number
}

export type FavoriteRepositoryPageOperationResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
  members?: Record<string, number[]>
  target?: FavoriteRepositoryPageTarget
}

export type OldFavoriteBatchCommitResult = {
  ok: boolean
  committed: boolean
  stale?: boolean
  code?: string
  message?: string
}
