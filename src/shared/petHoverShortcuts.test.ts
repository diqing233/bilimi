import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PET_HOVER_SHORTCUTS,
  normalizePetHoverShortcuts,
  PET_HOVER_SHORTCUT_LIMIT
} from './petHoverShortcuts'

describe('pet hover shortcuts', () => {
  it('defaults to the four immediate video actions', () => {
    expect(normalizePetHoverShortcuts(undefined)).toEqual(DEFAULT_PET_HOVER_SHORTCUTS)
    expect(DEFAULT_PET_HOVER_SHORTCUTS).toHaveLength(PET_HOVER_SHORTCUT_LIMIT)
  })

  it('keeps valid custom shortcuts unique and capped at four', () => {
    expect(
      normalizePetHoverShortcuts([
        'favorite',
        'like',
        'favorite',
        'coin',
        'comment',
        'archive',
        'unknown'
      ])
    ).toEqual(['favorite', 'like', 'coin', 'comment'])
  })
})
