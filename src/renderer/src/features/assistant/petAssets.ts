import bigHeadClickedCharacterUrl from '../../assets/pet/blue-white-maid/character/big-head/clicked.png'
import bigHeadErrorCharacterUrl from '../../assets/pet/blue-white-maid/character/big-head/error.png'
import bigHeadHintCharacterUrl from '../../assets/pet/blue-white-maid/character/big-head/hint.png'
import bigHeadIdleCharacterUrl from '../../assets/pet/blue-white-maid/character/big-head/idle.png'
import bigHeadWorkingCharacterUrl from '../../assets/pet/blue-white-maid/character/big-head/working.png'
import classicClickedCharacterUrl from '../../assets/pet/blue-white-maid/character/classic/clicked.png'
import classicErrorCharacterUrl from '../../assets/pet/blue-white-maid/character/classic/error.png'
import classicHintCharacterUrl from '../../assets/pet/blue-white-maid/character/classic/hint.png'
import classicIdleCharacterUrl from '../../assets/pet/blue-white-maid/character/classic/idle.png'
import classicWorkingCharacterUrl from '../../assets/pet/blue-white-maid/character/classic/working.png'
import clickHeartsUrl from '../../assets/pet/blue-white-maid/effects/click-hearts.png'
import errorSweatUrl from '../../assets/pet/blue-white-maid/effects/error-sweat.png'
import hintSparklesUrl from '../../assets/pet/blue-white-maid/effects/hint-sparkles.png'
import workingStarsUrl from '../../assets/pet/blue-white-maid/effects/working-stars.png'
import type { AssistantPetState } from './petState'
import type { PetEffect, PetTransient } from './layeredPetTypes'
import type { AssistantPreferences } from '@shared/types'

export type PetAssetManifest = {
  character: Record<AssistantPetState | PetTransient, string>
  effects: Record<Exclude<PetEffect, 'none'>, string>
}

export type PetStyle = AssistantPreferences['petStyle']

export const blueWhiteMaidPetAssetsByStyle: Record<PetStyle, PetAssetManifest> = {
  'big-head': {
    character: {
      idle: bigHeadIdleCharacterUrl,
      hint: bigHeadHintCharacterUrl,
      working: bigHeadWorkingCharacterUrl,
      error: bigHeadErrorCharacterUrl,
      clicked: bigHeadClickedCharacterUrl
    },
    effects: {
      'hint-sparkles': hintSparklesUrl,
      'working-stars': workingStarsUrl,
      'error-sweat': errorSweatUrl,
      'click-hearts': clickHeartsUrl
    }
  },
  classic: {
    character: {
      idle: classicIdleCharacterUrl,
      hint: classicHintCharacterUrl,
      working: classicWorkingCharacterUrl,
      error: classicErrorCharacterUrl,
      clicked: classicClickedCharacterUrl
    },
    effects: {
      'hint-sparkles': hintSparklesUrl,
      'working-stars': workingStarsUrl,
      'error-sweat': errorSweatUrl,
      'click-hearts': clickHeartsUrl
    }
  }
}

export const blueWhiteMaidPetAssets: PetAssetManifest = blueWhiteMaidPetAssetsByStyle['big-head']

export function getBlueWhiteMaidPetAssets(style: PetStyle): PetAssetManifest {
  return blueWhiteMaidPetAssetsByStyle[style]
}

export const legacyBlueWhiteMaidPetAssets: PetAssetManifest = {
  character: {
    idle: classicIdleCharacterUrl,
    hint: classicHintCharacterUrl,
    working: classicWorkingCharacterUrl,
    error: classicErrorCharacterUrl,
    clicked: classicClickedCharacterUrl
  },
  effects: {
    'hint-sparkles': hintSparklesUrl,
    'working-stars': workingStarsUrl,
    'error-sweat': errorSweatUrl,
    'click-hearts': clickHeartsUrl
  }
}
