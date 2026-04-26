import { describe, expect, it } from 'vitest'
import {
  createInitialAssistantPreferences,
  createInitialAssistantState,
  reduceAssistantState,
  recordAssistantPreferenceFeedback
} from './assistantState'

describe('assistant state', () => {
  it('records funny likes into local preferences', () => {
    const next = reduceAssistantState(createInitialAssistantState(), {
      type: 'record-feedback',
      kind: 'funny',
      action: '赏'
    })

    expect(next.preferenceCounts.funny).toBe(1)
    expect(next.lastAction).toBe('赏')
  })

  it('hydrates missing persisted preference categories with zero defaults', () => {
    expect(
      createInitialAssistantPreferences({
        favoritesFolderName: 'Bilimi 私库',
        preferenceCounts: {
          funny: 3
        }
      })
    ).toEqual({
      favoritesFolderName: 'Bilimi 私库',
      preferenceCounts: {
        funny: 3,
        knowledge: 0,
        story: 0,
        suspicious: 0
      }
    })
  })

  it('increments persisted preference counts after a successful action', () => {
    const next = recordAssistantPreferenceFeedback(
      createInitialAssistantPreferences(),
      'funny',
      '赏'
    )

    expect(next.favoritesFolderName).toBe('Bilimi 内库')
    expect(next.preferenceCounts.funny).toBe(1)
  })
})
