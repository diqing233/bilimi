import type { AssistantPetState } from './petState'

export type PetLayerId = 'character' | 'effect'

export type PetEyes = 'idle' | 'happy' | 'focused' | 'wronged'

export type PetMouth = 'smile' | 'open' | 'small'

export type PetEffect = 'none' | 'hint-sparkles' | 'working-stars' | 'error-sweat' | 'click-hearts'

export type PetMotion = 'idle' | 'hint' | 'working' | 'error' | 'clicked'

export type PetTransient = 'clicked'

export type PetExpression = {
  eyes: PetEyes
  mouth: PetMouth
}

export type PetLayerView = {
  id: PetLayerId
  visible: boolean
}

export type LayeredPetView = {
  state: AssistantPetState
  expression: PetExpression
  effect: PetEffect
  motion: PetMotion
  layers: PetLayerView[]
}

export type LayeredPetTransientView = {
  transient: PetTransient
  expression: PetExpression
  effect: PetEffect
  motion: 'clicked'
  durationMs: number
}

export type PetRendererHandle = {
  setState(state: AssistantPetState): void
  playTransient(name: PetTransient): void
}
