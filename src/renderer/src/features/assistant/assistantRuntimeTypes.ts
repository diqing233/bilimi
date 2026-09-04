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
import type { MultipartVideoSnapshot } from '../notes/videoNoteMultipart'
import type { VideoContentContext } from '../recommendation/videoClassifier'

export type AssistantSnapshot = {
  accountMid?: string
  /** Device-local account identity used only by the saved unbacked ledger toggle. */
  localFavoriteToggleAccountMid?: string
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
  confirmNewFavoriteShards?: boolean
}

export type FloatingAssistantWorkspaceTab = 'review' | 'notes' | 'ledger' | 'settings'

export type FavoriteLibraryWorkspaceSelection = {
  kind: 'scope'
  scope: { kind: 'all' | 'pending' | 'protected' | 'unsynced' } | { kind: 'folder'; folderId: string }
  options: {
    query?: string
    filter?: 'all' | 'pending' | 'protected' | 'unsynced'
    sort?: 'updated-desc' | 'updated-asc' | 'title-asc' | 'title-desc'
    transcriptionFilters?: Array<'completed' | 'none' | 'pending' | 'running' | 'failed'>
  }
  excludedAids: number[]
}

export type FloatingAssistantWorkspaceRequest = {
  tab: FloatingAssistantWorkspaceTab
  /** Opens the persistent sidebar rather than the floating pet workspace. */
  sidebar?: boolean
  action?: AssistantAction
  anchor?: { screenX: number; screenY: number }
  openNoteArchive?: boolean
  organizeOldFavorites?: boolean
  /** Explicit Favorite Library selection for a small reorganization workspace. */
  selectedFavoriteAids?: number[]
  /** Full-result Favorite Library scope; main resolves it without expanding AIDs in the renderer. */
  selectedFavoriteSelection?: FavoriteLibraryWorkspaceSelection
  /** Stable local ledger identity requested by the Favorite Library. */
  ledgerId?: string
  /** Display title used when the requested local draft is no longer in preferences. */
  ledgerTitle?: string
  /** Opens a new local ledger editor. */
  createLedger?: boolean
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
  | { id: string; type: 'read-current-video-multipart' }
  | { id: string; type: 'save-video-note'; note: VideoNote }
  | { id: string; type: 'get-current-video-time' }
  | { id: string; type: 'seek-video-time'; seconds: number }
  | { id: string; type: 'ensure-ledgers' }
  | { id: string; type: 'ensure-ledger'; logicalFolderId: string; options?: FavoriteLedgerSaveOptions }
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
      input: FavoriteRepositoryPageOperationInput | FavoriteRepositoryUnfavoriteInput | FavoriteRepositoryFolderInventoryInput | FavoriteRepositoryFolderCreateInput | FavoriteRepositoryFolderDeleteInput | FavoriteRepositoryFolderRenameInput
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
      type: 'old-favorite-workspace-read-video-tags'
      accountMid: string
      target: FavoriteRepositoryPageTarget
      aid: number
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
  | MultipartVideoSnapshot
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

/** A global Bilibili favorite toggle has no folder target by design. */
export type FavoriteRepositoryUnfavoriteInput = { accountMid: string; operationKey: string; aid: number }

export type FavoriteRepositoryFolderInventoryInput = { accountMid: string; operationKey: string }
export type FavoriteRepositoryFolderCreateInput = { accountMid: string; operationKey: string; title: string }
export type FavoriteRepositoryFolderDeleteInput = { accountMid: string; operationKey: string; folderId: string }
export type FavoriteRepositoryFolderRenameInput = { accountMid: string; operationKey: string; folderId: string; title: string }
export type FavoriteRepositoryPageOperationAction =
  | 'append'
  | 'remove'
  | 'unfavorite'
  | 'read-members'
  | 'read-folder-inventory'
  | 'create-folder'
  | 'delete-folder'
  | 'rename-folder'

export type FavoriteRepositoryPageTarget = {
  webContentsId: number
  instanceId: string
  navigationEpoch: number
}

export type FavoriteRepositoryPageOperationResult = {
  status: 'ok' | 'rejected' | 'unknown'
  observedAccountMid: string
  reason?: string
  httpStatus?: number
  contentType?: string
  responseCategory?: 'html' | 'json' | 'text' | 'empty' | 'unknown'
  bilibiliCode?: number
  members?: Record<string, number[]>
  folders?: Array<{ id: string; title: string; memberCount: number }>
  folder?: { id: string; title: string; memberCount: number }
  target?: FavoriteRepositoryPageTarget
}
