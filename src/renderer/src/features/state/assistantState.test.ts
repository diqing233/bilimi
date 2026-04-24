import { describe, expect, it } from 'vitest'
import { createInitialAssistantState, reduceAssistantState } from './assistantState'

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
})
