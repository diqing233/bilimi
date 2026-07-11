import Store from 'electron-store'
import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import { normalizeAssistantSidebarWidthPx } from '../../src/shared/assistantSidebarWidth'
import {
  DEFAULT_PET_HOVER_SHORTCUTS,
  hasLegacyAssistantHoverShortcut,
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
import {
  normalizeFavoriteArchiveProtectionInitializedAccountMids,
  normalizeFavoriteArchiveProtectionRecords
} from '../../src/shared/favoriteArchiveProtection'
import type {
  CommentSubmitMode,
  DeepSeekKeyStatus,
  FavoriteArchiveStrategy,
  FavoriteArchiveMultiMode,
  FavoriteArchiveProtectionRecord,
  FavoriteCorrectionFeedbackType,
  FavoriteCorrectionRecord,
  FavoriteCorrectionSource,
  FavoriteKeywordSuggestion,
  FavoriteKeywordSuggestionAction,
  FavoriteKeywordSuggestionStatus,
  FavoriteLedger,
  MainWindowCloseBehavior,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionThreadLimit,
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
  showPetAssistantShortcut: boolean
  hidePetDuringVideoFullscreen: boolean
  closeBehavior: MainWindowCloseBehavior
  confirmBeforeExit: boolean
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  favoriteArchiveStrategy: FavoriteArchiveStrategy
  favoriteCorrectionLearningEnabled: boolean
  favoriteCorrectionLearningClassificationEnabled: boolean
  favoriteCorrectionRecords: FavoriteCorrectionRecord[]
  favoriteArchiveProtectionRecords: FavoriteArchiveProtectionRecord[]
  favoriteArchiveProtectionInitializedAccountMids: string[]
  favoriteKeywordSuggestions: FavoriteKeywordSuggestion[]
  defaultCoinCount: 1 | 2
  commentSubmitMode: CommentSubmitMode
  videoAudioTranscriptionThreadLimit: VideoAudioTranscriptionThreadLimit
  preferenceCounts: Record<string, number>
  deepseekEnabled: boolean
  deepseekApiKeyStored: boolean
  deepseekCommentEnabled: boolean
  deepseekAutoSummaryEnabled: boolean
  deepseekPetChatEnabled: boolean
  deepseekDailyClassificationEnabled: boolean
  deepseekArchiveOrganizationEnabled: boolean
  deepseekFeatureDefaultsInitialized: boolean
  deepseekDailyClassificationMode: 'all' | 'low-confidence-only'
  deepseekModel: string
  deepseekBaseUrl: string
  permissionOnboardingCompleted: boolean
  assistantSidebarWidthPx: number | null
}

export type DesktopStoreState = AssistantPreferences & {
  deepseekApiKey: string
  deepseekApiKeyEncrypted: string
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

type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

const EMPTY_DEEPSEEK_KEY_STATUS: DeepSeekKeyStatus = {
  configured: false,
  protection: 'unavailable'
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  favoritesFolderName: 'bilimi 内库',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  ledgerPromptDismissed: false,
  petStyle: 'big-head',
  petHoverShortcuts: DEFAULT_PET_HOVER_SHORTCUTS,
  showPetAssistantShortcut: true,
  hidePetDuringVideoFullscreen: false,
  closeBehavior: 'minimize-to-tray',
  confirmBeforeExit: true,
  bilibiliOperationMode: 'api-assisted',
  favoriteArchiveMultiMode: 'off',
  favoriteArchiveStrategy: 'aggressive',
  favoriteCorrectionLearningEnabled: true,
  favoriteCorrectionLearningClassificationEnabled: true,
  favoriteCorrectionRecords: [],
  favoriteArchiveProtectionRecords: [],
  favoriteArchiveProtectionInitializedAccountMids: [],
  favoriteKeywordSuggestions: [],
  defaultCoinCount: 2,
  commentSubmitMode: 'choose',
  videoAudioTranscriptionThreadLimit: 'unlimited',
  preferenceCounts: {},
  deepseekEnabled: false,
  deepseekApiKeyStored: false,
  deepseekCommentEnabled: true,
  deepseekAutoSummaryEnabled: true,
  deepseekPetChatEnabled: true,
  deepseekDailyClassificationEnabled: true,
  deepseekArchiveOrganizationEnabled: true,
  deepseekFeatureDefaultsInitialized: false,
  deepseekDailyClassificationMode: 'all',
  deepseekModel: 'deepseek-v4-flash',
  deepseekBaseUrl: 'https://api.deepseek.com',
  permissionOnboardingCompleted: false,
  assistantSidebarWidthPx: null
}

export const DEFAULT_DESKTOP_STORE_STATE: DesktopStoreState = {
  ...DEFAULT_ASSISTANT_PREFERENCES,
  deepseekApiKey: '',
  deepseekApiKeyEncrypted: '',
  videoNotes: [],
  videoNoteArchives: [],
  pendingFavoriteQueue: [],
  videoAudioTranscriptionQueue: []
}

let desktopStore: Store<DesktopStoreState> | undefined

function loadDeepSeekFeatureToggle(
  store: AssistantStoreLike,
  key:
    | 'deepseekCommentEnabled'
    | 'deepseekAutoSummaryEnabled'
    | 'deepseekPetChatEnabled'
    | 'deepseekDailyClassificationEnabled'
    | 'deepseekArchiveOrganizationEnabled',
  legacyEnabled: boolean
): boolean {
  return store.has?.(key) === false ? legacyEnabled : Boolean(store.get(key))
}

function normalizeVideoAudioTranscriptionThreadLimit(
  value: unknown
): VideoAudioTranscriptionThreadLimit {
  return value === 1 || value === 2 || value === 4 ? value : 'unlimited'
}

function normalizeFavoriteArchiveStrategy(value: unknown): FavoriteArchiveStrategy {
  return value === 'balanced' || value === 'conservative' ? value : 'aggressive'
}

function normalizeDeepSeekDailyClassificationMode(
  value: unknown
): AssistantPreferences['deepseekDailyClassificationMode'] {
  return value === 'low-confidence-only' ? 'low-confidence-only' : 'all'
}

function normalizeMainWindowCloseBehavior(value: unknown): MainWindowCloseBehavior {
  return value === 'exit-launcher' ? 'exit-launcher' : 'minimize-to-tray'
}

const VALID_KEYWORD_SUGGESTION_ACTIONS = new Set<FavoriteKeywordSuggestionAction>([
  'add-keyword',
  'remove-keyword',
  'downgrade-to-weak',
  'replace-with-combination',
  'add-entity-alias',
  'add-concept-variant'
])

const VALID_KEYWORD_SUGGESTION_STATUSES = new Set<FavoriteKeywordSuggestionStatus>([
  'pending',
  'accepted',
  'ignored',
  'deleted'
])

const VALID_CORRECTION_SOURCES = new Set<FavoriteCorrectionSource>([
  'user',
  'deepseek',
  'user-confirmed-deepseek',
  'classifier'
])

const VALID_CORRECTION_FEEDBACK_TYPES = new Set<FavoriteCorrectionFeedbackType>([
  'strong-correction',
  'weak-negative'
])

const VALID_CORRECTION_SOURCE_SCENES = new Set<FavoriteCorrectionRecord['sourceScene']>([
  'archive-preview',
  'daily-favorite'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))
      )
    : []
}

