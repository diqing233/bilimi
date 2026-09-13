import Store from 'electron-store'
import { readFileSync, writeFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createDefaultFavoriteLedgers, isPersistableFavoriteLedgerId, normalizeFavoriteLedgers } from '../../src/shared/favoriteLedgers'
import { normalizeOldFavoriteWorkspaceSegmentSize } from '../../src/shared/oldFavoriteWorkspace'
import { normalizeAssistantSidebarWidthPx } from '../../src/shared/assistantSidebarWidth'
import { DEFAULT_TRANSCRIPTION_MODEL_ID } from '../../src/shared/transcriptionModels'
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
import { createVideoNoteId, normalizeVideoNotes, upsertVideoNote } from '../../src/shared/videoNotes'
import {
  createNoteProcessingCheckpointKey,
  pruneNoteProcessingCheckpoints,
  type NoteProcessingCheckpoint
} from '../../src/shared/noteProcessingCheckpoint'
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
  FavoriteAccountPreferences,
  DeletedFavoriteLedgerRecord,
  FavoriteLedger,
  FavoriteLedgerEnabledPatch,
  MainWindowCloseBehavior,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionThreadLimit,
  TranscriptionModelId,
  VideoAudioTranscriptionQueueItem,
  VideoNote,
  VideoNoteArchiveEntry
} from '../../src/shared/types'

export type AssistantPreferences = {
  /** Portable presentation preferences; credentials and runtime state stay excluded. */
  theme: 'light' | 'dark' | 'system'
  language: string
  windowBounds: { x: number; y: number; width: number; height: number } | null
  favoritesFolderName: string
  favoriteLedgers: FavoriteLedger[]
  favoriteAccountPreferences: Record<string, FavoriteAccountPreferences>
  ledgerPromptDismissed: boolean
  petStyle: 'big-head' | 'classic'
  petHoverShortcuts: PetHoverShortcutId[]
  showPetAssistantShortcut: boolean
  autoShowPetOnStartup: boolean
  hidePetDuringVideoFullscreen: boolean
  closeBehavior: MainWindowCloseBehavior
  confirmBeforeExit: boolean
  rememberCloseChoice?: boolean
  closeChoiceMigrationVersion?: number
  bilibiliOperationMode: 'page-visual' | 'api-assisted'
  bilibiliConnectionMode: 'auto' | 'direct'
  favoriteArchiveMultiMode: FavoriteArchiveMultiMode
  oldFavoriteWorkspaceSegmentSize: number
  favoriteArchiveStrategy: FavoriteArchiveStrategy
  favoriteCorrectionLearningEnabled: boolean
  favoriteCorrectionLearningClassificationEnabled: boolean
  favoriteAdjustmentRecordsVersion: 1
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
  /** Device-local opt-outs for automatic work-folder adoption by Bilibili UID. */
  favoriteLibraryDismissedRemoteFolderIdsByAccount: Record<string, string[]>
  /** Device-local opt-outs for the remote-only Bilimi draft reminder by Bilibili UID. */
  favoriteLedgerRemoteDraftReminderDismissedByAccount: Record<string, string[]>
  /** Remote-only drafts deleted locally remain suppressed until the owner explicitly runs backup again. */
  favoriteLedgerRemoteDraftRediscoveryPendingByAccount: Record<string, string[]>
  deepseekApiKey: string
  deepseekApiKeyEncrypted: string
  videoNotes: VideoNote[]
  videoNoteArchives: VideoNoteArchiveEntry[]
  pendingFavoriteQueue: PendingFavoriteQueueItem[]
  videoAudioTranscriptionQueue: VideoAudioTranscriptionQueueItem[]
  noteProcessingCheckpointsV1: Record<string, NoteProcessingCheckpoint>
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

export type FavoriteLedgerEnabledOverrideStoreLike = {
  getOverrides(): Record<string, Record<string, boolean>>
  append(patch: FavoriteLedgerEnabledPatch): Promise<void>
  clear(accountMid?: string): void
}

function normalizeFavoriteAccountMid(accountMid: string) {
  const trimmed = accountMid.trim()
  if (!/^\d+$/u.test(trimmed) || BigInt(trimmed) === 0n) throw new Error('Favorite account is invalid.')
  return BigInt(trimmed).toString()
}

function normalizedDismissedRemoteFolderIdsByAccount(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, string[]>
  const normalized: Record<string, string[]> = {}
  for (const [accountMid, folderIds] of Object.entries(value)) {
    try {
      const account = normalizeFavoriteAccountMid(accountMid)
      if (!Array.isArray(folderIds)) continue
      const ids = [...new Set(folderIds.filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim()).filter(Boolean))].sort()
      if (ids.length) normalized[account] = ids
    } catch {
      // Ignore malformed device-local account projections.
    }
  }
  return normalized
}

