import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '@shared/favoriteLedgers'
import { normalizeAssistantSidebarWidthPx } from '@shared/assistantSidebarWidth'
import { normalizePetHoverShortcuts } from '@shared/petHoverShortcuts'
import { normalizeOldFavoriteWorkspaceSegmentSize } from '@shared/oldFavoriteWorkspace'
import {
  normalizeFavoriteArchiveProtectionInitializedAccountMids,
  normalizeFavoriteArchiveProtectionRecords
} from '@shared/favoriteArchiveProtection'
import type {
  AssistantAction,
  AssistantPreferences,
  CommentSubmitMode,
  FavoriteArchiveStrategy,
  FavoriteKeywordSuggestion,
  FavoriteArchiveMultiMode,
  FavoriteAccountPreferences,
  DeletedFavoriteLedgerRecord,
  MainWindowCloseBehavior,
  RecommendationKind,
  VideoAudioTranscriptionThreadLimit
} from '@shared/types'
import { normalizeCorrectionRecords, normalizeKeywordSuggestions } from '../recommendation/correctionLearning'

const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

export type AssistantState = {
  lastAction: AssistantAction | null
  preferenceCounts: Record<RecommendationKind, number>
}

function createEmptyPreferenceCounts(): Record<RecommendationKind, number> {
  return Object.fromEntries(
    createDefaultFavoriteLedgers().map((ledger) => [ledger.id, 0])
  ) as Record<RecommendationKind, number>
}

export type AssistantStateEvent = {
  type: 'record-feedback'
  kind: RecommendationKind
  action: AssistantAction
}

export function normalizePetStyle(value: unknown): AssistantPreferences['petStyle'] {
  return value === 'classic' ? 'classic' : 'big-head'
}

export function normalizeBilibiliOperationMode(
  value: unknown
): AssistantPreferences['bilibiliOperationMode'] {
  return value === 'page-visual' ? 'page-visual' : 'api-assisted'
}

export function normalizeFavoriteArchiveMultiMode(value: unknown): FavoriteArchiveMultiMode {
  return value === 'two' || value === 'three' ? value : 'off'
}

export function normalizeFavoriteArchiveStrategy(value: unknown): FavoriteArchiveStrategy {
  return value === 'balanced' || value === 'conservative' ? value : 'aggressive'
}

export function normalizeDeepSeekDailyClassificationMode(
  value: unknown
): AssistantPreferences['deepseekDailyClassificationMode'] {
  return value === 'low-confidence-only' ? 'low-confidence-only' : 'all'
}

export function normalizeMainWindowCloseBehavior(value: unknown): MainWindowCloseBehavior {
  return value === 'exit-launcher' ? 'exit-launcher' : 'minimize-to-tray'
}

function normalizeFavoriteKeywordSuggestions(value: unknown): FavoriteKeywordSuggestion[] {
  return normalizeKeywordSuggestions(value)
}

export function normalizeBilibiliConnectionMode(
  value: unknown
): AssistantPreferences['bilibiliConnectionMode'] {
  return value === 'direct' ? value : 'auto'
}