function normalizeFavoriteLedgerIds(value: unknown): FavoriteLedger['id'][] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .filter((ledgerId): ledgerId is string => typeof ledgerId === 'string' && ledgerId.trim().length > 0)
            .map((ledgerId) => ledgerId.trim() as FavoriteLedger['id'])
        )
      )
    : []
}

function normalizeFavoriteCorrectionRecords(records: unknown): FavoriteCorrectionRecord[] {
  if (!Array.isArray(records)) {
    return []
  }

  return records.flatMap((record) => {
    if (
      !isRecord(record) ||
      typeof record.id !== 'string' ||
      typeof record.aid !== 'number' ||
      !Number.isFinite(record.aid) ||
      typeof record.title !== 'string' ||
      !Array.isArray(record.userLedgerIds) ||
      !VALID_CORRECTION_SOURCES.has(record.source as FavoriteCorrectionSource) ||
      !VALID_CORRECTION_FEEDBACK_TYPES.has(record.feedbackType as FavoriteCorrectionFeedbackType) ||
      !VALID_CORRECTION_SOURCE_SCENES.has(record.sourceScene as FavoriteCorrectionRecord['sourceScene']) ||
      typeof record.createdAt !== 'string'
    ) {
      return []
    }

    return [
      {
        id: record.id,
        aid: record.aid,
        title: record.title,
        originalLedgerId:
          typeof record.originalLedgerId === 'string' ? (record.originalLedgerId as FavoriteLedger['id']) : undefined,
        userLedgerIds: normalizeFavoriteLedgerIds(record.userLedgerIds),
        source: record.source as FavoriteCorrectionSource,
        feedbackType: record.feedbackType as FavoriteCorrectionFeedbackType,
        sourceScene: record.sourceScene as FavoriteCorrectionRecord['sourceScene'],
        sourceFolderTitle:
          typeof record.sourceFolderTitle === 'string' ? record.sourceFolderTitle : undefined,
        author: typeof record.author === 'string' ? record.author : undefined,
        tags: normalizeStringArray(record.tags),
        matchedKeywords: normalizeStringArray(record.matchedKeywords),
        score: typeof record.score === 'number' && Number.isFinite(record.score) ? record.score : undefined,
        confidence:
          record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low'
            ? record.confidence
            : undefined,
        scoreGap:
          typeof record.scoreGap === 'number' && Number.isFinite(record.scoreGap)
            ? record.scoreGap
            : undefined,
        createdAt: record.createdAt,
        confirmedAt: typeof record.confirmedAt === 'string' ? record.confirmedAt : undefined
      }
    ]
  })
}

