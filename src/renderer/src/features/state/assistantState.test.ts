import { describe, expect, it } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import {
  createInitialAssistantPreferences,
  createInitialAssistantState,
  reduceAssistantState,
  recordAssistantPreferenceFeedback
} from './assistantState'
import type { AssistantAction } from '@shared/types'

const LIKE_ACTION = '赞' as AssistantAction

describe('assistant state', () => {
  it('records funny likes into local preferences', () => {
    const next = reduceAssistantState(createInitialAssistantState(), {
      type: 'record-feedback',
      kind: 'funny',
      action: LIKE_ACTION
    })

    expect(next.preferenceCounts.funny).toBe(1)
    expect(next.lastAction).toBe(LIKE_ACTION)
  })

  it('hydrates missing persisted preference categories with zero defaults', () => {
    expect(
      createInitialAssistantPreferences({
        favoritesFolderName: 'Bilimi 私库',
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
        preferenceCounts: {
          humor: 3
        },
        ledgerPromptDismissed: true
      })
    ).toMatchObject({
      favoritesFolderName: 'Bilimi 私库',
      ledgerPromptDismissed: true,
      preferenceCounts: {
        humor: 3
      }
    })

    expect(
      createInitialAssistantPreferences({
        favoriteLedgers: [],
        preferenceCounts: {}
      }).favoriteLedgers.map((ledger) => ledger.id)
    ).toEqual(createDefaultFavoriteLedgers().map((ledger) => ledger.id))
  })

  it('removes retired Bilimi default ledgers from persisted preferences', () => {
    const retiredLedgerNames = [
      'Bilimi·见闻增广',
      'Bilimi·茶余解颐',
      'Bilimi·影剧情长',
      'Bilimi·游艺演武',
      'Bilimi·市井烟火',
      'Bilimi·工巧器用',
      'Bilimi·歌舞清音',
      'Bilimi·暂存待阅'
    ]
    const preferences = createInitialAssistantPreferences({
      favoriteLedgers: [
        ...retiredLedgerNames.map((displayName, index) => ({
          id: `retired-${index}`,
          displayName,
          keywords: [displayName.replace('Bilimi·', '')],
          enabled: true,
          priority: (index + 1) * 10,
          isDefault: true
        })),
        {
          id: 'custom-photo',
          displayName: 'Bilimi·光影留真',
          keywords: ['摄影'],
          enabled: true,
          priority: 50,
          isDefault: false
        }
      ]
    })

    expect(preferences.favoriteLedgers.map((ledger) => ledger.displayName)).not.toEqual(
      expect.arrayContaining(retiredLedgerNames)
    )
    expect(preferences.favoriteLedgers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-photo',
          displayName: 'Bilimi·光影留真'
        }),
        expect.objectContaining({
          id: 'movie-tv',
          displayName: 'Bilimi·影视动漫'
        })
      ])
    )
  })

  it('increments persisted preference counts after a successful action', () => {
    const next = recordAssistantPreferenceFeedback(createInitialAssistantPreferences(), 'funny', LIKE_ACTION)

    expect(next.favoritesFolderName).toBe('Bilimi 内库')
    expect(next.preferenceCounts.funny).toBe(1)
  })
  it('hydrates the selected pet style with a big-head default', () => {
    expect(createInitialAssistantPreferences().petStyle).toBe('big-head')
    expect(createInitialAssistantPreferences().hidePetDuringVideoFullscreen).toBe(false)
    expect(createInitialAssistantPreferences({ petStyle: 'classic' }).petStyle).toBe('classic')
    expect(createInitialAssistantPreferences({ petStyle: 'unknown' as never }).petStyle).toBe(
      'big-head'
    )
  })

  it('creates disabled DeepSeek preferences by default', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      bilibiliOperationMode: 'api-assisted',
      favoriteArchiveMultiMode: 'off',
      defaultCoinCount: 1,
      commentSubmitMode: 'manual',
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekAutoSummaryEnabled: false,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com'
    })
    expect(createInitialAssistantPreferences()).not.toHaveProperty(
      'deepseekOldFavoriteAssistanceEnabled'
    )
  })

  it('normalizes invalid persisted DeepSeek preference values', () => {
    expect(
      createInitialAssistantPreferences({
        bilibiliOperationMode: 'unsupported' as never,
        deepseekAutoSummaryEnabled: true,
        deepseekModel: '',
        deepseekBaseUrl: 'bad-url'
      } as Partial<ReturnType<typeof createInitialAssistantPreferences>>)
    ).toMatchObject({
      bilibiliOperationMode: 'api-assisted',
      deepseekAutoSummaryEnabled: true,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com'
    })
  })

  it('normalizes persisted action behavior preferences', () => {
    expect(
      createInitialAssistantPreferences({
        defaultCoinCount: 2,
        commentSubmitMode: 'auto'
      })
    ).toMatchObject({
      defaultCoinCount: 2,
      commentSubmitMode: 'auto'
    })
    expect(
      createInitialAssistantPreferences({
        defaultCoinCount: 3 as never,
        commentSubmitMode: 'surprise' as never
      })
    ).toMatchObject({
      defaultCoinCount: 1,
      commentSubmitMode: 'manual'
    })
  })

  it('hydrates the video fullscreen pet visibility preference', () => {
    expect(
      createInitialAssistantPreferences({
        hidePetDuringVideoFullscreen: true
      }).hidePetDuringVideoFullscreen
    ).toBe(true)
  })

  it('hydrates the Bilibili operation mode when it is persisted', () => {
    expect(
      createInitialAssistantPreferences({
        bilibiliOperationMode: 'page-visual'
      })
    ).toMatchObject({
      bilibiliOperationMode: 'page-visual'
    })
  })

  it('normalizes the favorite archive multi mode preference', () => {
    expect(createInitialAssistantPreferences({ favoriteArchiveMultiMode: 'two' })).toMatchObject({
      favoriteArchiveMultiMode: 'two'
    })
    expect(createInitialAssistantPreferences({ favoriteArchiveMultiMode: 'three' })).toMatchObject({
      favoriteArchiveMultiMode: 'three'
    })
    expect(
      createInitialAssistantPreferences({ favoriteArchiveMultiMode: 'many' as never })
    ).toMatchObject({
      favoriteArchiveMultiMode: 'off'
    })
  })
})