function normalizeFavoriteAccountPreferenceMap(
  value: AssistantPreferences['favoriteAccountPreferences']
): Record<string, FavoriteAccountPreferences> {
  if (!value || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value).flatMap(([accountMid, accountPreferences]) => {
      if (!/^\d+$/u.test(accountMid) || !accountPreferences || !Array.isArray(accountPreferences.favoriteLedgers)) {
        return []
      }

      return [[accountMid, {
        defaultFavoriteSystemEnabled: accountPreferences.defaultFavoriteSystemEnabled !== false,
        favoriteLedgers: normalizeFavoriteLedgers(accountPreferences.favoriteLedgers),
        ...(Array.isArray(accountPreferences.deletedFavoriteLedgerRecords)
          ? {
              deletedFavoriteLedgerRecords: accountPreferences.deletedFavoriteLedgerRecords.flatMap((record) => {
                if (!record || typeof record !== 'object' || typeof record.logicalLedgerId !== 'string' ||
                  typeof record.deletedAt !== 'string' || !record.ledger || typeof record.ledger !== 'object') return []
                return [{
                  logicalLedgerId: record.logicalLedgerId,
                  deletedAt: record.deletedAt,
                  ledger: normalizeFavoriteLedgers([record.ledger as DeletedFavoriteLedgerRecord['ledger']])[0]!
                }]
              })
            }
          : {}),
        ...(accountPreferences.transcriptionModelId === 'sensevoice-small' ||
        accountPreferences.transcriptionModelId === 'whisper-small' ||
        accountPreferences.transcriptionModelId === 'faster-whisper-large-v3-turbo' ||
        accountPreferences.transcriptionModelId === 'faster-whisper-large-v3'
          ? { transcriptionModelId: accountPreferences.transcriptionModelId }
          : {})
      }]]
    })
  )
}

export function normalizeDefaultCoinCount(value: unknown): 1 | 2 {
  return value === 1 ? 1 : 2
}

export function normalizeCommentSubmitMode(value: unknown): CommentSubmitMode {
  if (value === 'random') {
    return 'random'
  }

  return 'choose'
}

export function normalizeVideoAudioTranscriptionThreadLimit(
  value: unknown
): VideoAudioTranscriptionThreadLimit {
  return value === 1 || value === 2 || value === 4 ? value : 'unlimited'
}

function normalizeDeepSeekModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : DEFAULT_DEEPSEEK_MODEL
}

function normalizeDeepSeekBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_DEEPSEEK_BASE_URL
  }

  if (!value.trim()) {
    return ''
  }

  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString().replace(/\/$/, '')
      : DEFAULT_DEEPSEEK_BASE_URL
  } catch {
    return DEFAULT_DEEPSEEK_BASE_URL
  }
}

function normalizeDeepSeekFeatureToggle(value: unknown, legacyEnabled: unknown): boolean {
  return typeof value === 'boolean' ? value : Boolean(legacyEnabled)
}

export function createInitialAssistantState(): AssistantState {
  return {
    lastAction: null,
    preferenceCounts: createEmptyPreferenceCounts()
  }
}