function normalizeFavoriteKeywordSuggestions(value: unknown): FavoriteKeywordSuggestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return (value as FavoriteKeywordSuggestion[])
    .filter(
      (suggestion) =>
        isRecord(suggestion) &&
        typeof suggestion.id === 'string' &&
        VALID_KEYWORD_SUGGESTION_ACTIONS.has(suggestion.action as FavoriteKeywordSuggestionAction) &&
        VALID_KEYWORD_SUGGESTION_STATUSES.has(suggestion.status as FavoriteKeywordSuggestionStatus) &&
        VALID_CORRECTION_SOURCES.has(suggestion.source as FavoriteCorrectionSource) &&
        typeof suggestion.reason === 'string' &&
        typeof suggestion.createdAt === 'string'
    )
    .map((suggestion) => ({ ...suggestion }) as FavoriteKeywordSuggestion)
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
  const favoriteArchiveStrategy = store.get('favoriteArchiveStrategy')
  const defaultCoinCount = store.get('defaultCoinCount')
  const commentSubmitMode = store.get('commentSubmitMode')
  const videoAudioTranscriptionThreadLimit = store.get('videoAudioTranscriptionThreadLimit')
  const deepseekApiKey = store.get('deepseekApiKey') ?? ''
  const deepseekApiKeyEncrypted = store.get('deepseekApiKeyEncrypted') ?? ''

  return {
    favoritesFolderName: store.get('favoritesFolderName'),
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    ledgerPromptDismissed: Boolean(store.get('ledgerPromptDismissed')),
    petStyle: petStyle === 'classic' ? 'classic' : 'big-head',
    petHoverShortcuts: normalizePetHoverShortcuts(store.get('petHoverShortcuts')),
    showPetAssistantShortcut:
      store.has?.('showPetAssistantShortcut') === false
        ? true
        : Boolean(store.get('showPetAssistantShortcut')) ||
          hasLegacyAssistantHoverShortcut(store.get('petHoverShortcuts')),
    hidePetDuringVideoFullscreen: Boolean(store.get('hidePetDuringVideoFullscreen')),
    closeBehavior: normalizeMainWindowCloseBehavior(store.get('closeBehavior')),
    confirmBeforeExit:
      store.has?.('confirmBeforeExit') === false ? true : Boolean(store.get('confirmBeforeExit')),
    bilibiliOperationMode:
      bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    favoriteArchiveMultiMode:
      favoriteArchiveMultiMode === 'two' || favoriteArchiveMultiMode === 'three'
        ? favoriteArchiveMultiMode
        : 'off',
    favoriteArchiveStrategy: normalizeFavoriteArchiveStrategy(favoriteArchiveStrategy),
    favoriteCorrectionLearningEnabled:
      store.has?.('favoriteCorrectionLearningEnabled') === false
        ? true
        : Boolean(store.get('favoriteCorrectionLearningEnabled')),
    favoriteCorrectionLearningClassificationEnabled:
      store.has?.('favoriteCorrectionLearningClassificationEnabled') === false
        ? true
        : Boolean(store.get('favoriteCorrectionLearningClassificationEnabled')),
    favoriteCorrectionRecords: normalizeFavoriteCorrectionRecords(store.get('favoriteCorrectionRecords')),
    favoriteArchiveProtectionRecords: normalizeFavoriteArchiveProtectionRecords(
      store.get('favoriteArchiveProtectionRecords')
    ),
    favoriteArchiveProtectionInitializedAccountMids:
      normalizeFavoriteArchiveProtectionInitializedAccountMids(
        store.get('favoriteArchiveProtectionInitializedAccountMids')
      ),
    favoriteKeywordSuggestions: normalizeFavoriteKeywordSuggestions(store.get('favoriteKeywordSuggestions')),
    defaultCoinCount: defaultCoinCount === 1 ? 1 : 2,
    commentSubmitMode: commentSubmitMode === 'random' ? 'random' : 'choose',
    videoAudioTranscriptionThreadLimit: normalizeVideoAudioTranscriptionThreadLimit(
      videoAudioTranscriptionThreadLimit
    ),
    preferenceCounts: store.get('preferenceCounts') ?? {},
    deepseekEnabled: Boolean(store.get('deepseekEnabled')),
    deepseekApiKeyStored: Boolean(
      String(deepseekApiKey).trim() || String(deepseekApiKeyEncrypted).trim()
    ),
    deepseekCommentEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekCommentEnabled',
      true
    ),
    deepseekAutoSummaryEnabled: loadDeepSeekFeatureToggle(store, 'deepseekAutoSummaryEnabled', true),
    deepseekPetChatEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekPetChatEnabled',
      true
    ),
    deepseekDailyClassificationEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekDailyClassificationEnabled',
      true
    ),
    deepseekArchiveOrganizationEnabled: loadDeepSeekFeatureToggle(
      store,
      'deepseekArchiveOrganizationEnabled',
      true
    ),
    deepseekFeatureDefaultsInitialized: Boolean(store.get('deepseekFeatureDefaultsInitialized')),
    deepseekDailyClassificationMode: normalizeDeepSeekDailyClassificationMode(
      store.get('deepseekDailyClassificationMode')
    ),
    deepseekModel:
      typeof store.get('deepseekModel') === 'string'
        ? store.get('deepseekModel')
        : DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl:
      typeof store.get('deepseekBaseUrl') === 'string'
        ? store.get('deepseekBaseUrl')
        : DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
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
    showPetAssistantShortcut: Boolean(preferences.showPetAssistantShortcut),
    hidePetDuringVideoFullscreen: Boolean(preferences.hidePetDuringVideoFullscreen),
    closeBehavior: normalizeMainWindowCloseBehavior(preferences.closeBehavior),
    confirmBeforeExit: Boolean(preferences.confirmBeforeExit),
    bilibiliOperationMode:
      preferences.bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    favoriteArchiveMultiMode:
      preferences.favoriteArchiveMultiMode === 'two' || preferences.favoriteArchiveMultiMode === 'three'
        ? preferences.favoriteArchiveMultiMode
        : 'off',
    favoriteArchiveStrategy: normalizeFavoriteArchiveStrategy(preferences.favoriteArchiveStrategy),
    favoriteCorrectionLearningEnabled: Boolean(preferences.favoriteCorrectionLearningEnabled),
    favoriteCorrectionLearningClassificationEnabled: Boolean(
      preferences.favoriteCorrectionLearningClassificationEnabled
    ),
    favoriteCorrectionRecords: normalizeFavoriteCorrectionRecords(preferences.favoriteCorrectionRecords),
    favoriteArchiveProtectionRecords: normalizeFavoriteArchiveProtectionRecords(
      preferences.favoriteArchiveProtectionRecords
    ),
    favoriteArchiveProtectionInitializedAccountMids:
      normalizeFavoriteArchiveProtectionInitializedAccountMids(
        preferences.favoriteArchiveProtectionInitializedAccountMids
      ),
    favoriteKeywordSuggestions: normalizeFavoriteKeywordSuggestions(preferences.favoriteKeywordSuggestions),
    defaultCoinCount: preferences.defaultCoinCount === 2 ? 2 : 1,
    commentSubmitMode: preferences.commentSubmitMode === 'random' ? 'random' : 'choose',
    videoAudioTranscriptionThreadLimit: normalizeVideoAudioTranscriptionThreadLimit(
      preferences.videoAudioTranscriptionThreadLimit
    ),
    preferenceCounts: preferences.preferenceCounts ?? {},
    deepseekEnabled: Boolean(preferences.deepseekEnabled),
    deepseekApiKeyStored: loadDeepSeekApiKeyStatus(store).configured,
    deepseekCommentEnabled: Boolean(preferences.deepseekCommentEnabled),
    deepseekAutoSummaryEnabled: Boolean(preferences.deepseekAutoSummaryEnabled),
    deepseekPetChatEnabled: Boolean(preferences.deepseekPetChatEnabled),
    deepseekDailyClassificationEnabled: Boolean(preferences.deepseekDailyClassificationEnabled),
    deepseekArchiveOrganizationEnabled: Boolean(preferences.deepseekArchiveOrganizationEnabled),
    deepseekFeatureDefaultsInitialized: Boolean(preferences.deepseekFeatureDefaultsInitialized),
    deepseekDailyClassificationMode: normalizeDeepSeekDailyClassificationMode(
      preferences.deepseekDailyClassificationMode
    ),
    deepseekModel:
      typeof preferences.deepseekModel === 'string'
        ? preferences.deepseekModel
        : DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl:
      typeof preferences.deepseekBaseUrl === 'string'
        ? preferences.deepseekBaseUrl
        : DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    permissionOnboardingCompleted: Boolean(preferences.permissionOnboardingCompleted),
    assistantSidebarWidthPx: normalizeAssistantSidebarWidthPx(preferences.assistantSidebarWidthPx)
  })

  return loadAssistantPreferences(store)
}

