import Store from 'electron-store'

type PersistedAssistantState = {
  favoritesFolderName: string
  preferenceCounts: Record<string, number>
}

export const desktopStore = new Store<PersistedAssistantState>({
  defaults: {
    favoritesFolderName: 'Bilimi 内库',
    preferenceCounts: {}
  }
})
