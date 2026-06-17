import type { AssistantPetState } from './petState'
import type {
  LayeredPetTransientView,
  LayeredPetView,
  PetEffect,
  PetExpression,
  PetLayerId,
  PetMotion,
  PetTransient
} from './layeredPetTypes'

const LAYER_ORDER: PetLayerId[] = ['character', 'effect']

const STATE_VISUALS: Record<
  AssistantPetState,
  {
    expression: PetExpression
    effect: PetEffect
    motion: PetMotion
  }
> = {
  idle: {
    expression: {
      eyes: 'idle',
      mouth: 'smile'
    },
    effect: 'none',
    motion: 'idle'
  },
  hint: {
    expression: {
      eyes: 'happy',
      mouth: 'open'
    },
    effect: 'hint-sparkles',
    motion: 'hint'
  },
  working: {
    expression: {
      eyes: 'focused',
      mouth: 'open'
    },
    effect: 'working-stars',
    motion: 'working'
  },
  error: {
    expression: {
      eyes: 'wronged',
      mouth: 'small'
    },
    effect: 'error-sweat',
    motion: 'error'
  }
}

const TRANSIENT_VISUALS: Record<PetTransient, LayeredPetTransientView> = {
  clicked: {
    transient: 'clicked',
    expression: {
      eyes: 'happy',
      mouth: 'smile'
    },
    effect: 'click-hearts',
    motion: 'clicked',
    durationMs: 850
  }
}

export function createLayeredPetView(state: AssistantPetState): LayeredPetView {
  const visual = STATE_VISUALS[state]

  return {
    state,
    ...visual,
    layers: LAYER_ORDER.map((id) => ({
      id,
      visible: id !== 'effect' || visual.effect !== 'none'
    }))
  }
}

export function createLayeredPetTransientView(transient: PetTransient): LayeredPetTransientView {
  return TRANSIENT_VISUALS[transient]
}
