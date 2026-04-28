import type { AssistantPreferences, VideoNote } from '@shared/types'

type BilimiDesktopApi = {
  version: string
  loadPreferences: () => Promise<AssistantPreferences>
  loadVideoNotes?: () => Promise<VideoNote[]>
  onOpenInTab?: (callback: (url: string) => void) => () => void
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
  saveVideoNote?: (note: VideoNote) => Promise<VideoNote[]>
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