function normalizePortableWindowBounds(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const bounds = value as Record<string, unknown>
  if (!['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key]))) return null
  if (Number(bounds.width) < 100 || Number(bounds.height) < 100) return null
  return { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) }
}

function normalizeFavoriteAccountPreferences(value: unknown): FavoriteAccountPreferences | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<FavoriteAccountPreferences>
  if (!Array.isArray(candidate.favoriteLedgers)) return undefined
  return {
    defaultFavoriteSystemEnabled: candidate.defaultFavoriteSystemEnabled !== false,
    favoriteLedgers: normalizeFavoriteLedgers(candidate.favoriteLedgers),
    ...(Array.isArray(candidate.hiddenFavoriteLibraryManagedLedgerIds)
      ? { hiddenFavoriteLibraryManagedLedgerIds: [...new Set(candidate.hiddenFavoriteLibraryManagedLedgerIds
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter((id) => isPersistableFavoriteLedgerId(id)))].sort() }
      : {}),
    ...(candidate.favoriteDiscoveryNoticeDismissed === true
      ? { favoriteDiscoveryNoticeDismissed: true }
      : {}),
    ...(Array.isArray(candidate.deletedFavoriteLedgerRecords)
      ? { deletedFavoriteLedgerRecords: candidate.deletedFavoriteLedgerRecords.flatMap((record) => {
          if (!record || typeof record !== 'object' || Array.isArray(record)) return []
          const item = record as Partial<DeletedFavoriteLedgerRecord>
          if (typeof item.logicalLedgerId !== 'string' || !item.logicalLedgerId.trim() ||
            typeof item.deletedAt !== 'string' || !Number.isFinite(Date.parse(item.deletedAt)) ||
            !item.ledger || typeof item.ledger !== 'object' || Array.isArray(item.ledger)) return []
          const ledger = normalizeFavoriteLedgers([item.ledger as FavoriteLedger])[0]
          return ledger ? [{ logicalLedgerId: item.logicalLedgerId.trim(), deletedAt: new Date(Date.parse(item.deletedAt)).toISOString(), ledger }] : []
        }) }
      : {}),
    ...(candidate.favoriteLibraryCollapsedGroups && typeof candidate.favoriteLibraryCollapsedGroups === 'object'
      ? { favoriteLibraryCollapsedGroups: Object.fromEntries(Object.entries(candidate.favoriteLibraryCollapsedGroups)
        .filter(([key, value]) => /^[a-z-]+$/u.test(key) && typeof value === 'boolean')) }
      : {}),
    ...(candidate.transcriptionModelId === 'whisper-small' || candidate.transcriptionModelId === 'faster-whisper-large-v3-turbo' || candidate.transcriptionModelId === 'faster-whisper-large-v3' || candidate.transcriptionModelId === 'sensevoice-small'
      ? { transcriptionModelId: candidate.transcriptionModelId }
      : {}),
    ...(typeof candidate.updatedAt === 'string' && Number.isFinite(Date.parse(candidate.updatedAt))
      ? { updatedAt: new Date(Date.parse(candidate.updatedAt)).toISOString() }
      : {})
  }
}

function normalizeFavoriteAccountPreferenceMap(value: unknown) {
  if (!value || typeof value !== 'object') return {} as Record<string, FavoriteAccountPreferences>
  const normalized: Record<string, FavoriteAccountPreferences> = {}
  for (const [accountMid, preferences] of Object.entries(value)) {
    try {
      const account = normalizeFavoriteAccountMid(accountMid)
      const entry = normalizeFavoriteAccountPreferences(preferences)
      if (entry) normalized[account] = entry
    } catch {
      // Ignore malformed persisted account projections.
    }
  }
  return normalized
}

function normalizeFavoriteLedgerEnabledOverrides(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, Record<string, boolean>>
  }
  const normalized: Record<string, Record<string, boolean>> = {}
  for (const [accountMid, ledgerValues] of Object.entries(value)) {
    try {
      const account = normalizeFavoriteAccountMid(accountMid)
      if (!ledgerValues || typeof ledgerValues !== 'object' || Array.isArray(ledgerValues)) continue
      const ledgers: Record<string, boolean> = {}
      for (const [ledgerId, enabled] of Object.entries(ledgerValues)) {
        const normalizedLedgerId = ledgerId.trim()
        if (normalizedLedgerId && typeof enabled === 'boolean') ledgers[normalizedLedgerId] = enabled
      }
      if (Object.keys(ledgers).length) normalized[account] = ledgers
    } catch {
      // Ignore malformed entries in the small transient override index.
    }
  }
  return normalized
}

function applyFavoriteLedgerEnabledOverrides(
  accounts: Record<string, FavoriteAccountPreferences>,
  overrideStore: FavoriteLedgerEnabledOverrideStoreLike
) {
  const overrides = normalizeFavoriteLedgerEnabledOverrides(
    overrideStore.getOverrides()
  )
  return Object.fromEntries(Object.entries(accounts).map(([accountMid, preferences]) => {
    const accountOverrides = overrides[accountMid]
    if (!accountOverrides) return [accountMid, preferences]
    return [accountMid, {
      ...preferences,
      favoriteLedgers: preferences.favoriteLedgers.map((ledger) =>
        Object.prototype.hasOwnProperty.call(accountOverrides, ledger.id)
          ? { ...ledger, enabled: accountOverrides[ledger.id] }
          : ledger
      )
    }]
  }))
}

