type BilimiDesktopPreferences = {
  favoritesFolderName: string
  preferenceCounts: Record<'funny' | 'knowledge' | 'story' | 'suspicious', number>
}

type BilimiDesktopApi = {
  version: string
  loadPreferences: () => Promise<BilimiDesktopPreferences>
  onOpenInTab?: (callback: (url: string) => void) => () => void
  savePreferences: (preferences: BilimiDesktopPreferences) => Promise<BilimiDesktopPreferences>
}

declare global {
  interface Window {
    bilimiDesktop: BilimiDesktopApi
  }
}

export {}
