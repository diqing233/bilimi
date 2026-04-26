import type { AssistantAction, AssistantPreferences, RecommendationKind } from '@shared/types'

export type AssistantState = {
  lastAction: AssistantAction | null
  preferenceCounts: Record<RecommendationKind, number>
}

const EMPTY_PREFERENCE_COUNTS: Record<RecommendationKind, number> = {
  funny: 0,
  knowledge: 0,
  story: 0,
  suspicious: 0
}

export type AssistantStateEvent = {
  type: 'record-feedback'
  kind: RecommendationKind
  action: AssistantAction
}

export function createInitialAssistantState(): AssistantState {
  return {
    lastAction: null,
    preferenceCounts: { ...EMPTY_PREFERENCE_COUNTS }
  }
}

export function createInitialAssistantPreferences(
  persisted?: Partial<AssistantPreferences>
): AssistantPreferences {
  return {
    favoritesFolderName: persisted?.favoritesFolderName ?? 'Bilimi 内库',
    preferenceCounts: {
      ...EMPTY_PREFERENCE_COUNTS,
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
      [kind]: preferences.preferenceCounts[kind] + 1
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
        [event.kind]: state.preferenceCounts[event.kind] + 1
      }
    }
  }

  return state
}
