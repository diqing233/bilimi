import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  VideoNote
} from '@shared/types'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../favorites/favoriteLedgerPreview'
import type { VideoContentContext } from '../recommendation/videoClassifier'

export type AssistantSnapshot = {
  preferences: AssistantPreferences
  favoriteLedgerStatus: FavoriteLedgerStatus | null
  videoContentContext: VideoContentContext
  videoTitle: string
}

export type FloatingAssistantActionOptions = {
  coinCount?: 1 | 2
  commentDraft?: string
  pageClickOnly?: boolean
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
  | { id: string; type: 'save-video-note'; note: VideoNote }
  | { id: string; type: 'get-current-video-time' }
  | { id: string; type: 'seek-video-time'; seconds: number }
  | { id: string; type: 'ensure-ledgers' }
  | { id: string; type: 'scan-old-favorites' }
  | { id: string; type: 'execute-old-favorite-plan'; items: FavoriteLedgerPreviewItem[] }

export type AssistantRuntimeResponsePayload =
  | AssistantSnapshot
  | AssistantAutomationResult
  | FavoriteLedgerStatus
  | FavoriteLedgerPreview
  | VideoNote
  | VideoNote[]
  | number
  | boolean
  | null
