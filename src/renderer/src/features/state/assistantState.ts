import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '@shared/favoriteLedgers'
import { normalizePetHoverShortcuts } from '@shared/petHoverShortcuts'
import type {
  AssistantAction,
  AssistantPreferences,
  CommentSubmitMode,
  FavoriteArchiveMultiMode,
  RecommendationKind
} from '@shared/types'

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

export function normalizeDefaultCoinCount(value: unknown): 1 | 2 {
  return value === 2 ? 2 : 1
}

export function normalizeCommentSubmitMode(value: unknown): CommentSubmitMode {
  if (value === undefined || value === 'random') {
    return 'random'
  }

  return 'choose'
}

function normalizeDeepSeekModel(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_DEEPSEEK_MODEL
}

function normalizeDeepSeekBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_DEEPSEEK_BASE_URL
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
    favoritesFolderName: persisted?.favoritesFolderName ?? 'Bilimi 内库',
    favoriteLedgers: normalizeFavoriteLedgers(persisted?.favoriteLedgers ?? createDefaultFavoriteLedgers()),
    ledgerPromptDismissed: Boolean(persisted?.ledgerPromptDismissed),
    petStyle: normalizePetStyle(persisted?.petStyle),
    petHoverShortcuts: normalizePetHoverShortcuts(persisted?.petHoverShortcuts),
    hidePetDuringVideoFullscreen: Boolean(persisted?.hidePetDuringVideoFullscreen),
    bilibiliOperationMode: normalizeBilibiliOperationMode(persisted?.bilibiliOperationMode),
    favoriteArchiveMultiMode: normalizeFavoriteArchiveMultiMode(persisted?.favoriteArchiveMultiMode),
    defaultCoinCount: normalizeDefaultCoinCount(persisted?.defaultCoinCount),
    commentSubmitMode: normalizeCommentSubmitMode(persisted?.commentSubmitMode),
    preferenceCounts: {
      ...createEmptyPreferenceCounts(),
      ...persisted?.preferenceCounts
    },
    deepseekEnabled: Boolean(persisted?.deepseekEnabled),
    deepseekApiKeyStored: Boolean(persisted?.deepseekApiKeyStored),
    deepseekCommentEnabled: normalizeDeepSeekFeatureToggle(
      persisted?.deepseekCommentEnabled,
      persisted?.deepseekEnabled
    ),
    deepseekAutoSummaryEnabled: Boolean(persisted?.deepseekAutoSummaryEnabled),
    deepseekPetChatEnabled: normalizeDeepSeekFeatureToggle(
      persisted?.deepseekPetChatEnabled,
      persisted?.deepseekEnabled
    ),
    deepseekModel: normalizeDeepSeekModel(persisted?.deepseekModel),
    deepseekBaseUrl: normalizeDeepSeekBaseUrl(persisted?.deepseekBaseUrl),
    permissionOnboardingCompleted: Boolean(persisted?.permissionOnboardingCompleted)
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
