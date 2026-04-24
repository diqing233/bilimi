import type { AssistantAction, RecommendationKind } from '@shared/types'

export type AssistantState = {
  lastAction: AssistantAction | null
  preferenceCounts: Record<RecommendationKind, number>
}

export type AssistantStateEvent = {
  type: 'record-feedback'
  kind: RecommendationKind
  action: AssistantAction
}

export function createInitialAssistantState(): AssistantState {
  return {
    lastAction: null,
    preferenceCounts: {
      funny: 0,
      knowledge: 0,
      story: 0,
      suspicious: 0
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