export function loadDeepSeekApiKeyStatus(
  store: AssistantStoreLike = getDesktopStore(),
  safeStorage?: SafeStorageLike
): DeepSeekKeyStatus {
  const encryptedValue = (store.get('deepseekApiKeyEncrypted') ?? '').trim()
  if (encryptedValue) {
    if (!safeStorage?.isEncryptionAvailable()) {
      return { configured: false, protection: 'error' }
    }

    try {
      const apiKey = safeStorage.decryptString(Buffer.from(encryptedValue, 'base64')).trim()
      return apiKey ? { configured: true, protection: 'encrypted' } : EMPTY_DEEPSEEK_KEY_STATUS
    } catch {
      return { configured: false, protection: 'error' }
    }
  }

  const plaintextValue = (store.get('deepseekApiKey') ?? '').trim()
  if (!plaintextValue) {
    return EMPTY_DEEPSEEK_KEY_STATUS
  }

  if (safeStorage?.isEncryptionAvailable()) {
    store.set('deepseekApiKeyEncrypted', safeStorage.encryptString(plaintextValue).toString('base64'))
    store.set('deepseekApiKey', '')
    return { configured: true, protection: 'encrypted' }
  }

  return { configured: true, protection: 'plaintext' }
}

export function loadDeepSeekApiKey(
  store: AssistantStoreLike = getDesktopStore(),
  safeStorage?: SafeStorageLike
): string {
  const encryptedValue = (store.get('deepseekApiKeyEncrypted') ?? '').trim()
  if (encryptedValue) {
    if (!safeStorage?.isEncryptionAvailable()) {
      return ''
    }

    try {
      return safeStorage.decryptString(Buffer.from(encryptedValue, 'base64')).trim()
    } catch {
      return ''
    }
  }

  return (store.get('deepseekApiKey') ?? '').trim()
}