function clearFavoriteLedgerEnabledOverrides(
  overrideStore: FavoriteLedgerEnabledOverrideStoreLike,
  accountMid?: string
) {
  overrideStore.clear(accountMid)
}

export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  theme: 'system',
  language: 'zh-CN',
  windowBounds: null,
  favoritesFolderName: 'bilimi 内库',
  favoriteLedgers: createDefaultFavoriteLedgers(),
  favoriteAccountPreferences: {},
  ledgerPromptDismissed: false,
  petStyle: 'big-head',
  petHoverShortcuts: DEFAULT_PET_HOVER_SHORTCUTS,
  showPetAssistantShortcut: true,
  autoShowPetOnStartup: true,
  hidePetDuringVideoFullscreen: false,
  closeBehavior: 'minimize-to-tray',
  confirmBeforeExit: true,
  rememberCloseChoice: false,
  closeChoiceMigrationVersion: 1,
  bilibiliOperationMode: 'api-assisted',
  bilibiliConnectionMode: 'auto',
  favoriteArchiveMultiMode: 'off',
  oldFavoriteWorkspaceSegmentSize: 2_000,
  favoriteArchiveStrategy: 'aggressive',
  favoriteCorrectionLearningEnabled: true,
  favoriteCorrectionLearningClassificationEnabled: true,
  favoriteAdjustmentRecordsVersion: 1,
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
  closeChoiceMigrationVersion: 0,
  favoriteLibraryDismissedRemoteFolderIdsByAccount: {},
  favoriteLedgerRemoteDraftReminderDismissedByAccount: {},
  favoriteLedgerRemoteDraftRediscoveryPendingByAccount: {},
  deepseekApiKey: '',
  deepseekApiKeyEncrypted: '',
  videoNotes: [],
  videoNoteArchives: [],
  pendingFavoriteQueue: [],
  videoAudioTranscriptionQueue: [],
  noteProcessingCheckpointsV1: {},
}

let desktopStore: Store<DesktopStoreState> | undefined
let favoriteLedgerEnabledOverrideStore: FavoriteLedgerEnabledOverrideStoreLike | undefined

const EMPTY_FAVORITE_LEDGER_ENABLED_OVERRIDE_STORE: FavoriteLedgerEnabledOverrideStoreLike = {
  getOverrides: () => ({}),
  append: async () => {},
  clear: () => {}
}

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

export function getFavoriteLedgerEnabledOverrideStore(): FavoriteLedgerEnabledOverrideStoreLike {
  if (!favoriteLedgerEnabledOverrideStore) {
    const journalPath = join(dirname(getDesktopStore().path), 'favorite-ledger-enabled-overrides.jsonl')
    let overrides: Record<string, Record<string, boolean>> = {}
    try {
      const records = readFileSync(journalPath, 'utf8').split(/\r?\n/u).filter(Boolean)
      for (const record of records) {
        const patch = JSON.parse(record) as Partial<FavoriteLedgerEnabledPatch>
        if (typeof patch.accountMid !== 'string' || typeof patch.ledgerId !== 'string' || typeof patch.enabled !== 'boolean') continue
        const accountMid = normalizeFavoriteAccountMid(patch.accountMid)
        const ledgerId = patch.ledgerId.trim()
        if (!ledgerId) continue
        overrides = { ...overrides, [accountMid]: { ...(overrides[accountMid] ?? {}), [ledgerId]: patch.enabled } }
      }
    } catch {
      // A missing or malformed journal starts with no transient overrides.
    }
    favoriteLedgerEnabledOverrideStore = {
      getOverrides: () => overrides,
      async append(patch) {
        await appendFile(journalPath, `${JSON.stringify(patch)}\n`, 'utf8')
        overrides[patch.accountMid] ??= {}
        overrides[patch.accountMid][patch.ledgerId] = patch.enabled
      },
      clear(accountMid) {
        if (accountMid) {
          const { [accountMid]: _removed, ...remaining } = overrides
          overrides = remaining
        } else {
          overrides = {}
        }
        const compacted = Object.entries(overrides).flatMap(([savedAccountMid, ledgers]) =>
          Object.entries(ledgers).map(([ledgerId, enabled]) =>
            JSON.stringify({ accountMid: savedAccountMid, ledgerId, enabled })
          )
        )
        writeFileSync(journalPath, compacted.length ? `${compacted.join('\n')}\n` : '', 'utf8')
      }
    }
  }
  return favoriteLedgerEnabledOverrideStore
}

function resolveFavoriteLedgerEnabledOverrideStore(
  store: AssistantStoreLike,
  overrideStore?: FavoriteLedgerEnabledOverrideStoreLike
) {
  if (overrideStore) return overrideStore
  return desktopStore && store === desktopStore
    ? getFavoriteLedgerEnabledOverrideStore()
    : EMPTY_FAVORITE_LEDGER_ENABLED_OVERRIDE_STORE
}

