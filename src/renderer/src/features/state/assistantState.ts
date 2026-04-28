import { createDefaultFavoriteLedgers, normalizeFavoriteLedgers } from '@shared/favoriteLedgers'
import type { AssistantAction, AssistantPreferences, RecommendationKind } from '@shared/types'

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
    preferenceCounts: {
      ...createEmptyPreferenceCounts(),
      ...persisted?.preferenceCounts
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
