import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekConnectionTestResult,
  DeepSeekGenerateRequest,
  DeepSeekGenerateResult,
  DeepSeekKeyStatus,
  AssistantPreferences,
  FavoriteLedger,
  FavoriteLedgerStatus,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult,
  VideoNote,
  VideoNoteArchiveEntry
} from '@shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  AssistantSnapshot,
  FloatingAssistantActionOptions
} from './features/assistant/assistantRuntimeTypes'
import type { AssistantPetState } from './features/assistant/petState'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from './features/favorites/favoriteLedgerPreview'

type BilimiDesktopApi = {
  version: string
  closeAssistantPet?: () => void
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  executeOldFavoritePlan?: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
  finishFloatingSealDrag?: () => void
  generateDeepSeek?: (request: DeepSeekGenerateRequest) => Promise<DeepSeekGenerateResult>
  generateVideoNote?: (manualTranscript?: string) => Promise<VideoNote | null>
  generateVideoNoteFromAudio?: () => Promise<VideoNote | null>
  getCurrentVideoTime?: () => Promise<number>
  loadPreferences: () => Promise<AssistantPreferences>
  loadVideoNotes?: () => Promise<VideoNote[]>
  loadVideoNoteArchives?: () => Promise<VideoNoteArchiveEntry[]>
  loadDeepSeekApiKeyStatus?: () => Promise<DeepSeekKeyStatus>
  moveFloatingSealBy?: (deltaX: number, deltaY: number) => Promise<void>
  moveFloatingSealTo?: (screenX: number, screenY: number) => void
  notifyAssistantSnapshotChanged?: () => void
  onAssistantPreferencesChanged?: (callback: (preferences: AssistantPreferences) => void) => () => void
  onAssistantPetStateChanged?: (callback: (state: AssistantPetState) => void) => () => void
  onAssistantSnapshotChanged?: (callback: () => void) => () => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
  onRunAssistantAction?: (callback: (payload: { action: AssistantAction }) => void) => () => void
  onVideoAudioTranscriptionProgress?: (
    callback: (progress: VideoAudioTranscriptionProgress) => void
  ) => () => void
  registerAssistantRuntime?: (
    handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>
  ) => () => void
  restoreMainWindowFromPet?: () => Promise<void>
  requestAssistantSnapshot?: () => Promise<AssistantSnapshot>
  resizeFloatingSealByStep?: (step: number) => void
  runAssistantAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<AssistantAutomationResult>
  runFloatingMenuAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<void>
  scanOldFavorites?: () => Promise<FavoriteLedgerPreview>
  saveFavoriteLedgers?: (ledgers: FavoriteLedger[]) => Promise<AssistantAutomationResult>
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  saveDeepSeekApiKey?: (apiKey: string) => Promise<DeepSeekKeyStatus>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
  saveVideoNoteArchiveVersion?: (note: VideoNote) => Promise<VideoNoteArchiveEntry[]>
  deleteVideoNoteArchiveEntry?: (archiveId: string) => Promise<VideoNoteArchiveEntry[]>
  deleteVideoNoteArchiveVersion?: (
    archiveId: string,
    versionId: string
  ) => Promise<VideoNoteArchiveEntry[]>
  clearDeepSeekApiKey?: () => Promise<DeepSeekKeyStatus>
  seekVideoTime?: (seconds: number) => Promise<boolean>
  setAssistantPetState?: (state: AssistantPetState) => void
  setFloatingSealMouseTransparent?: (transparent: boolean) => void
  startFloatingSealDrag?: (screenX: number, screenY: number) => void
  toggleFloatingAssistant?: () => Promise<void>
  toggleFloatingMenu?: () => Promise<void>
  wakeAssistantPet?: () => Promise<void>
  testDeepSeekConnection?: () => Promise<DeepSeekConnectionTestResult>
  transcribeCurrentVideoAudio?: (
    request: VideoAudioTranscriptionRequest
  ) => Promise<VideoAudioTranscriptionResult>
}

type AssistantOpenPayload = {
  position?: {
    left: number
    top: number
  }
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
