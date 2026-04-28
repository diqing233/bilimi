import type { AssistantPreferences } from '@shared/types'

type BilimiDesktopApi = {
  version: string
  loadPreferences: () => Promise<AssistantPreferences>
  onOpenInTab?: (callback: (url: string) => void) => () => void
  savePreferences: (preferences: AssistantPreferences) => Promise<AssistantPreferences>
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