export function loadAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  safeStorage?: SafeStorageLike,
  overrideStore?: FavoriteLedgerEnabledOverrideStoreLike
): AssistantPreferences {
  const enabledOverrideStore = resolveFavoriteLedgerEnabledOverrideStore(store, overrideStore)
  const petStyle = store.get('petStyle')
  const bilibiliOperationMode = store.get('bilibiliOperationMode')
  const bilibiliConnectionMode = store.get('bilibiliConnectionMode')
  const favoriteArchiveMultiMode = store.get('favoriteArchiveMultiMode')
  const favoriteArchiveStrategy = store.get('favoriteArchiveStrategy')
  const defaultCoinCount = store.get('defaultCoinCount')
  const commentSubmitMode = store.get('commentSubmitMode')
  const videoAudioTranscriptionThreadLimit = store.get('videoAudioTranscriptionThreadLimit')
  const deepseekApiKey = store.get('deepseekApiKey') ?? ''
  const deepseekApiKeyEncrypted = store.get('deepseekApiKeyEncrypted') ?? ''

  const closeChoiceMigrationVersion = Number(store.get('closeChoiceMigrationVersion'))
  if (closeChoiceMigrationVersion !== 1) {
    store.set({ rememberCloseChoice: false, closeChoiceMigrationVersion: 1 })
  }

  return {
    theme: store.get('theme') === 'light' || store.get('theme') === 'dark' ? store.get('theme') : 'system',
    language: typeof store.get('language') === 'string' && store.get('language').trim() ? store.get('language').trim() : 'zh-CN',
    windowBounds: normalizePortableWindowBounds(store.get('windowBounds')),
    favoritesFolderName: typeof store.get('favoritesFolderName') === 'string' && store.get('favoritesFolderName').trim()
      ? store.get('favoritesFolderName').trim()
      : DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName,
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    favoriteAccountPreferences: applyFavoriteLedgerEnabledOverrides(
      normalizeFavoriteAccountPreferenceMap(store.get('favoriteAccountPreferences')),
      enabledOverrideStore
    ),
    ledgerPromptDismissed: Boolean(store.get('ledgerPromptDismissed')),
    petStyle: petStyle === 'classic' ? 'classic' : 'big-head',
    petHoverShortcuts: normalizePetHoverShortcuts(store.get('petHoverShortcuts')),
    showPetAssistantShortcut:
      store.has?.('showPetAssistantShortcut') === false
        ? true
        : Boolean(store.get('showPetAssistantShortcut')) ||
          hasLegacyAssistantHoverShortcut(store.get('petHoverShortcuts')),
    autoShowPetOnStartup:
      store.has?.('autoShowPetOnStartup') === false ? true : Boolean(store.get('autoShowPetOnStartup')),
    hidePetDuringVideoFullscreen: Boolean(store.get('hidePetDuringVideoFullscreen')),
    closeBehavior: normalizeMainWindowCloseBehavior(store.get('closeBehavior')),
    confirmBeforeExit:
      store.has?.('confirmBeforeExit') === false ? true : Boolean(store.get('confirmBeforeExit')),
    rememberCloseChoice:
      closeChoiceMigrationVersion === 1 ? Boolean(store.get('rememberCloseChoice')) : false,
    closeChoiceMigrationVersion: 1,
    bilibiliOperationMode:
      bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    bilibiliConnectionMode: bilibiliConnectionMode === 'direct' ? 'direct' : 'auto',
    favoriteArchiveMultiMode:
      favoriteArchiveMultiMode === 'two' || favoriteArchiveMultiMode === 'three'
        ? favoriteArchiveMultiMode
        : 'off',
    oldFavoriteWorkspaceSegmentSize: normalizeOldFavoriteWorkspaceSegmentSize(
      store.get('oldFavoriteWorkspaceSegmentSize')
    ),
    favoriteArchiveStrategy: normalizeFavoriteArchiveStrategy(favoriteArchiveStrategy),
    favoriteCorrectionLearningEnabled:
      store.has?.('favoriteCorrectionLearningEnabled') === false
        ? true
        : Boolean(store.get('favoriteCorrectionLearningEnabled')),
    favoriteCorrectionLearningClassificationEnabled:
      store.has?.('favoriteCorrectionLearningClassificationEnabled') === false
        ? true
        : Boolean(store.get('favoriteCorrectionLearningClassificationEnabled')),
    favoriteAdjustmentRecordsVersion: 1,
    favoriteCorrectionRecords:
      store.get('favoriteAdjustmentRecordsVersion') === 1
        ? normalizeFavoriteCorrectionRecords(store.get('favoriteCorrectionRecords'))
        : [],
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
    deepseekApiKeyStored: safeStorage
      ? loadDeepSeekApiKeyStatus(store, safeStorage).configured
      : Boolean(String(deepseekApiKey).trim() || String(deepseekApiKeyEncrypted).trim()),
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
  preferences: AssistantPreferences = DEFAULT_ASSISTANT_PREFERENCES,
  overrideStore?: FavoriteLedgerEnabledOverrideStoreLike
): AssistantPreferences {
  const enabledOverrideStore = resolveFavoriteLedgerEnabledOverrideStore(store, overrideStore)
  // A renderer can load before the account-specific lazy migration has
  // completed and send back a full preference snapshot with an empty account
  // map.  Never let that stale snapshot erase durable account projections;
  // explicit entries still replace only the accounts they contain.
  const currentFavoriteAccountPreferences = normalizeFavoriteAccountPreferenceMap(
    store.get('favoriteAccountPreferences')
  )
  const requestedFavoriteAccountPreferences = normalizeFavoriteAccountPreferenceMap(
    preferences.favoriteAccountPreferences
  )
  store.set({
    theme: preferences.theme === 'light' || preferences.theme === 'dark' ? preferences.theme : 'system',
    language: typeof preferences.language === 'string' && preferences.language.trim() ? preferences.language.trim() : 'zh-CN',
    windowBounds: normalizePortableWindowBounds(preferences.windowBounds),
    favoritesFolderName: preferences.favoritesFolderName,
    favoriteLedgers: normalizeFavoriteLedgers(preferences.favoriteLedgers),
    favoriteAccountPreferences: {
      ...currentFavoriteAccountPreferences,
      ...requestedFavoriteAccountPreferences
    },
    ledgerPromptDismissed: Boolean(preferences.ledgerPromptDismissed),
    petStyle: preferences.petStyle === 'classic' ? 'classic' : 'big-head',
    petHoverShortcuts: normalizePetHoverShortcuts(preferences.petHoverShortcuts),
    showPetAssistantShortcut: Boolean(preferences.showPetAssistantShortcut),
    autoShowPetOnStartup: Boolean(preferences.autoShowPetOnStartup),
    hidePetDuringVideoFullscreen: Boolean(preferences.hidePetDuringVideoFullscreen),
    closeBehavior: normalizeMainWindowCloseBehavior(preferences.closeBehavior),
    confirmBeforeExit: Boolean(preferences.confirmBeforeExit),
    rememberCloseChoice: Boolean(preferences.rememberCloseChoice),
    closeChoiceMigrationVersion: 1,
    bilibiliOperationMode:
      preferences.bilibiliOperationMode === 'page-visual' ? 'page-visual' : 'api-assisted',
    bilibiliConnectionMode: preferences.bilibiliConnectionMode === 'direct' ? 'direct' : 'auto',
    favoriteArchiveMultiMode:
      preferences.favoriteArchiveMultiMode === 'two' || preferences.favoriteArchiveMultiMode === 'three'
        ? preferences.favoriteArchiveMultiMode
        : 'off',
    oldFavoriteWorkspaceSegmentSize: normalizeOldFavoriteWorkspaceSegmentSize(
      preferences.oldFavoriteWorkspaceSegmentSize
    ),
    favoriteArchiveStrategy: normalizeFavoriteArchiveStrategy(preferences.favoriteArchiveStrategy),
    favoriteCorrectionLearningEnabled: Boolean(preferences.favoriteCorrectionLearningEnabled),
    favoriteCorrectionLearningClassificationEnabled: Boolean(
      preferences.favoriteCorrectionLearningClassificationEnabled
    ),
    favoriteAdjustmentRecordsVersion: 1,
    favoriteCorrectionRecords:
      preferences.favoriteAdjustmentRecordsVersion === 1
        ? normalizeFavoriteCorrectionRecords(preferences.favoriteCorrectionRecords)
        : [],
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

  clearFavoriteLedgerEnabledOverrides(enabledOverrideStore)
  return loadAssistantPreferences(store, undefined, enabledOverrideStore)
}

export function normalizeAssistantPreferencePatch(
  patch: Partial<AssistantPreferences> = {}
): Partial<AssistantPreferences> | null {
  const scalarPatch: Partial<AssistantPreferences> = {}
  let scalarOnly = true

  for (const [key, value] of Object.entries(patch) as Array<[
    keyof AssistantPreferences,
    AssistantPreferences[keyof AssistantPreferences]
  ]>) {
    switch (key) {
      case 'deepseekEnabled':
      case 'deepseekCommentEnabled':
      case 'deepseekAutoSummaryEnabled':
      case 'deepseekPetChatEnabled':
      case 'deepseekDailyClassificationEnabled':
      case 'deepseekArchiveOrganizationEnabled':
      case 'deepseekFeatureDefaultsInitialized':
      case 'ledgerPromptDismissed':
      case 'showPetAssistantShortcut':
      case 'autoShowPetOnStartup':
      case 'hidePetDuringVideoFullscreen':
      case 'confirmBeforeExit':
      case 'rememberCloseChoice':
      case 'permissionOnboardingCompleted':
        Object.assign(scalarPatch, { [key]: Boolean(value) })
        break
      case 'deepseekDailyClassificationMode':
        scalarPatch.deepseekDailyClassificationMode = normalizeDeepSeekDailyClassificationMode(value)
        break
      case 'deepseekModel':
        scalarPatch.deepseekModel = typeof value === 'string'
          ? value
          : DEFAULT_ASSISTANT_PREFERENCES.deepseekModel
        break
      case 'deepseekBaseUrl':
        scalarPatch.deepseekBaseUrl = typeof value === 'string'
          ? value
          : DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl
        break
      case 'petStyle':
        scalarPatch.petStyle = value === 'classic' ? 'classic' : 'big-head'
        break
      case 'closeBehavior':
        scalarPatch.closeBehavior = normalizeMainWindowCloseBehavior(value)
        break
      case 'bilibiliOperationMode':
        scalarPatch.bilibiliOperationMode = value === 'page-visual' ? 'page-visual' : 'api-assisted'
        break
      case 'bilibiliConnectionMode':
        scalarPatch.bilibiliConnectionMode = value === 'direct' ? 'direct' : 'auto'
        break
      case 'favoriteArchiveMultiMode':
        scalarPatch.favoriteArchiveMultiMode = value === 'two' || value === 'three' ? value : 'off'
        break
      case 'favoriteArchiveStrategy':
        scalarPatch.favoriteArchiveStrategy = normalizeFavoriteArchiveStrategy(value)
        break
      case 'oldFavoriteWorkspaceSegmentSize':
        scalarPatch.oldFavoriteWorkspaceSegmentSize = normalizeOldFavoriteWorkspaceSegmentSize(value)
        break
      case 'defaultCoinCount':
        scalarPatch.defaultCoinCount = value === 2 ? 2 : 1
        break
      case 'commentSubmitMode':
        scalarPatch.commentSubmitMode = value === 'random' ? 'random' : 'choose'
        break
      case 'videoAudioTranscriptionThreadLimit':
        scalarPatch.videoAudioTranscriptionThreadLimit = normalizeVideoAudioTranscriptionThreadLimit(value)
        break
      case 'assistantSidebarWidthPx':
        scalarPatch.assistantSidebarWidthPx = normalizeAssistantSidebarWidthPx(value)
        break
      case 'petHoverShortcuts':
        scalarPatch.petHoverShortcuts = normalizePetHoverShortcuts(value)
        break
      case 'favoritesFolderName':
        scalarPatch.favoritesFolderName = typeof value === 'string' ? value : DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName
        break
      default:
        scalarOnly = false
        break
    }
  }

  if (scalarOnly) {
    return scalarPatch
  }

  return null
}

export function writeAssistantPreferencePatch(
  store: AssistantStoreLike = getDesktopStore(),
  patch: Partial<AssistantPreferences> = {}
): Partial<AssistantPreferences> | null {
  const normalizedPatch = normalizeAssistantPreferencePatch(patch)
  if (!normalizedPatch) return null
  if (Object.keys(normalizedPatch).length > 0) store.set(normalizedPatch)
  return normalizedPatch
}

export function patchAssistantPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  patch: Partial<AssistantPreferences> = {}
): AssistantPreferences {
  const normalizedPatch = normalizeAssistantPreferencePatch(patch)
  if (normalizedPatch) {
    writeAssistantPreferencePatch(store, normalizedPatch)
    return loadAssistantPreferences(store)
  }

  return saveAssistantPreferences(store, {
    ...loadAssistantPreferences(store),
    ...patch
  })
}

export function isFavoriteLibraryRemoteFolderDismissed(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string, remoteFolderId: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const folderId = remoteFolderId.trim()
  if (!folderId) return false
  return normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLibraryDismissedRemoteFolderIdsByAccount'))[account]?.includes(folderId) ?? false
}

export function dismissFavoriteLibraryRemoteFolder(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string, remoteFolderId: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const folderId = remoteFolderId.trim()
  if (!folderId) throw new Error('Favorite library remote folder is invalid.')
  const current = normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLibraryDismissedRemoteFolderIdsByAccount'))
  const next = [...new Set([...(current[account] ?? []), folderId])].sort()
  store.set('favoriteLibraryDismissedRemoteFolderIdsByAccount', { ...current, [account]: next })
}

export function isFavoriteLedgerRemoteDraftReminderDismissed(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string, remoteFolderId: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const folderId = remoteFolderId.trim()
  if (!folderId) return false
  return normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftReminderDismissedByAccount'))[account]?.includes(folderId) ?? false
}

export function loadFavoriteLedgerRemoteDraftReminderDismissals(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  return normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftReminderDismissedByAccount'))[account] ?? []
}

export function dismissFavoriteLedgerRemoteDraftReminder(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string, remoteFolderId: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const folderId = remoteFolderId.trim()
  if (!folderId) throw new Error('Favorite ledger remote draft reminder folder is invalid.')
  const current = normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftReminderDismissedByAccount'))
  const next = [...new Set([...(current[account] ?? []), folderId])].sort()
  store.set('favoriteLedgerRemoteDraftReminderDismissedByAccount', { ...current, [account]: next })
}

/** Returns remote draft IDs that remain hidden until the owner explicitly runs backup. */
export function loadFavoriteLedgerRemoteDraftRediscoveryPending(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  return normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftRediscoveryPendingByAccount'))[account] ?? []
}

/** Keeps a locally deleted remote-only candidate out of ordinary status scans. */
export function markFavoriteLedgerRemoteDraftRediscoveryPending(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string, remoteFolderIds: readonly string[]
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const addedIds = remoteFolderIds.map((id) => id.trim()).filter(Boolean)
  if (!addedIds.length) return
  const current = normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftRediscoveryPendingByAccount'))
  const next = [...new Set([...(current[account] ?? []), ...addedIds])].sort()
  store.set('favoriteLedgerRemoteDraftRediscoveryPendingByAccount', { ...current, [account]: next })
}

/** Releases only explicit-backup pending IDs; manual "do not remind" choices stay untouched. */
export function consumeFavoriteLedgerRemoteDraftRediscoveryPending(
  store: AssistantStoreLike = getDesktopStore(), accountMid: string
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const current = normalizedDismissedRemoteFolderIdsByAccount(store.get('favoriteLedgerRemoteDraftRediscoveryPendingByAccount'))
  const pending = current[account] ?? []
  if (!pending.length) return []
  const { [account]: _consumed, ...remaining } = current
  store.set('favoriteLedgerRemoteDraftRediscoveryPendingByAccount', remaining)
  return pending
}

/** Reads a durable account setting instead of accepting a renderer-owned projection. */
export function loadFavoriteAccountPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  accountMid: string,
  overrideStore?: FavoriteLedgerEnabledOverrideStoreLike
): FavoriteAccountPreferences {
  const account = normalizeFavoriteAccountMid(accountMid)
  const enabledOverrideStore = resolveFavoriteLedgerEnabledOverrideStore(store, overrideStore)
  const accounts = normalizeFavoriteAccountPreferenceMap(store.get('favoriteAccountPreferences'))
  const existing = applyFavoriteLedgerEnabledOverrides(accounts, enabledOverrideStore)[account]
  if (existing) return { ...existing, transcriptionModelId: existing.transcriptionModelId ?? DEFAULT_TRANSCRIPTION_MODEL_ID }

  const initialized: FavoriteAccountPreferences = {
    defaultFavoriteSystemEnabled: true,
    favoriteLedgers: normalizeFavoriteLedgers(store.get('favoriteLedgers')),
    transcriptionModelId: DEFAULT_TRANSCRIPTION_MODEL_ID,
    updatedAt: new Date().toISOString()
  }
  store.set({ favoriteAccountPreferences: { ...accounts, [account]: initialized } })
  return initialized
}

export function saveFavoriteAccountPreferences(
  store: AssistantStoreLike = getDesktopStore(),
  accountMid: string,
  preferences: FavoriteAccountPreferences,
  overrideStore?: FavoriteLedgerEnabledOverrideStoreLike
) {
  const account = normalizeFavoriteAccountMid(accountMid)
  const enabledOverrideStore = resolveFavoriteLedgerEnabledOverrideStore(store, overrideStore)
  const normalized = normalizeFavoriteAccountPreferences({ ...preferences, updatedAt: new Date().toISOString() })
  if (!normalized) throw new Error('Favorite account preferences are invalid.')
  const current = normalizeFavoriteAccountPreferenceMap(store.get('favoriteAccountPreferences'))
  store.set({ favoriteAccountPreferences: { ...current, [account]: normalized } })
  clearFavoriteLedgerEnabledOverrides(enabledOverrideStore, account)
  return normalized
}

export async function writeFavoriteLedgerEnabled(
  store: FavoriteLedgerEnabledOverrideStoreLike = getFavoriteLedgerEnabledOverrideStore(),
  accountMid: string,
  ledgerId: string,
  enabled: boolean
): Promise<FavoriteLedgerEnabledPatch> {
  const account = normalizeFavoriteAccountMid(accountMid)
  const normalizedLedgerId = ledgerId.trim()
  if (!normalizedLedgerId) throw new Error('Favorite ledger is unavailable.')
  const patch = { accountMid: account, ledgerId: normalizedLedgerId, enabled: Boolean(enabled) }
  await store.append(patch)
  return patch
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

function isVerifiedSavedArchiveVersion(
  version: VideoNoteArchiveEntry['versions'][number] | undefined,
  note: VideoNote,
  summaryText: string
): version is VideoNoteArchiveEntry['versions'][number] {
  if (!version || version.note.id !== note.id || version.summaryText !== summaryText) return false
  const savedSource = version.note.source
  const expectedSource = note.source
  if (
    savedSource.accountMid !== expectedSource.accountMid ||
    savedSource.aid !== expectedSource.aid ||
    savedSource.cid !== expectedSource.cid ||
    savedSource.bvid !== expectedSource.bvid
  ) return false
  return JSON.stringify(version.note.transcript) === JSON.stringify(note.transcript)
}

export function saveVideoNoteArchiveVersion(
  store: AssistantStoreLike = getDesktopStore(),
  note: VideoNote,
  createdAt: string = new Date().toISOString(),
  summaryText = ''
): VideoNoteArchiveEntry[] {
  return saveVideoNoteArchiveVersionWithIdentity(store, note, createdAt, summaryText).archives
}

/** Writes one archive version and returns the exact identity created by that mutation. */
export function saveVideoNoteArchiveVersionWithIdentity(
  store: AssistantStoreLike = getDesktopStore(),
  note: VideoNote,
  createdAt: string = new Date().toISOString(),
  summaryText = ''
): { archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string } {
  const previous = loadVideoNoteArchives(store)
  const archiveId = createVideoNoteId(note.source)
  const archives = appendVideoNoteArchiveVersion(
    previous,
    note,
    createdAt,
    summaryText
  )

  store.set('videoNoteArchives', archives)
  const archive = archives.find((candidate) => candidate.id === archiveId)
  const version = archive?.versions.at(-1)
  if (!archive || !version) throw new Error('Archive version identity could not be resolved after saving.')
  const persistedArchives = loadVideoNoteArchives(store)
  const persistedArchive = persistedArchives.find((candidate) => candidate.id === archive.id)
  const persistedVersion = persistedArchive?.versions.at(-1)
  if (!persistedArchive || !isVerifiedSavedArchiveVersion(persistedVersion, note, summaryText)) {
    throw new Error('Archive version could not be re-read after saving.')
  }
  return { archives: persistedArchives, archiveId: persistedArchive.id, versionId: persistedVersion.id }
}

/**
 * Replaces summary content on one immutable archive version and proves the same
 * version can be read back before the caller may publish a summary-success event.
 */
export function saveVideoNoteArchiveSummaryWithIdentity(
  store: AssistantStoreLike = getDesktopStore(),
  archiveId: string,
  versionId: string,
  note: VideoNote,
  summaryText: string
): { archives: VideoNoteArchiveEntry[]; archiveId: string; versionId: string } {
  const normalizedSummary = summaryText.trim()
  if (!normalizedSummary) throw new Error('Archive summary content is empty.')
  const existing = loadVideoNoteArchives(store)
  const existingVersion = existing.find((archive) => archive.id === archiveId)?.versions
    .find((version) => version.id === versionId)
  if (!existingVersion) throw new Error('Archive version could not be found for summary save.')

  const archives = replaceVideoNoteArchiveVersion(existing, archiveId, versionId, note, normalizedSummary)
  store.set('videoNoteArchives', archives)

  const persistedArchives = loadVideoNoteArchives(store)
  const persistedArchive = persistedArchives.find((archive) => archive.id === archiveId)
  const persistedVersion = persistedArchive?.versions.find((version) => version.id === versionId)
  if (!persistedArchive || !isVerifiedSavedArchiveVersion(persistedVersion, note, normalizedSummary)) {
    throw new Error('Archive summary could not be re-read after saving.')
  }
  return { archives: persistedArchives, archiveId: persistedArchive.id, versionId: persistedVersion.id }
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

  const waitingForUserRestart = items
    .filter((item) => item.status === 'waiting-restart')
    .map((item) => ({ ...item, transcriptionModelId: item.transcriptionModelId ?? 'whisper-small' }))
  items.forEach((item) => {
    if (item.status !== 'waiting-restart' && item.draftNote && !item.archiveNoteId) {
      saveVideoNoteArchiveVersion(store, item.draftNote, item.completedAt ?? item.updatedAt, '')
    }
  })
  store.set('videoAudioTranscriptionQueue', waitingForUserRestart)

  return waitingForUserRestart
}

export function saveVideoAudioTranscriptionQueue(
  store: AssistantStoreLike = getDesktopStore(),
  items: VideoAudioTranscriptionQueueItem[]
): VideoAudioTranscriptionQueueItem[] {
  store.set('videoAudioTranscriptionQueue', items)

  return items
}

export function loadNoteProcessingCheckpoints(
  store: AssistantStoreLike = getDesktopStore()
): Record<string, NoteProcessingCheckpoint> {
  return pruneNoteProcessingCheckpoints(store.get('noteProcessingCheckpointsV1') ?? {})
}

export function saveNoteProcessingCheckpoint(
  store: AssistantStoreLike = getDesktopStore(),
  checkpoint: NoteProcessingCheckpoint
): Record<string, NoteProcessingCheckpoint> {
  const checkpoints = loadNoteProcessingCheckpoints(store)
  const next = pruneNoteProcessingCheckpoints({
    ...checkpoints,
    [createNoteProcessingCheckpointKey(checkpoint)]: checkpoint
  })
  store.set('noteProcessingCheckpointsV1', next)
  return next
}

export function deleteNoteProcessingCheckpoint(
  store: AssistantStoreLike = getDesktopStore(),
  checkpoint: Pick<NoteProcessingCheckpoint, 'accountMid' | 'videoId' | 'transcriptHash' | 'promptVersion' | 'model'>
): Record<string, NoteProcessingCheckpoint> {
  const checkpoints = loadNoteProcessingCheckpoints(store)
  delete checkpoints[createNoteProcessingCheckpointKey(checkpoint)]
  store.set('noteProcessingCheckpointsV1', checkpoints)
  return checkpoints
}
