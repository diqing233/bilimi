import type { AssistantAction, AssistantPreferences, VideoNote } from '@shared/types'

type BilimiDesktopApi = {
  version: string
  closeFloatingMenu?: () => void
  finishFloatingSealDrag?: () => void
  loadPreferences: () => Promise<AssistantPreferences>
  loadVideoNotes?: () => Promise<VideoNote[]>
  moveFloatingSealBy?: (deltaX: number, deltaY: number) => Promise<void>
  moveFloatingSealTo?: (screenX: number, screenY: number) => void
  openAssistant?: () => Promise<void>
  onOpenAssistant?: (callback: (payload?: AssistantOpenPayload) => void) => () => void
  onOpenInTab?: (callback: (url: string) => void) => () => void
  onRunAssistantAction?: (callback: (payload: { action: AssistantAction }) => void) => () => void
  runFloatingMenuAction?: (action: AssistantAction) => Promise<void>
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
  startFloatingSealDrag?: (screenX: number, screenY: number) => void
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
