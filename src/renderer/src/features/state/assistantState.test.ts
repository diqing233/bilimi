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
            displayName: 'bilimi·光影留真',
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
          displayName: 'bilimi·光影留真',
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
          displayName: 'bilimi·光影留真'
        }),
        expect.objectContaining({
          id: 'movie-tv',
          displayName: 'bilimi·影视动漫'
        })
      ])
    )
  })

  it('increments persisted preference counts after a successful action', () => {
    const next = recordAssistantPreferenceFeedback(createInitialAssistantPreferences(), 'funny', LIKE_ACTION)

    expect(next.favoritesFolderName).toBe('bilimi 内库')
    expect(next.preferenceCounts.funny).toBe(1)
  })
  it('hydrates the selected pet style with a big-head default', () => {
    expect(createInitialAssistantPreferences().petStyle).toBe('big-head')
    expect(createInitialAssistantPreferences().hidePetDuringVideoFullscreen).toBe(false)
    expect(createInitialAssistantPreferences().assistantSidebarWidthPx).toBeNull()
    expect(createInitialAssistantPreferences({ petStyle: 'classic' }).petStyle).toBe('classic')
    expect(createInitialAssistantPreferences({ petStyle: 'unknown' as never }).petStyle).toBe(
      'big-head'
    )
  })

  it('normalizes the optional assistant sidebar width preference', () => {
    expect(createInitialAssistantPreferences({ assistantSidebarWidthPx: 360 })).toMatchObject({
      assistantSidebarWidthPx: 360
    })
    expect(createInitialAssistantPreferences({ assistantSidebarWidthPx: 260 })).toMatchObject({
      assistantSidebarWidthPx: 320
    })
    expect(createInitialAssistantPreferences({ assistantSidebarWidthPx: 900 })).toMatchObject({
      assistantSidebarWidthPx: 486
    })
    expect(
      createInitialAssistantPreferences({ assistantSidebarWidthPx: Number.NaN })
    ).toMatchObject({
      assistantSidebarWidthPx: null
    })
  })

  it('creates disabled DeepSeek preferences by default', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      bilibiliOperationMode: 'api-assisted',
      favoriteArchiveMultiMode: 'off',
      defaultCoinCount: 1,
      commentSubmitMode: 'random',
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: false,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: false,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com',
      videoAudioTranscriptionThreadLimit: 'unlimited'
    })
    expect(createInitialAssistantPreferences()).not.toHaveProperty(
      'deepseekOldFavoriteAssistanceEnabled'
    )
  })

  it('keeps new DeepSeek feature switches off by default while inheriting legacy enabled settings', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      deepseekEnabled: false,
      deepseekCommentEnabled: false,
      deepseekPetChatEnabled: false
    })

    expect(createInitialAssistantPreferences({ deepseekEnabled: true })).toMatchObject({
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true
    })

    expect(
      createInitialAssistantPreferences({
        deepseekEnabled: true,
        deepseekCommentEnabled: false,
        deepseekPetChatEnabled: true
      })
    ).toMatchObject({
      deepseekEnabled: true,
      deepseekCommentEnabled: false,
      deepseekPetChatEnabled: true
    })
  })

  it('hydrates explicitly cleared DeepSeek model and service address as empty strings', () => {
    expect(
      createInitialAssistantPreferences({
        deepseekModel: '',
        deepseekBaseUrl: ''
      })
    ).toMatchObject({
      deepseekModel: '',
      deepseekBaseUrl: ''
    })
  })

  it('normalizes invalid persisted DeepSeek preference values', () => {
    expect(
      createInitialAssistantPreferences({
        bilibiliOperationMode: 'unsupported' as never,
        deepseekAutoSummaryEnabled: true,
        deepseekModel: 42 as never,
        deepseekBaseUrl: 'bad-url',
        videoAudioTranscriptionThreadLimit: 8 as never
      } as Partial<ReturnType<typeof createInitialAssistantPreferences>>)
    ).toMatchObject({
      bilibiliOperationMode: 'api-assisted',
      deepseekAutoSummaryEnabled: true,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com',
      videoAudioTranscriptionThreadLimit: 'unlimited'
    })
  })

  it('normalizes the local audio transcription thread limit preference', () => {
    expect(createInitialAssistantPreferences().videoAudioTranscriptionThreadLimit).toBe('unlimited')
    expect(
      createInitialAssistantPreferences({ videoAudioTranscriptionThreadLimit: 1 })
    ).toMatchObject({
      videoAudioTranscriptionThreadLimit: 1
    })
    expect(
      createInitialAssistantPreferences({ videoAudioTranscriptionThreadLimit: 2 })
    ).toMatchObject({
      videoAudioTranscriptionThreadLimit: 2
    })
    expect(
      createInitialAssistantPreferences({ videoAudioTranscriptionThreadLimit: 4 })
    ).toMatchObject({
      videoAudioTranscriptionThreadLimit: 4
    })
    expect(
      createInitialAssistantPreferences({ videoAudioTranscriptionThreadLimit: 3 as never })
    ).toMatchObject({
      videoAudioTranscriptionThreadLimit: 'unlimited'
    })
  })

  it('normalizes persisted action behavior preferences', () => {
    expect(
      createInitialAssistantPreferences({
        defaultCoinCount: 2,
        commentSubmitMode: 'random'
      })
    ).toMatchObject({
      defaultCoinCount: 2,
      commentSubmitMode: 'random'
    })
    expect(
      createInitialAssistantPreferences({
        defaultCoinCount: 3 as never,
        commentSubmitMode: 'surprise' as never
      })
    ).toMatchObject({
      defaultCoinCount: 1,
      commentSubmitMode: 'choose'
    })
    expect(createInitialAssistantPreferences({ commentSubmitMode: 'manual' as never })).toMatchObject({
      commentSubmitMode: 'choose'
    })
    expect(createInitialAssistantPreferences({ commentSubmitMode: 'auto' as never })).toMatchObject({
      commentSubmitMode: 'choose'
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

  it('hydrates correction learning preferences and defaults', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      favoriteArchiveStrategy: 'aggressive',
      favoriteCorrectionLearningEnabled: true,
      favoriteCorrectionLearningClassificationEnabled: true,
      favoriteCorrectionRecords: [],
      favoriteKeywordSuggestions: []
    })

    expect(
      createInitialAssistantPreferences({
        favoriteArchiveStrategy: 'balanced',
        favoriteCorrectionLearningEnabled: false,
        favoriteCorrectionLearningClassificationEnabled: false,
        favoriteCorrectionRecords: [
          {
            id: 'record-1',
            aid: 1,
            title: '东京旅行攻略',
            originalLedgerId: 'game',
            userLedgerIds: ['life-interest'],
            source: 'user',
            feedbackType: 'strong-correction',
            sourceScene: 'archive-preview',
            tags: ['旅行'],
            matchedKeywords: [],
            createdAt: '2026-07-05T00:00:00.000Z',
            confirmedAt: '2026-07-05T00:01:00.000Z'
          }
        ],
        favoriteKeywordSuggestions: [
          {
            id: 'suggestion-1',
            action: 'add-keyword',
            ledgerId: 'life-interest',
            keyword: '旅行',
            reason: '用户纠正',
            source: 'user',
            status: 'pending',
            createdAt: '2026-07-05T00:00:00.000Z'
          }
        ]
      })
    ).toMatchObject({
      favoriteArchiveStrategy: 'balanced',
      favoriteCorrectionLearningEnabled: false,
      favoriteCorrectionLearningClassificationEnabled: false,
      favoriteCorrectionRecords: [
        expect.objectContaining({
          id: 'record-1',
          userLedgerIds: ['life-interest']
        })
      ],
      favoriteKeywordSuggestions: [
        expect.objectContaining({
          id: 'suggestion-1',
          action: 'add-keyword'
        })
      ]
    })

    expect(
      createInitialAssistantPreferences({
        favoriteArchiveStrategy: 'reckless' as never,
        favoriteCorrectionRecords: [
          null,
          {
            id: 'trim-record',
            aid: 1,
            title: 'trim',
            userLedgerIds: [123, ' ', 'game'],
            source: 'user',
            feedbackType: 'strong-correction',
            sourceScene: 'archive-preview',
            tags: [],
            matchedKeywords: [],
            createdAt: '2026-07-05T00:00:00.000Z',
            confirmedAt: '2026-07-05T00:00:00.000Z'
          }
        ] as never,
        favoriteKeywordSuggestions: [null, 'bad'] as never
      })
    ).toMatchObject({
      favoriteArchiveStrategy: 'aggressive',
      favoriteCorrectionRecords: [
        expect.objectContaining({
          userLedgerIds: ['game']
        })
      ],
      favoriteKeywordSuggestions: []
    })
  })
})
