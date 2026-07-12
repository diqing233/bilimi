import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PET_HOVER_SHORTCUTS,
  normalizePetHoverShortcuts,
  PET_HOVER_SHORTCUT_LIMIT,
  PET_SORTABLE_HOVER_SHORTCUTS
} from './petHoverShortcuts'

describe('pet hover shortcuts', () => {
  it('defaults to quick video actions plus transcribing', () => {
    expect(normalizePetHoverShortcuts(undefined)).toEqual(DEFAULT_PET_HOVER_SHORTCUTS)
    expect(DEFAULT_PET_HOVER_SHORTCUTS).toEqual(['like', 'coin', 'comment', 'transcribe'])
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

  it('keeps an explicit empty custom shortcut list empty', () => {
    expect(normalizePetHoverShortcuts([])).toEqual([])
  })

  it('keeps only quick video actions and transcribing as configurable choices', () => {
    expect(PET_SORTABLE_HOVER_SHORTCUTS.map((shortcut) => shortcut.id)).toEqual([
      'like',
      'favorite',
      'coin',
      'comment',
      'transcribe'
    ])
    expect(
      normalizePetHoverShortcuts([
        'prepare-ledgers',
        'organize-old-favorites',
        'library',
        'favorite'
      ])
    ).toEqual(['favorite'])
  })
})
