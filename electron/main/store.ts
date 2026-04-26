import Store from 'electron-store'

export type AssistantPreferences = {
  favoritesFolderName: string
  preferenceCounts: Record<string, number>
}

export type AssistantStoreLike = {
  get<Key extends keyof AssistantPreferences>(key: Key): AssistantPreferences[Key]
  set<Key extends keyof AssistantPreferences>(key: Key, value: AssistantPreferences[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 内库',
  preferenceCounts: {}
}

let desktopStore: Store<AssistantPreferences> | undefined

export function getDesktopStore(): Store<AssistantPreferences> {
  if (!desktopStore) {
    desktopStore = new Store<AssistantPreferences>({
      defaults: DEFAULT_ASSISTANT_PREFERENCES
    })
  }

  return desktopStore
}

export function loadAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore()
): AssistantPreferences {
  return {
    favoritesFolderName: store.get('favoritesFolderName'),
    preferenceCounts: store.get('preferenceCounts')
  }
}

export function saveAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  preferences: AssistantPreferences = DEFAULT_ASSISTANT_PREFERENCES
): AssistantPreferences {
  store.set('favoritesFolderName', preferences.favoritesFolderName)
  store.set('preferenceCounts', preferences.preferenceCounts)

  return loadAssistantPreferences(store)
}