export function createInitialAssistantPreferences(
  persisted?: Partial<AssistantPreferences>
): AssistantPreferences {
  return {
    favoritesFolderName: persisted?.favoritesFolderName ?? 'bilimi 内库',
    favoriteLedgers: normalizeFavoriteLedgers(persisted?.favoriteLedgers ?? createDefaultFavoriteLedgers()),
    favoriteAccountPreferences: normalizeFavoriteAccountPreferenceMap(persisted?.favoriteAccountPreferences),
    ledgerPromptDismissed: Boolean(persisted?.ledgerPromptDismissed),
    petStyle: normalizePetStyle(persisted?.petStyle),
    petHoverShortcuts: normalizePetHoverShortcuts(persisted?.petHoverShortcuts),
    showPetAssistantShortcut:
      typeof persisted?.showPetAssistantShortcut === 'boolean'
        ? persisted.showPetAssistantShortcut
        : true,
    autoShowPetOnStartup:
      typeof persisted?.autoShowPetOnStartup === 'boolean' ? persisted.autoShowPetOnStartup : true,
    hidePetDuringVideoFullscreen: Boolean(persisted?.hidePetDuringVideoFullscreen),
    closeBehavior: normalizeMainWindowCloseBehavior(persisted?.closeBehavior),
    confirmBeforeExit:
      typeof persisted?.confirmBeforeExit === 'boolean' ? persisted.confirmBeforeExit : true,
    rememberCloseChoice:
      typeof persisted?.rememberCloseChoice === 'boolean' ? persisted.rememberCloseChoice : false,
    closeChoiceMigrationVersion: 1,
    bilibiliOperationMode: normalizeBilibiliOperationMode(persisted?.bilibiliOperationMode),
    bilibiliConnectionMode: normalizeBilibiliConnectionMode(persisted?.bilibiliConnectionMode),
    favoriteArchiveMultiMode: normalizeFavoriteArchiveMultiMode(persisted?.favoriteArchiveMultiMode),
    oldFavoriteWorkspaceSegmentSize: normalizeOldFavoriteWorkspaceSegmentSize(
      persisted?.oldFavoriteWorkspaceSegmentSize
    ),
    favoriteArchiveStrategy: normalizeFavoriteArchiveStrategy(persisted?.favoriteArchiveStrategy),
    favoriteCorrectionLearningEnabled:
      typeof persisted?.favoriteCorrectionLearningEnabled === 'boolean'
        ? persisted.favoriteCorrectionLearningEnabled
        : true,
    favoriteCorrectionLearningClassificationEnabled:
      typeof persisted?.favoriteCorrectionLearningClassificationEnabled === 'boolean'
        ? persisted.favoriteCorrectionLearningClassificationEnabled
        : true,
    favoriteAdjustmentRecordsVersion: 1,
    favoriteCorrectionRecords:
      persisted?.favoriteAdjustmentRecordsVersion === 1
        ? normalizeCorrectionRecords(persisted.favoriteCorrectionRecords)
        : [],
    favoriteArchiveProtectionRecords: normalizeFavoriteArchiveProtectionRecords(
      persisted?.favoriteArchiveProtectionRecords
    ),
    favoriteArchiveProtectionInitializedAccountMids:
      normalizeFavoriteArchiveProtectionInitializedAccountMids(
        persisted?.favoriteArchiveProtectionInitializedAccountMids
      ),
    favoriteKeywordSuggestions: normalizeFavoriteKeywordSuggestions(persisted?.favoriteKeywordSuggestions),
    defaultCoinCount: normalizeDefaultCoinCount(persisted?.defaultCoinCount),
    commentSubmitMode: normalizeCommentSubmitMode(persisted?.commentSubmitMode),
    videoAudioTranscriptionThreadLimit: normalizeVideoAudioTranscriptionThreadLimit(
      persisted?.videoAudioTranscriptionThreadLimit
    ),
    preferenceCounts: {
      ...createEmptyPreferenceCounts(),
      ...persisted?.preferenceCounts
    },
    deepseekEnabled: Boolean(persisted?.deepseekEnabled),
    deepseekApiKeyStored: Boolean(persisted?.deepseekApiKeyStored),
    deepseekCommentEnabled: normalizeDeepSeekFeatureToggle(
      persisted?.deepseekCommentEnabled,
      true
    ),
    deepseekAutoSummaryEnabled: normalizeDeepSeekFeatureToggle(
      persisted?.deepseekAutoSummaryEnabled,
      true
    ),
    deepseekPetChatEnabled: normalizeDeepSeekFeatureToggle(
      persisted?.deepseekPetChatEnabled,
      true
    ),
    deepseekDailyClassificationEnabled:
      typeof persisted?.deepseekDailyClassificationEnabled === 'boolean'
        ? persisted.deepseekDailyClassificationEnabled
        : true,
    deepseekArchiveOrganizationEnabled:
      typeof persisted?.deepseekArchiveOrganizationEnabled === 'boolean'
        ? persisted.deepseekArchiveOrganizationEnabled
        : true,
    deepseekFeatureDefaultsInitialized: Boolean(persisted?.deepseekFeatureDefaultsInitialized),
    deepseekDailyClassificationMode: normalizeDeepSeekDailyClassificationMode(
      persisted?.deepseekDailyClassificationMode
    ),
    deepseekModel: normalizeDeepSeekModel(persisted?.deepseekModel),
    deepseekBaseUrl: normalizeDeepSeekBaseUrl(persisted?.deepseekBaseUrl),
    permissionOnboardingCompleted: Boolean(persisted?.permissionOnboardingCompleted),
    assistantSidebarWidthPx: normalizeAssistantSidebarWidthPx(persisted?.assistantSidebarWidthPx)
  }
}

