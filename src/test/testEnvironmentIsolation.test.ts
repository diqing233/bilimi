import { describe, expect, it, vi } from 'vitest'

describe('shared test environment isolation', () => {
  it('can mutate browser state as a test fixture', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      value: 'DedeUserID=100'
    })
    document.documentElement.style.overflow = 'hidden'
    const leakedButton = document.createElement('button')
    leakedButton.dataset.testLeak = 'true'
    document.body.append(leakedButton)
    vi.stubGlobal('__bilimiTestLeak', true)
    vi.useFakeTimers()
  })

  it('receives a clean browser state after the prior test fixture', () => {
    expect(Object.hasOwn(document, 'cookie')).toBe(false)
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.body.querySelector('[data-test-leak]')).toBeNull()
    expect('__bilimiTestLeak' in globalThis).toBe(false)
    expect(() => {
      document.cookie = 'DedeUserID=101'
    }).not.toThrow()
  })
})
