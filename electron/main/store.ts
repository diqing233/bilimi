import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import { normalizeAssistantSidebarWidthPx } from '../../src/shared/assistantSidebarWidth'
import {
  DEFAULT_PET_HOVER_SHORTCUTS,
  normalizePetHoverShortcuts,
  type PetHoverShortcutId
} from '../../src/shared/petHoverShortcuts'
import {
  appendVideoNoteArchiveVersion,
  deleteVideoNoteArchiveEntry as removeVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion as removeVideoNoteArchiveVersion,
  normalizeVideoNoteArchives,
  updateVideoNoteArchiveVersion as replaceVideoNoteArchiveVersion
} from '../../src/shared/videoNoteArchive'
import { normalizeVideoNotes, upsertVideoNote } from '../../src/shared/videoNotes'
import {
  normalizePendingFavoriteQueue,
  upsertPendingFavoriteQueueItems as mergePendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus as setPendingFavoriteQueueItemStatus
} from '../../src/shared/pendingFavoriteQueue'
import type {
  CommentSubmitMode,
  DeepSeekKeyStatus,
  FavoriteArchiveMultiMode,
  FavoriteLedger,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionQueueItem,
  VideoNote,
  VideoNoteArchiveEntry
} from '../../src/shared/types'

export type AssistantPreferences = {
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  ledgerPromptDismissed: boolean
  petStyle: 'big-head' | 'classic'
  petHoverShortcuts: PetHoverShortcutId[]
  hidePetDuringVideoFullscreen: boolean
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  defaultCoinCount: 1 | 2
  commentSubmitMode: CommentSubmitMode
  preferenceCounts: Record<string, number>
  deepseekEnabled: boolean
  deepseekApiKeyStored: boolean
  deepseekCommentEnabled: boolean
  deepseekAutoSummaryEnabled: boolean
  deepseekPetChatEnabled: boolean
  deepseekModel: string
  deepseekBaseUrl: string
  permissionOnboardingCompleted: boolean
  assistantSidebarWidthPx: number | null
}

export type DesktopStoreState = AssistantPreferences & {
  deepseekApiKey: string
  videoNotes: VideoNote[]
  videoNoteArchives: VideoNoteArchiveEntry[]
  pendingFavoriteQueue: PendingFavoriteQueueItem[]
  videoAudioTranscriptionQueue: VideoAudioTranscriptionQueueItem[]
}

export type AssistantStoreLike = {
  get<Key extends keyof DesktopStoreState>(key: Key): DesktopStoreState[Key]
  has?<Key extends keyof DesktopStoreState>(key: Key): boolean
  set(values: Partial<DesktopStoreState>): void
  set<Key extends keyof DesktopStoreState>(key: Key, value: DesktopStoreState[Key]): void
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'Bilimi 鍐呭簱',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
  petStyle: 'big-head',
  petHoverShortcuts: DEFAULT_PET_HOVER_SHORTCUTS,
  hidePetDuringVideoFullscreen: false,
  bilibiliOperationMode: 'api-assisted',
  favoriteArchiveMultiMode: 'off',
  defaultCoinCount: 1,
  commentSubmitMode: 'random',
  preferenceCounts: {},
  deepseekEnabled: false,
  deepseekApiKeyStored: false,
  deepseekCommentEnabled: false,
  deepseekAutoSummaryEnabled: false,
  deepseekPetChatEnabled: false,
  deepseekModel: 'deepseek-v4-flash',
  deepseekBaseUrl: 'https://api.deepseek.com',
  permissionOnboardingCompleted: false,
  assistantSidebarWidthPx: null
}

export const DEFAULT_DESKTOP_STORE_STATE: DesktopStoreState = {
  ...DEFAULT_ASSISTANT_PREFERENCES,
  deepseekApiKey: '',
  videoNotes: [],
  videoNoteArchives: [],
  pendingFavoriteQueue: [],
  videoAudioTranscriptionQueue: []
}

let desktopStore: Store<DesktopStoreState> | undefined

