import { describe, expect, it, vi } from 'vitest'
import { createAssistantPreferenceOriginId, normalizeAssistantPreferencePatchMeta } from './assistantPreferencePatchMeta'

describe('assistant preference patch metadata', () => {
  it('creates unique origins without relying on a module sequence', () => {
    const randomUUID = vi.fn()
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createAssistantPreferenceOriginId()).not.toBe(createAssistantPreferenceOriginId())
  })

  it('accepts bounded safe origins and positive safe mutation ids', () => {
    expect(normalizeAssistantPreferencePatchMeta({ originId: 'sidebar_abc-123', mutationId: 2 })).toEqual({
      originId: 'sidebar_abc-123', mutationId: 2
    })
  })

  it.each([
    undefined,
    null,
    {},
    { originId: '', mutationId: 1 },
    { originId: 'bad space', mutationId: 1 },
    { originId: 'x'.repeat(129), mutationId: 1 },
    { originId: 'sidebar', mutationId: 0 },
    { originId: 'sidebar', mutationId: 1.5 },
    { originId: 'sidebar', mutationId: Number.MAX_SAFE_INTEGER + 1 }
  ])('drops malformed metadata: %j', (value) => {
    expect(normalizeAssistantPreferencePatchMeta(value)).toBeUndefined()
  })
})
