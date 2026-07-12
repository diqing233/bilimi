import { describe, expect, it } from 'vitest'
import { FLOATING_ASSISTANT_SIZE } from './floatingAssistantWindowSize'

describe('floating assistant window size', () => {
  it('matches the 420px floating workspace without leaving a blank strip', () => {
    expect(FLOATING_ASSISTANT_SIZE).toEqual({ width: 420, height: 680 })
  })
})
