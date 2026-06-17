import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import {
  appendVideoNoteArchiveVersion,
  deleteVideoNoteArchiveEntry as removeVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion as removeVideoNoteArchiveVersion,
  normalizeVideoNoteArchives
} from '../../src/shared/videoNoteArchive'
import { normalizeVideoNotes, upsertVideoNote } from '../../src/shared/videoNotes'
import type { FavoriteLedger, VideoNote, VideoNoteArchiveEntry } from '../../src/shared/types'

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  preferenceCounts: Record<string, number>
}

export type DesktopStoreState = AssistantPreferences & {
  videoNotes: VideoNote[]
  videoNoteArchives: VideoNoteArchiveEntry[]
}

export type AssistantStoreLike = {
  get<Key extends keyof DesktopStoreState>(key: Key): DesktopStoreState[Key]
  set<Key extends keyof DesktopStoreState>(key: Key, value: DesktopStoreState[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 鍐呭簱',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
  preferenceCounts: {}
}

export const DEFAULT_DESKTOP_STORE_STATE: DesktopStoreState = {
  ...DEFAULT_ASSISTANT_PREFERENCES,
  videoNotes: [],
  videoNoteArchives: []
}

let desktopStore: Store<DesktopStoreState> | undefined

export function getDesktopStore(): Store<DesktopStoreState> {
  if (!desktopStore) {
    desktopStore = new Store<DesktopStoreState>({
      defaults: DEFAULT_DESKTOP_STORE_STATE
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

export function loadVideoNotes(store: AssistantStoreLike = getDesktopStore()): VideoNote[] {
  return normalizeVideoNotes(store.get('videoNotes') ?? [])
}

export function saveVideoNote(
  store: AssistantStoreLike = getDesktopStore(),
  note: VideoNote
): VideoNote[] {
  const notes = upsertVideoNote(loadVideoNotes(store), note)

  store.set('videoNotes', notes)

  return notes
}

export function loadVideoNoteArchives(
  store: AssistantStoreLike = getDesktopStore()
): VideoNoteArchiveEntry[] {
  return normalizeVideoNoteArchives(store.get('videoNoteArchives') ?? [])
}

export function saveVideoNoteArchiveVersion(
  store: AssistantStoreLike = getDesktopStore(),
  note: VideoNote,
  createdAt: string = new Date().toISOString()
): VideoNoteArchiveEntry[] {
  const archives = appendVideoNoteArchiveVersion(loadVideoNoteArchives(store), note, createdAt)

  store.set('videoNoteArchives', archives)

  return archives
}

export function deleteVideoNoteArchiveEntry(
  store: AssistantStoreLike = getDesktopStore(),
  archiveId: string
): VideoNoteArchiveEntry[] {
  const archives = removeVideoNoteArchiveEntry(loadVideoNoteArchives(store), archiveId)

  store.set('videoNoteArchives', archives)

  return archives
}

export function deleteVideoNoteArchiveVersion(
  store: AssistantStoreLike = getDesktopStore(),
  archiveId: string,
  versionId: string
): VideoNoteArchiveEntry[] {
  const archives = removeVideoNoteArchiveVersion(loadVideoNoteArchives(store), archiveId, versionId)

  store.set('videoNoteArchives', archives)

  return archives
}
