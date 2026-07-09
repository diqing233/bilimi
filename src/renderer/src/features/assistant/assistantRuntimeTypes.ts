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
import type { VideoContentContext } from '../recommendation/videoClassifier'

export type AssistantSnapshot = {
  preferences: AssistantPreferences
  favoriteLedgerStatus: FavoriteLedgerStatus | null
  videoContentContext: VideoContentContext
  videoTitle: string
  activeTabUrl?: string
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
  | { id: string; type: 'rejudge-old-favorite'; item: FavoriteLedgerPreviewItem }
  | { id: string; type: 'execute-old-favorite-plan'; items: FavoriteLedgerPreviewItem[] }
  | {
      id: string
      type: 'organize-old-favorites-with-deepseek'
      mode: DeepSeekArchiveMode
      request: DeepSeekGenerateRequest
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
  | null