function loadDeepSeekFeatureToggle(
  store: AssistantStoreLike,
  key: 'deepseekCommentEnabled' | 'deepseekPetChatEnabled',
  legacyEnabled: boolean
): boolean {
  return store.has?.(key) === false ? legacyEnabled : Boolean(store.get(key))
}

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
  const petStyle = store.get('petStyle')
  const bilibiliOperationMode = store.get('bilibiliOperationMode')
  const favoriteArchiveMultiMode = store.get('favoriteArchiveMultiMode')
  const defaultCoinCount = store.get('defaultCoinCount')
  const commentSubmitMode = store.get('commentSubmitMode')
  const deepseekApiKey = store.get('deepseekApiKey') ?? ''

  return {
    favoritesFolderName: store.get('favoritesFolderName'),
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    ledgerPromptDismissed: Boolean(store.get('ledgerPromptDismissed')),
    petStyle: petStyle === 'classic' ? 'classic' : 'big-head',
    petHoverShortcuts: normalizePetHoverShortcuts(store.get('petHoverShortcuts')),
    hidePetDuringVideoFullscreen: Boolean(store.get('hidePetDuringVideoFullscreen')),
    bilibiliOperationMode:
      bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    favoriteArchiveMultiMode:
      favoriteArchiveMultiMode === 'two' || favoriteArchiveMultiMode === 'three'
        ? favoriteArchiveMultiMode
        : 'off',
    defaultCoinCount: defaultCoinCount === 2 ? 2 : 1,
    commentSubmitMode: commentSubmitMode === 'random' ? 'random' : 'choose',
    preferenceCounts: store.get('preferenceCounts') ?? {},
    deepseekEnabled: Boolean(store.get('deepseekEnabled')),
    deepseekApiKeyStored: Boolean(String(deepseekApiKey).trim()),
    deepseekCommentEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekCommentEnabled',
      Boolean(store.get('deepseekEnabled'))
    ),
    deepseekAutoSummaryEnabled: Boolean(store.get('deepseekAutoSummaryEnabled')),
    deepseekPetChatEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekPetChatEnabled',
      Boolean(store.get('deepseekEnabled'))
    ),
    deepseekModel: store.get('deepseekModel') || DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl: store.get('deepseekBaseUrl') || DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    permissionOnboardingCompleted: Boolean(store.get('permissionOnboardingCompleted')),
    assistantSidebarWidthPx: normalizeAssistantSidebarWidthPx(store.get('assistantSidebarWidthPx'))
  }
}

export function saveAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  preferences: AssistantPreferences = DEFAULT_ASSISTANT_PREFERENCES
): AssistantPreferences {
  store.set({
    favoritesFolderName: preferences.favoritesFolderName,
    favoriteLedgers: normalizeFavoriteLedgers(preferences.favoriteLedgers),
    ledgerPromptDismissed: Boolean(preferences.ledgerPromptDismissed),
    petStyle: preferences.petStyle === 'classic' ? 'classic' : 'big-head',
    petHoverShortcuts: normalizePetHoverShortcuts(preferences.petHoverShortcuts),
    hidePetDuringVideoFullscreen: Boolean(preferences.hidePetDuringVideoFullscreen),
    bilibiliOperationMode:
      preferences.bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    favoriteArchiveMultiMode:
      preferences.favoriteArchiveMultiMode === 'two' || preferences.favoriteArchiveMultiMode === 'three'
        ? preferences.favoriteArchiveMultiMode
        : 'off',
    defaultCoinCount: preferences.defaultCoinCount === 2 ? 2 : 1,
    commentSubmitMode: preferences.commentSubmitMode === 'random' ? 'random' : 'choose',
    preferenceCounts: preferences.preferenceCounts ?? {},
    deepseekEnabled: Boolean(preferences.deepseekEnabled),
    deepseekApiKeyStored: loadDeepSeekApiKeyStatus(store).configured,
    deepseekCommentEnabled: Boolean(preferences.deepseekCommentEnabled),
    deepseekAutoSummaryEnabled: Boolean(preferences.deepseekAutoSummaryEnabled),
    deepseekPetChatEnabled: Boolean(preferences.deepseekPetChatEnabled),
    deepseekModel: preferences.deepseekModel || DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl: preferences.deepseekBaseUrl || DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    permissionOnboardingCompleted: Boolean(preferences.permissionOnboardingCompleted),
    assistantSidebarWidthPx: normalizeAssistantSidebarWidthPx(preferences.assistantSidebarWidthPx)
  })

  return loadAssistantPreferences(store)
}

