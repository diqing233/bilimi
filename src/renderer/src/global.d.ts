import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferences,
  FavoriteLedgerStatus,
  VideoNote
} from '@shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantRuntimeResponsePayload,
  AssistantSnapshot,
  FloatingAssistantActionOptions
} from './features/assistant/assistantRuntimeTypes'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from './features/favorites/favoriteLedgerPreview'

type BilimiDesktopApi = {
  version: string
  closeFloatingAssistant?: () => void
  closeFloatingMenu?: () => void
  ensureFavoriteLedgers?: () => Promise<AssistantAutomationResult>
  executeOldFavoritePlan?: (items: FavoriteLedgerPreviewItem[]) => Promise<AssistantAutomationResult>
  finishFloatingSealDrag?: () => void
  generateVideoNote?: (manualTranscript?: string) => Promise<VideoNote | null>
  getCurrentVideoTime?: () => Promise<number>
  loadPreferences: () => Promise<AssistantPreferences>
  loadVideoNotes?: () => Promise<VideoNote[]>
  moveFloatingSealBy?: (deltaX: number, deltaY: number) => Promise<void>
  moveFloatingSealTo?: (screenX: number, screenY: number) => void
  notifyAssistantSnapshotChanged?: () => void
  onAssistantSnapshotChanged?: (callback: () => void) => () => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
  onRunAssistantAction?: (callback: (payload: { action: AssistantAction }) => void) => () => void
  registerAssistantRuntime?: (
    handler: (request: AssistantRuntimeRequest) => Promise<AssistantRuntimeResponsePayload>
  ) => () => void
  requestAssistantSnapshot?: () => Promise<AssistantSnapshot>
  runAssistantAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<AssistantAutomationResult>
  runFloatingMenuAction?: (
    action: AssistantAction,
    options?: FloatingAssistantActionOptions
  ) => Promise<void>
  scanOldFavorites?: () => Promise<FavoriteLedgerPreview>
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
  seekVideoTime?: (seconds: number) => Promise<boolean>
  startFloatingSealDrag?: (screenX: number, screenY: number) => void
  toggleFloatingAssistant?: () => Promise<void>
  toggleFloatingMenu?: () => Promise<void>
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
