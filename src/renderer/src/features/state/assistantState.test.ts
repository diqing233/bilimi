import { describe, expect, it } from 'vitest'
import { createDefaultFavoriteLedgers } from '@shared/favoriteLedgers'
import {
  createInitialAssistantPreferences,
  createInitialAssistantState,
  effectiveFavoriteLedgersForAccount,
  favoriteLedgersForAccount,
  applyImmediatePreferencePatch,
  applyFavoriteLedgerEnabledPatch,
  withFavoriteLedgersForAccount,
  reduceAssistantState,
  recordAssistantPreferenceFeedback
} from './assistantState'
import type { AssistantAction } from '@shared/types'
import { classifyVideoContent } from '../recommendation/videoClassifier'

const LIKE_ACTION = '赞' as AssistantAction

describe('assistant state', () => {
  it('normalizes the per-account favorite discovery notice dismissal flag', () => {
    const legacy = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: []
        }
      }
    })
    expect(legacy.favoriteAccountPreferences?.['100']?.favoriteDiscoveryNoticeDismissed ?? false).toBe(false)

    const dismissed = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [],
          favoriteDiscoveryNoticeDismissed: true
        },
        '200': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [],
          favoriteDiscoveryNoticeDismissed: 'true' as never
        }
      }
    })
    expect(dismissed.favoriteAccountPreferences?.['100']?.favoriteDiscoveryNoticeDismissed).toBe(true)
    expect(dismissed.favoriteAccountPreferences?.['200']?.favoriteDiscoveryNoticeDismissed ?? false).toBe(false)
  })

  it('migrates a legacy recommendation deletion record to an ordinary saved rule during preference normalization', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [],
          deletedFavoriteLedgerRecords: [{
            logicalLedgerId: 'deleted-recommendation',
            deletedAt: '2026-09-05T00:00:00.000Z',
            ledger: {
              id: 'deleted-recommendation',
              displayName: 'bilimi·已删除推荐',
              keywords: ['已删除推荐'],
              enabled: true,
              priority: 10,
              ruleOrigin: 'recommendation-draft',
              bindingState: 'unbacked',
              bilibiliFolderId: '77',
              isDefault: false
            }
          }]
        }
      }
    })

    expect(preferences.favoriteAccountPreferences?.['100']?.deletedFavoriteLedgerRecords).toEqual([
      expect.objectContaining({
        logicalLedgerId: 'deleted-recommendation',
        ledger: expect.objectContaining({
          ruleOrigin: 'saved-rule',
          bilibiliFolderId: '77'
        })
      })
    ])
  })

  it('applies one account ledger enabled patch without rebuilding unrelated accounts or ledgers', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [
            { id: 'first', displayName: 'bilimi·first', enabled: false, keywords: [], ruleType: 'keyword', priority: 10, isDefault: false },
            { id: 'second', displayName: 'bilimi·second', enabled: true, keywords: [], ruleType: 'keyword', priority: 20, isDefault: false }
          ],
          transcriptionModelId: 'whisper-small'
        },
        '200': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [],
          transcriptionModelId: 'whisper-small'
        }
      }
    })
    const otherAccount = preferences.favoriteAccountPreferences?.['200']
    const untouchedLedger = preferences.favoriteAccountPreferences?.['100']?.favoriteLedgers[1]

    const next = applyFavoriteLedgerEnabledPatch(preferences, { accountMid: '100', ledgerId: 'first', enabled: true })

    expect(next.favoriteAccountPreferences?.['100']?.favoriteLedgers[0]?.enabled).toBe(true)
    expect(next.favoriteAccountPreferences?.['100']?.favoriteLedgers[1]).toBe(untouchedLedger)
    expect(next.favoriteAccountPreferences?.['200']).toBe(otherAccount)
  })

  it('defaults automatic pet startup to enabled and preserves an explicit opt-out', () => {
    expect((createInitialAssistantPreferences() as unknown as Record<string, unknown>).autoShowPetOnStartup).toBe(true)
    expect((createInitialAssistantPreferences({ autoShowPetOnStartup: false } as never) as unknown as Record<string, unknown>).autoShowPetOnStartup).toBe(false)
  })
  it('applies an interactive setting patch without cloning unrelated heavy preferences', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteCorrectionRecords: [{
        id: 'record-1', aid: 1, title: 'Heavy preference record', originalLedgerId: 'inbox', userLedgerIds: ['game'],
        source: 'user', feedbackType: 'strong-correction', sourceScene: 'archive-preview', tags: [], matchedKeywords: [],
        createdAt: '2026-07-29T00:00:00.000Z', confirmedAt: '2026-07-29T00:00:00.000Z'
      }]
    })
    const records = preferences.favoriteCorrectionRecords
    const accounts = preferences.favoriteAccountPreferences

    const next = applyImmediatePreferencePatch(preferences, { hidePetDuringVideoFullscreen: true })

    expect(next.hidePetDuringVideoFullscreen).toBe(true)
    expect(next.favoriteCorrectionRecords).toBe(records)
    expect(next.favoriteAccountPreferences).toBe(accounts)
  })
  it('reuses the current preference object when an acknowledged patch changes nothing', () => {
    const preferences = createInitialAssistantPreferences({ deepseekEnabled: true })

    expect(applyImmediatePreferencePatch(preferences, { deepseekEnabled: true })).toBe(preferences)
  })
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

  it('migrates a missing device-wide Bilibili connection choice to auto', () => {
    expect(createInitialAssistantPreferences({}).bilibiliConnectionMode).toBe('auto')
    expect(createInitialAssistantPreferences({ bilibiliConnectionMode: 'direct' }).bilibiliConnectionMode).toBe('direct')
    expect(createInitialAssistantPreferences({ bilibiliConnectionMode: 'system' as never }).bilibiliConnectionMode).toBe('auto')
    expect(createInitialAssistantPreferences({ bilibiliConnectionMode: 'invalid' as never }).bilibiliConnectionMode).toBe('auto')
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

  it('creates DeepSeek child features enabled by default while keeping the master switch off', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      bilibiliOperationMode: 'api-assisted',
      favoriteArchiveMultiMode: 'off',
      defaultCoinCount: 2,
      commentSubmitMode: 'choose',
      deepseekEnabled: false,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: true,
      deepseekFeatureDefaultsInitialized: false,
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.deepseek.com',
      closeBehavior: 'minimize-to-tray',
      confirmBeforeExit: true,
      videoAudioTranscriptionThreadLimit: 'unlimited'
    })
    expect(createInitialAssistantPreferences()).not.toHaveProperty(
      'deepseekOldFavoriteAssistanceEnabled'
    )
  })

  it('keeps favorite ledgers scoped to the active account when replacing them', () => {
    const firstAccountLedgers = [{
      id: 'first', displayName: 'bilimi·第一账号', keywords: [], enabled: true, priority: 10, isDefault: false
    }]
    const secondAccountLedgers = [{
      id: 'second', displayName: 'bilimi·第二账号', keywords: [], enabled: true, priority: 10, isDefault: false
    }]
    const preferences = createInitialAssistantPreferences({
      favoriteLedgers: createDefaultFavoriteLedgers(),
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: false, favoriteLedgers: firstAccountLedgers },
        '200': { defaultFavoriteSystemEnabled: true, favoriteLedgers: secondAccountLedgers }
      }
    })

    expect(favoriteLedgersForAccount(preferences, '100')).toEqual(expect.arrayContaining(firstAccountLedgers))
    expect(favoriteLedgersForAccount(preferences, '100')).not.toEqual(expect.arrayContaining(secondAccountLedgers))
    expect(withFavoriteLedgersForAccount(preferences, '100', secondAccountLedgers)).toMatchObject({
      favoriteLedgers: createDefaultFavoriteLedgers(),
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: false, favoriteLedgers: expect.arrayContaining(secondAccountLedgers) },
        '200': { defaultFavoriteSystemEnabled: true, favoriteLedgers: expect.arrayContaining(secondAccountLedgers) }
      }
    })
  })

  it('preserves each account transcription model when normalizing and replacing ledgers', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': { defaultFavoriteSystemEnabled: true, favoriteLedgers: [], transcriptionModelId: 'faster-whisper-large-v3-turbo' }
      }
    })

    expect(preferences.favoriteAccountPreferences?.['100']?.transcriptionModelId).toBe('faster-whisper-large-v3-turbo')
    expect(withFavoriteLedgersForAccount(preferences, '100', [])
      .favoriteAccountPreferences?.['100']?.transcriptionModelId).toBe('faster-whisper-large-v3-turbo')
  })

  it('removes ordinary defaults from an account effective target set while retaining staging and custom targets', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: false,
          favoriteLedgers: [
            { id: 'knowledge', displayName: 'bilimi·知识', keywords: ['科技'], enabled: true, priority: 10, isDefault: true },
            { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
            { id: 'custom', displayName: '自建', keywords: ['科技'], enabled: true, priority: 30, isDefault: false }
          ]
        }
      }
    })

    expect(effectiveFavoriteLedgersForAccount(preferences, '100')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', enabled: false, isDefault: false }),
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom', enabled: true })
    ]))
    expect(classifyVideoContent({ title: '科技视频' }, effectiveFavoriteLedgersForAccount(preferences, '100')))
      .toMatchObject({ ledgerId: 'custom' })
  })

  it('projects default folders as automatic review targets while the default system is enabled', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => ({
            ...ledger,
            enabled: false
          }))
        }
      }
    })

    expect(effectiveFavoriteLedgersForAccount(preferences, '100')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'knowledge', enabled: true }),
        expect.objectContaining({ id: 'game', enabled: true }),
        expect.objectContaining({ id: 'inbox', enabled: true })
      ])
    )
  })

  it('keeps a default folder selected after its Bilibili backup was deleted', () => {
    const preferences = createInitialAssistantPreferences({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: createDefaultFavoriteLedgers().map((ledger) => ledger.id === 'music'
            ? { ...ledger, enabled: false, managedFolderDeletedByUser: true }
            : { ...ledger, enabled: false })
        }
      }
    })

    const effective = effectiveFavoriteLedgersForAccount(preferences, '100')

    expect(effective.find((ledger) => ledger.id === 'music')).toMatchObject({
      enabled: true,
      managedFolderDeletedByUser: true
    })
    expect(effective.find((ledger) => ledger.id === 'knowledge')).toMatchObject({ enabled: true })
  })

  it('preserves persisted coin and comment choices', () => {
    expect(
      createInitialAssistantPreferences({
        defaultCoinCount: 1,
        commentSubmitMode: 'random'
      })
    ).toMatchObject({
      defaultCoinCount: 1,
      commentSubmitMode: 'random'
    })
  })

  it('preserves explicit DeepSeek child switches and migrates legacy settings to enabled', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      deepseekEnabled: false,
      deepseekCommentEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekArchiveOrganizationEnabled: true
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
        deepseekPetChatEnabled: true,
        deepseekDailyClassificationEnabled: false,
        deepseekArchiveOrganizationEnabled: false
      })
    ).toMatchObject({
      deepseekEnabled: true,
      deepseekCommentEnabled: false,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: false,
      deepseekArchiveOrganizationEnabled: false
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

  it('normalizes main window close behavior preferences', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({
      closeBehavior: 'minimize-to-tray',
      confirmBeforeExit: true
    })
    expect(
      createInitialAssistantPreferences({
        closeBehavior: 'exit-launcher',
        confirmBeforeExit: false
      })
    ).toMatchObject({
      closeBehavior: 'exit-launcher',
      confirmBeforeExit: false
    })
    expect(
      createInitialAssistantPreferences({
        closeBehavior: 'close-app' as never,
        confirmBeforeExit: undefined
      })
    ).toMatchObject({
      closeBehavior: 'minimize-to-tray',
      confirmBeforeExit: true
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
      defaultCoinCount: 2,
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
      favoriteAdjustmentRecordsVersion: 1,
      favoriteArchiveProtectionRecords: [],
      favoriteKeywordSuggestions: []
    })

    expect(
      createInitialAssistantPreferences({
        favoriteArchiveStrategy: 'balanced',
        favoriteCorrectionLearningEnabled: false,
        favoriteCorrectionLearningClassificationEnabled: false,
        favoriteAdjustmentRecordsVersion: 1,
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
        favoriteAdjustmentRecordsVersion: 1,
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

  it('normalizes the next-round old-favorite segment limit to 500 through 5000 or the experimental unlimited value', () => {
    expect(createInitialAssistantPreferences()).toMatchObject({ oldFavoriteWorkspaceSegmentSize: 2_000 })
    expect(createInitialAssistantPreferences({ oldFavoriteWorkspaceSegmentSize: 500 } as never))
      .toMatchObject({ oldFavoriteWorkspaceSegmentSize: 500 })
    expect(createInitialAssistantPreferences({ oldFavoriteWorkspaceSegmentSize: 5_000 } as never))
      .toMatchObject({ oldFavoriteWorkspaceSegmentSize: 5_000 })
    expect(createInitialAssistantPreferences({ oldFavoriteWorkspaceSegmentSize: Number.MAX_SAFE_INTEGER } as never))
      .toMatchObject({ oldFavoriteWorkspaceSegmentSize: Number.MAX_SAFE_INTEGER })
    expect(createInitialAssistantPreferences({ oldFavoriteWorkspaceSegmentSize: 499 } as never))
      .toMatchObject({ oldFavoriteWorkspaceSegmentSize: 2_000 })
    expect(createInitialAssistantPreferences({ oldFavoriteWorkspaceSegmentSize: 5_001 } as never))
      .toMatchObject({ oldFavoriteWorkspaceSegmentSize: 2_000 })
  })

  it('clears legacy correction records once before the adjustment-record schema is enabled', () => {
    const legacyRecord = {
      id: 'legacy-record',
      aid: 1,
      title: '旧记录',
      userLedgerIds: ['game'],
      source: 'user',
      feedbackType: 'strong-correction',
      sourceScene: 'archive-preview',
      tags: [],
      matchedKeywords: [],
      createdAt: '2026-07-05T00:00:00.000Z'
    } as const

    expect(
      createInitialAssistantPreferences({ favoriteCorrectionRecords: [legacyRecord] } as never)
    ).toMatchObject({
      favoriteAdjustmentRecordsVersion: 1,
      favoriteCorrectionRecords: []
    })

    expect(
      createInitialAssistantPreferences({
        favoriteAdjustmentRecordsVersion: 1,
        favoriteCorrectionRecords: [legacyRecord]
      } as never).favoriteCorrectionRecords
    ).toHaveLength(1)
  })

  it('normalizes favorite archive protection records from persisted preferences', () => {
    expect(
      createInitialAssistantPreferences({
        favoriteArchiveProtectionRecords: [
          {
            accountMid: '42',
            aid: 7,
            targetLedgerIds: ['game', 'game'],
            targetFolderIds: ['9001', '9001'],
            completedAt: '2026-07-10T00:00:00.000Z'
          },
          { accountMid: '', aid: 8 } as never
        ]
      }).favoriteArchiveProtectionRecords
    ).toEqual([
      {
        accountMid: '42',
        aid: 7,
        targetLedgerIds: ['game'],
        targetFolderIds: ['9001'],
        completedAt: '2026-07-10T00:00:00.000Z'
      }
    ])
    expect(createInitialAssistantPreferences().favoriteArchiveProtectionRecords).toEqual([])
  })

  it('normalizes accounts that completed the legacy favorite archive migration', () => {
    expect(
      createInitialAssistantPreferences({
        favoriteArchiveProtectionInitializedAccountMids: ['42', '42', ' ', '99']
      }).favoriteArchiveProtectionInitializedAccountMids
    ).toEqual(['42', '99'])
    expect(createInitialAssistantPreferences().favoriteArchiveProtectionInitializedAccountMids).toEqual([])
  })
})
