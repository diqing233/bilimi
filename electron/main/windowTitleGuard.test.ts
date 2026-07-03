import { describe, expect, it, vi } from 'vitest'
import { APP_TITLE } from '../../src/shared/constants'
import { keepMainWindowTitle } from './windowTitleGuard'

function createTitleGuardTarget(initialTitle = 'Bilimi') {
  const listeners = new Map<string, () => void>()
  let title = initialTitle

  return {
    target: {
      on: vi.fn((event: string, callback: () => void) => {
        listeners.set(event, callback)
      }),
      setTitle: vi.fn((nextTitle: string) => {
        title = nextTitle
      }),
      getTitle: () => title,
      emit: (event: string, nextTitle: string) => {
        title = nextTitle
        listeners.get(event)?.()
      }
    },
    listeners
  }
}

describe('keepMainWindowTitle', () => {
  it('restores the product title when the renderer page title changes', () => {
    const { target } = createTitleGuardTarget()

    keepMainWindowTitle(target)
    target.emit('page-title-updated', 'Bilimi 札记')

    expect(target.setTitle).toHaveBeenCalledWith(APP_TITLE)
    expect(target.getTitle()).toBe(APP_TITLE)
  })
})
