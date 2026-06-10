import { describe, expect, it } from 'vitest'
import { WORKSPACE_SMOKE_VALUE } from './workspaceSmoke'

describe('workspace smoke test', () => {
  it('runs TypeScript tests in the Bilimi notes workspace', () => {
    expect(WORKSPACE_SMOKE_VALUE).toBe('bilimi-notes-ready')
  })
})
