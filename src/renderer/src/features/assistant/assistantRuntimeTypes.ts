import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  DeepSeekGenerateResult,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  FavoriteLedgerStatus,
  VideoAudioTranscriptionQueueSnapshot,
  VideoNote
} from '@shared/types'
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
      action: FavoriteRepositoryPageOperationAction
      input: FavoriteRepositoryPageOperationInput | FavoriteRepositoryFolderInventoryInput | FavoriteRepositoryFolderCreateInput
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
  | VideoAudioTranscriptionQueueSnapshot
  | VideoNote
  | VideoNote[]
  | number
  | boolean
  | FavoriteRepositoryPageOperationResult
  | { pending: boolean }
  | null

export type FavoriteRepositoryPageOperationInput = {
  accountMid: string
  operationKey: string
  aid: number
  folderIds: string[]
}

export type FavoriteRepositoryFolderInventoryInput = { accountMid: string; operationKey: string }
export type FavoriteRepositoryFolderCreateInput = { accountMid: string; operationKey: string; title: string }
export type FavoriteRepositoryPageOperationAction =
  | 'append'
  | 'remove'
  | 'read-members'
  | 'read-folder-inventory'
  | 'create-folder'

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
  folders?: Array<{ id: string; title: string; memberCount: number }>
  folder?: { id: string; title: string; memberCount: number }
  target?: FavoriteRepositoryPageTarget
}
