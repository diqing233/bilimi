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
    favoriteLedgers: initial.favoriteLedgers ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers,
    ledgerPromptDismissed:
      initial.ledgerPromptDismissed ?? DEFAULT_ASSISTANT_PREFERENCES.ledgerPromptDismissed,
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

    expect(loadAssistantPreferences(store)).toMatchObject({
      favoritesFolderName: 'Bilimi Favorites',
      ledgerPromptDismissed: false,
      preferenceCounts: {
        funny: 2,
        knowledge: 1
      }
    })
  })

  it('loads favorite ledgers and first-open prompt state with preferences', () => {
    const store = createFakeStore({
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
      ledgerPromptDismissed: true
    })

    expect(loadAssistantPreferences(store)).toMatchObject({
      ledgerPromptDismissed: true,
      favoriteLedgers: expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-photo',
          displayName: 'Bilimi·光影留真'
        })
      ])
    })
  })

  it('saves favorites folder name and preference counts and returns the persisted shape', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      favoritesFolderName: 'Archive',
      favoriteLedgers: DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers,
      ledgerPromptDismissed: false,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })

    expect(saved).toMatchObject({
      favoritesFolderName: 'Archive',
      ledgerPromptDismissed: false,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })
    expect(store.snapshot).toEqual(saved)
  })
})