export function loadDeepSeekApiKeyStatus(
  store: AssistantStoreLike = getDesktopStore()
): DeepSeekKeyStatus {
  return { configured: Boolean((store.get('deepseekApiKey') ?? '').trim()) }
}

export function loadDeepSeekApiKey(store: AssistantStoreLike = getDesktopStore()): string {
  return store.get('deepseekApiKey') ?? ''
}

export function saveDeepSeekApiKey(
  store: AssistantStoreLike = getDesktopStore(),
  key: string
): DeepSeekKeyStatus {
  store.set('deepseekApiKey', key.trim())
  store.set('deepseekApiKeyStored', loadDeepSeekApiKeyStatus(store).configured)

  return loadDeepSeekApiKeyStatus(store)
}

export function clearDeepSeekApiKey(
  store: AssistantStoreLike = getDesktopStore()
): DeepSeekKeyStatus {
  store.set('deepseekApiKey', '')
  store.set('deepseekApiKeyStored', false)

  return loadDeepSeekApiKeyStatus(store)
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
  createdAt: string = new Date().toISOString(),
  summaryText = ''
): VideoNoteArchiveEntry[] {
  const archives = appendVideoNoteArchiveVersion(
    loadVideoNoteArchives(store),
    note,
    createdAt,
    summaryText
  )

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

export function updateVideoNoteArchiveVersion(
  store: AssistantStoreLike = getDesktopStore(),
  archiveId: string,
  versionId: string,
  note: VideoNote
): VideoNoteArchiveEntry[] {
  const archives = replaceVideoNoteArchiveVersion(
    loadVideoNoteArchives(store),
    archiveId,
    versionId,
    note
  )

  store.set('videoNoteArchives', archives)

  return archives
}

export function loadPendingFavoriteQueue(
  store: AssistantStoreLike = getDesktopStore()
): PendingFavoriteQueueItem[] {
  return normalizePendingFavoriteQueue(store.get('pendingFavoriteQueue') ?? [])
}

export function savePendingFavoriteQueue(
  store: AssistantStoreLike = getDesktopStore(),
  items: PendingFavoriteQueueItem[]
): PendingFavoriteQueueItem[] {
  store.set('pendingFavoriteQueue', items)

  return loadPendingFavoriteQueue(store)
}

export function clearPendingFavoriteQueue(
  store: AssistantStoreLike = getDesktopStore()
): PendingFavoriteQueueItem[] {
  store.set('pendingFavoriteQueue', [])

  return loadPendingFavoriteQueue(store)
}

export function upsertPendingFavoriteQueueItems(
  store: AssistantStoreLike = getDesktopStore(),
  items: PendingFavoriteQueueItem[],
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const nextItems = mergePendingFavoriteQueueItems(loadPendingFavoriteQueue(store), items, now)
  store.set('pendingFavoriteQueue', nextItems)

  return loadPendingFavoriteQueue(store)
}

export function updatePendingFavoriteQueueItemStatus(
  store: AssistantStoreLike = getDesktopStore(),
  aid: number,
  status: PendingFavoriteQueueStatus,
  now = new Date().toISOString()
): PendingFavoriteQueueItem[] {
  const nextItems = setPendingFavoriteQueueItemStatus(loadPendingFavoriteQueue(store), aid, status, now)
  store.set('pendingFavoriteQueue', nextItems)

  return loadPendingFavoriteQueue(store)
}

export function loadVideoAudioTranscriptionQueue(
  store: AssistantStoreLike = getDesktopStore()
): VideoAudioTranscriptionQueueItem[] {
  return (store.get('videoAudioTranscriptionQueue') ?? [])
    .filter((item) => item.status !== 'completed')
    .map((item) =>
      item.status === 'running'
        ? {
            ...item,
            status: 'failed',
            errorMessage: 'Bilimi was closed before this transcription finished.'
          }
        : item
    )
}

export function saveVideoAudioTranscriptionQueue(
  store: AssistantStoreLike = getDesktopStore(),
  items: VideoAudioTranscriptionQueueItem[]
): VideoAudioTranscriptionQueueItem[] {
  store.set('videoAudioTranscriptionQueue', items)

  return items
}
