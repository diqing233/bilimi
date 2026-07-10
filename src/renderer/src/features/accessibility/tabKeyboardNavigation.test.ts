import { describe, expect, it } from 'vitest'
import { nextTabIndex } from './tabKeyboardNavigation'

describe('tab keyboard navigation', () => {
  it('wraps arrows and supports Home and End', () => {
    expect(nextTabIndex('ArrowRight', 3, 4)).toBe(0)
    expect(nextTabIndex('ArrowLeft', 0, 4)).toBe(3)
    expect(nextTabIndex('Home', 2, 4)).toBe(0)
    expect(nextTabIndex('End', 1, 4)).toBe(3)
    expect(nextTabIndex('Enter', 1, 4)).toBeNull()
  })
})