/** Interactive controls already provide typed values; preserve heavy branches until persistence validates them. */
export function applyImmediatePreferencePatch(
  preferences: AssistantPreferences,
  patch: Partial<AssistantPreferences>
): AssistantPreferences {
  const entries = Object.entries(patch) as Array<[
    keyof AssistantPreferences,
    AssistantPreferences[keyof AssistantPreferences]
  ]>
  if (entries.every(([key, value]) => Object.is(preferences[key], value))) return preferences
  return { ...preferences, ...patch }
}

export function applyFavoriteLedgerEnabledPatch(
  preferences: AssistantPreferences,
  patch: { accountMid: string; ledgerId: string; enabled: boolean }
): AssistantPreferences {
  const account = preferences.favoriteAccountPreferences?.[patch.accountMid]
  const currentLedgers = account?.favoriteLedgers ?? preferences.favoriteLedgers
  const index = currentLedgers.findIndex((ledger) => ledger.id === patch.ledgerId)
  if (index < 0 || currentLedgers[index]?.enabled === patch.enabled) return preferences
  const favoriteLedgers = currentLedgers.slice()
  favoriteLedgers[index] = { ...favoriteLedgers[index]!, enabled: patch.enabled }
  if (!account) return { ...preferences, favoriteLedgers }
  return {
    ...preferences,
    favoriteAccountPreferences: {
      ...preferences.favoriteAccountPreferences,
      [patch.accountMid]: { ...account, favoriteLedgers }
    }
  }
}

export function favoriteLedgersForAccount(
  preferences: AssistantPreferences,
  accountMid: string
): AssistantPreferences['favoriteLedgers'] {
  return preferences.favoriteAccountPreferences?.[accountMid]?.favoriteLedgers ?? preferences.favoriteLedgers
}

/** Projects account preferences into the target set used for classification and remote actions. */
export function effectiveFavoriteLedgersForAccount(
  preferences: AssistantPreferences,
  accountMid: string
): AssistantPreferences['favoriteLedgers'] {
  const ledgers = favoriteLedgersForAccount(preferences, accountMid)
  const defaultsEnabled = preferences.favoriteAccountPreferences?.[accountMid]?.defaultFavoriteSystemEnabled !== false
  if (defaultsEnabled) {
    return ledgers.map((ledger) => ledger.isDefault
      ? { ...ledger, enabled: true }
      : ledger)
  }
  return ledgers.map((ledger) => ledger.isDefault && ledger.id !== 'inbox'
    ? { ...ledger, enabled: false, isDefault: false }
    : ledger)
}

export function withFavoriteLedgersForAccount(
  preferences: AssistantPreferences,
  accountMid: string,
  favoriteLedgers: AssistantPreferences['favoriteLedgers']
): AssistantPreferences {
  const currentAccount = preferences.favoriteAccountPreferences?.[accountMid]

  return {
    ...preferences,
    favoriteAccountPreferences: {
      ...(preferences.favoriteAccountPreferences ?? {}),
      [accountMid]: {
        ...currentAccount,
        defaultFavoriteSystemEnabled: currentAccount?.defaultFavoriteSystemEnabled ?? true,
        favoriteLedgers
      }
    }
  }
}

export function recordAssistantPreferenceFeedback(
  preferences: AssistantPreferences,
  kind: RecommendationKind,
  _action: AssistantAction
): AssistantPreferences {
  return {
    ...preferences,
    preferenceCounts: {
      ...preferences.preferenceCounts,
      [kind]: (preferences.preferenceCounts[kind] ?? 0) + 1
    }
  }
}

export function reduceAssistantState(
  state: AssistantState,
  event: AssistantStateEvent
): AssistantState {
  if (event.type === 'record-feedback') {
    return {
      lastAction: event.action,
      preferenceCounts: {
        ...state.preferenceCounts,
        [event.kind]: (state.preferenceCounts[event.kind] ?? 0) + 1
      }
    }
  }

  return state
}
