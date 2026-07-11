import { describe, expect, it } from 'vitest'
import type { AssistantPreferences, DeepSeekGenerateRequest } from '../../src/shared/types'
import { assertDeepSeekRequestEnabled, canRunDeepSeekRequest } from './deepseekFeatureAccess'

function preferences(overrides: Partial<AssistantPreferences> = {}): AssistantPreferences {
  return {
    deepseekCommentEnabled: true,
    deepseekAutoSummaryEnabled: true,
    deepseekPetChatEnabled: true,
    deepseekDailyClassificationEnabled: true,
    deepseekArchiveOrganizationEnabled: true,
    ...overrides
  } as AssistantPreferences
}

const requestKinds: Array<{
  kind: DeepSeekGenerateRequest['kind']
  disabled: Partial<AssistantPreferences>
}> = [
  { kind: 'review-comment', disabled: { deepseekCommentEnabled: false } },
  { kind: 'note-poster', disabled: { deepseekAutoSummaryEnabled: false } },
  { kind: 'pet-chat', disabled: { deepseekPetChatEnabled: false } },
  {
    kind: 'favorite-daily-classify-review',
    disabled: { deepseekDailyClassificationEnabled: false }
  },
  {
    kind: 'favorite-archive-organize',
    disabled: { deepseekArchiveOrganizationEnabled: false }
  }
]

describe('DeepSeek feature access', () => {
  it.each(requestKinds)('blocks $kind when its child feature is disabled', ({ kind, disabled }) => {
    expect(canRunDeepSeekRequest(preferences(disabled), kind)).toBe(false)
  })

  it.each(requestKinds)('allows $kind when its child feature is enabled', ({ kind }) => {
    expect(canRunDeepSeekRequest(preferences(), kind)).toBe(true)
  })

  it('throws before disabled features can reach the DeepSeek service', () => {
    expect(() =>
      assertDeepSeekRequestEnabled(
        preferences({ deepseekAutoSummaryEnabled: false }),
        'note-poster'
      )
    ).toThrow('This DeepSeek feature is disabled.')
  })
})
