import { describe, expect, it } from 'vitest'
import {
  createInitialAssistantPreferences,
  createInitialAssistantState,
  reduceAssistantState,
  recordAssistantPreferenceFeedback
} from './assistantState'
import type { AssistantAction } from '@shared/types'

const LIKE_ACTION = '赞' as AssistantAction

describe('assistant state', () => {
  it('records funny likes into local preferences', () => {
    const next = reduceAssistantState(createInitialAssistantState(), {
      type: 'record-feedback',
      kind: 'funny',
      action: LIKE_ACTION
    })

    expect(next.preferenceCounts.funny).toBe(1)
    expect(next.lastAction).toBe(LIKE_ACTION)
  })

  it('hydrates missing persisted preference categories with zero defaults', () => {
    expect(
      createInitialAssistantPreferences({
        favoritesFolderName: 'Bilimi 私库',
        favoriteLedgers: [
          {
            id: 'custom-photo',
            displayName: 'Bilimi·光影留真',
            keywords: ['摄影'],
            enabled: true,
            priority: 50,
            isDefault: false
          }
        ],
        preferenceCounts: {
          humor: 3
        },
        ledgerPromptDismissed: true
      })
    ).toMatchObject({
      favoritesFolderName: 'Bilimi 私库',
      ledgerPromptDismissed: true,
      preferenceCounts: {
        humor: 3
      }
    })

    expect(
      createInitialAssistantPreferences({
        favoriteLedgers: [],
        preferenceCounts: {}
      }).favoriteLedgers.map((ledger) => ledger.id)
    ).toEqual(['knowledge', 'humor', 'story', 'play', 'life', 'craft', 'music', 'inbox'])
  })

  it('increments persisted preference counts after a successful action', () => {
    const next = recordAssistantPreferenceFeedback(createInitialAssistantPreferences(), 'funny', LIKE_ACTION)

    expect(next.favoritesFolderName).toBe('Bilimi 内库')
    expect(next.preferenceCounts.funny).toBe(1)
  })
  it('hydrates the selected pet style with a big-head default', () => {
    expect(createInitialAssistantPreferences().petStyle).toBe('big-head')
    expect(createInitialAssistantPreferences({ petStyle: 'classic' }).petStyle).toBe('classic')
    expect(createInitialAssistantPreferences({ petStyle: 'unknown' as never }).petStyle).toBe(
      'big-head'
    )
  })

  it('creates disabled DeepSeek preferences by default', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com'
    })
  })

  it('normalizes invalid persisted DeepSeek preference values', () => {
    expect(
      createInitialAssistantPreferences({
        deepseekModel: '',
        deepseekBaseUrl: 'bad-url'
      } as Partial<ReturnType<typeof createInitialAssistantPreferences>>)
    ).toMatchObject({
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com'
    })
  })
})
