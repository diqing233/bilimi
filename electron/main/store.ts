import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import type { FavoriteLedger } from '../../src/shared/types'

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  preferenceCounts: Record<string, number>
}

export type AssistantStoreLike = {
  get<Key extends keyof AssistantPreferences>(key: Key): AssistantPreferences[Key]
  set<Key extends keyof AssistantPreferences>(key: Key, value: AssistantPreferences[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 内库',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
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
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    ledgerPromptDismissed: Boolean(store.get('ledgerPromptDismissed')),
    preferenceCounts: store.get('preferenceCounts') ?? {}
  }
}

export function saveAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  preferences: AssistantPreferences = DEFAULT_ASSISTANT_PREFERENCES
): AssistantPreferences {
  store.set('favoritesFolderName', preferences.favoritesFolderName)
  store.set('favoriteLedgers', normalizeFavoriteLedgers(preferences.favoriteLedgers))
  store.set('ledgerPromptDismissed', Boolean(preferences.ledgerPromptDismissed))
  store.set('preferenceCounts', preferences.preferenceCounts ?? {})

  return loadAssistantPreferences(store)
}