export function saveDeepSeekApiKey(
  store: AssistantStoreLike = getDesktopStore(),
  key: string,
  safeStorage?: SafeStorageLike
): DeepSeekKeyStatus {
  const apiKey = key.trim()
  if (!apiKey) {
    return clearDeepSeekApiKey(store)
  }

  if (safeStorage?.isEncryptionAvailable()) {
    store.set('deepseekApiKeyEncrypted', safeStorage.encryptString(apiKey).toString('base64'))
    store.set('deepseekApiKey', '')
    store.set('deepseekApiKeyStored', true)
    return { configured: true, protection: 'encrypted' }
  }

  store.set('deepseekApiKeyEncrypted', '')
  store.set('deepseekApiKey', apiKey)
  store.set('deepseekApiKeyStored', true)
  return { configured: true, protection: 'plaintext' }
}

export function clearDeepSeekApiKey(
  store: AssistantStoreLike = getDesktopStore()
): DeepSeekKeyStatus {
  store.set('deepseekApiKeyEncrypted', '')
  store.set('deepseekApiKey', '')
  store.set('deepseekApiKeyStored', false)

  return EMPTY_DEEPSEEK_KEY_STATUS
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
  note: VideoNote,
  summaryText?: string
): VideoNoteArchiveEntry[] {
  const archives = replaceVideoNoteArchiveVersion(
    loadVideoNoteArchives(store),
    archiveId,
    versionId,
    note,
    summaryText
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
  const items = store.get('videoAudioTranscriptionQueue') ?? []

  if (items.length === 0) {
    return []
  }

  items.forEach((item) => {
    if (item.draftNote && !item.archiveNoteId) {
      saveVideoNoteArchiveVersion(store, item.draftNote, item.completedAt ?? item.updatedAt, '')
    }
  })
  store.set('videoAudioTranscriptionQueue', [])

  return []
}

export function saveVideoAudioTranscriptionQueue(
  store: AssistantStoreLike = getDesktopStore(),
  items: VideoAudioTranscriptionQueueItem[]
): VideoAudioTranscriptionQueueItem[] {
  store.set('videoAudioTranscriptionQueue', items)

  return items
}
