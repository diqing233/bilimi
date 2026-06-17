import clickedCharacterUrl from '../../assets/pet/blue-white-maid/character/clicked.png'
import errorCharacterUrl from '../../assets/pet/blue-white-maid/character/error.png'
import hintCharacterUrl from '../../assets/pet/blue-white-maid/character/hint.png'
import idleCharacterUrl from '../../assets/pet/blue-white-maid/character/idle.png'
import workingCharacterUrl from '../../assets/pet/blue-white-maid/character/working.png'
import clickHeartsUrl from '../../assets/pet/blue-white-maid/effects/click-hearts.png'
import errorSweatUrl from '../../assets/pet/blue-white-maid/effects/error-sweat.png'
import hintSparklesUrl from '../../assets/pet/blue-white-maid/effects/hint-sparkles.png'
import workingStarsUrl from '../../assets/pet/blue-white-maid/effects/working-stars.png'
import type { AssistantPetState } from './petState'
import type { PetEffect, PetTransient } from './layeredPetTypes'

export type PetAssetManifest = {
  character: Record<AssistantPetState | PetTransient, string>
  effects: Record<Exclude<PetEffect, 'none'>, string>
}

export const blueWhiteMaidPetAssets: PetAssetManifest = {
  character: {
    idle: idleCharacterUrl,
    hint: hintCharacterUrl,
    working: workingCharacterUrl,
    error: errorCharacterUrl,
    clicked: clickedCharacterUrl
  },
  effects: {
    'hint-sparkles': hintSparklesUrl,
    'working-stars': workingStarsUrl,
    'error-sweat': errorSweatUrl,
    'click-hearts': clickHeartsUrl
  }
}
