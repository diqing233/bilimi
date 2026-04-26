import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_PREFERENCES,
  loadAssistantPreferences,
  saveAssistantPreferences,
  type AssistantPreferences,
  type AssistantStoreLike
} from './store'

function createFakeStore(
  initial: Partial<AssistantPreferences> = {}
): AssistantStoreLike & { snapshot: AssistantPreferences } {
  const snapshot: AssistantPreferences = {
    favoritesFolderName: initial.favoritesFolderName ?? DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName,
    preferenceCounts: initial.preferenceCounts ?? { ...DEFAULT_ASSISTANT_PREFERENCES.preferenceCounts }
  }

  return {
    snapshot,
    get(key) {
      return snapshot[key]
    },
    set(key, value) {
      Object.assign(snapshot, { [key]: value })
    }
  }
}

describe('assistant preference store helpers', () => {
  it('loads favorites folder name and preference counts together', () => {
    const store = createFakeStore({
      favoritesFolderName: 'Bilimi Favorites',
      preferenceCounts: {
        funny: 2,
        knowledge: 1
      }
    })

    expect(loadAssistantPreferences(store)).toEqual({
      favoritesFolderName: 'Bilimi Favorites',
      preferenceCounts: {
        funny: 2,
        knowledge: 1
      }
    })
  })

  it('saves favorites folder name and preference counts and returns the persisted shape', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      favoritesFolderName: 'Archive',
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })

    expect(saved).toEqual({
      favoritesFolderName: 'Archive',
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })
    expect(store.snapshot).toEqual(saved)
  })
})
