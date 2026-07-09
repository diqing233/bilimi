import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_PREFERENCES,
  loadVideoNotes,
  loadVideoNoteArchives,
  loadAssistantPreferences,
  loadDeepSeekApiKeyStatus,
  saveVideoNoteArchiveVersion,
  updateVideoNoteArchiveVersion,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  clearDeepSeekApiKey,
  saveDeepSeekApiKey,
  saveVideoNote,
  saveAssistantPreferences,
  loadPendingFavoriteQueue,
  savePendingFavoriteQueue,
  clearPendingFavoriteQueue,
  upsertPendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus,
  loadVideoAudioTranscriptionQueue,
  saveVideoAudioTranscriptionQueue,
  type DesktopStoreState,
  type AssistantStoreLike
} from './store'
import type {
  PendingFavoriteQueueItem,
  VideoAudioTranscriptionQueueItem,
  VideoNote,
  VideoNoteArchiveEntry
} from '../../src/shared/types'

function createStoreNote(id = 'bvid:BV1store'): VideoNote {
  return {
    id,
    source: {
      title: '鏈',
      bvid: id.replace('bvid:', ''),
      url: 'https://www.bilibili.com/video/BV1store',
      tags: []
    },
    transcriptSource: 'auto',
    transcript: [],
    chapters: [],
    overview: {
      shortSummary: ['鎽樿'],
      keywords: [],
      timeline: [],
      highlights: []
    },
    annotations: [],
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z'
  }
}

function createFakeStore(
  initial: Partial<DesktopStoreState> = {}
): AssistantStoreLike & { setCalls: unknown[]; snapshot: DesktopStoreState } {
  const snapshot: DesktopStoreState = {
    favoritesFolderName: initial.favoritesFolderName ?? DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName,
    favoriteLedgers: initial.favoriteLedgers ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers,
    ledgerPromptDismissed:
      initial.ledgerPromptDismissed ?? DEFAULT_ASSISTANT_PREFERENCES.ledgerPromptDismissed,
    petStyle: initial.petStyle ?? DEFAULT_ASSISTANT_PREFERENCES.petStyle,
    petHoverShortcuts: initial.petHoverShortcuts ?? DEFAULT_ASSISTANT_PREFERENCES.petHoverShortcuts,
    hidePetDuringVideoFullscreen:
      initial.hidePetDuringVideoFullscreen ??
      DEFAULT_ASSISTANT_PREFERENCES.hidePetDuringVideoFullscreen,
    bilibiliOperationMode:
      initial.bilibiliOperationMode ?? DEFAULT_ASSISTANT_PREFERENCES.bilibiliOperationMode,
    favoriteArchiveMultiMode:
      initial.favoriteArchiveMultiMode ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteArchiveMultiMode,
    favoriteArchiveStrategy:
      initial.favoriteArchiveStrategy ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteArchiveStrategy,
    favoriteCorrectionLearningEnabled:
      initial.favoriteCorrectionLearningEnabled ??
      DEFAULT_ASSISTANT_PREFERENCES.favoriteCorrectionLearningEnabled,
    favoriteCorrectionLearningClassificationEnabled:
      initial.favoriteCorrectionLearningClassificationEnabled ??
      DEFAULT_ASSISTANT_PREFERENCES.favoriteCorrectionLearningClassificationEnabled,
    favoriteCorrectionRecords:
      initial.favoriteCorrectionRecords ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteCorrectionRecords,
    favoriteKeywordSuggestions:
      initial.favoriteKeywordSuggestions ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteKeywordSuggestions,
    defaultCoinCount: initial.defaultCoinCount ?? DEFAULT_ASSISTANT_PREFERENCES.defaultCoinCount,
    commentSubmitMode:
      initial.commentSubmitMode ?? DEFAULT_ASSISTANT_PREFERENCES.commentSubmitMode,
    preferenceCounts: initial.preferenceCounts ?? { ...DEFAULT_ASSISTANT_PREFERENCES.preferenceCounts },
    deepseekEnabled: initial.deepseekEnabled ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekEnabled,
    deepseekApiKeyStored:
      initial.deepseekApiKeyStored ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekApiKeyStored,
    deepseekCommentEnabled:
      initial.deepseekCommentEnabled ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekCommentEnabled,
    deepseekAutoSummaryEnabled:
      initial.deepseekAutoSummaryEnabled ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekAutoSummaryEnabled,
    deepseekPetChatEnabled:
      initial.deepseekPetChatEnabled ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekPetChatEnabled,
    deepseekDailyClassificationEnabled:
      initial.deepseekDailyClassificationEnabled ??
      DEFAULT_ASSISTANT_PREFERENCES.deepseekDailyClassificationEnabled,
    deepseekDailyClassificationMode:
      initial.deepseekDailyClassificationMode ??
      DEFAULT_ASSISTANT_PREFERENCES.deepseekDailyClassificationMode,
    deepseekModel: initial.deepseekModel ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl: initial.deepseekBaseUrl ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    permissionOnboardingCompleted:
      initial.permissionOnboardingCompleted ??
      DEFAULT_ASSISTANT_PREFERENCES.permissionOnboardingCompleted,
    assistantSidebarWidthPx:
      initial.assistantSidebarWidthPx ?? DEFAULT_ASSISTANT_PREFERENCES.assistantSidebarWidthPx,
    videoAudioTranscriptionThreadLimit:
      initial.videoAudioTranscriptionThreadLimit ??
      DEFAULT_ASSISTANT_PREFERENCES.videoAudioTranscriptionThreadLimit,
    deepseekApiKey: initial.deepseekApiKey ?? '',
    videoNotes: initial.videoNotes ?? [],
    videoNoteArchives: initial.videoNoteArchives ?? [],
    pendingFavoriteQueue: initial.pendingFavoriteQueue ?? [],
    videoAudioTranscriptionQueue: initial.videoAudioTranscriptionQueue ?? []
  }
  const setCalls: unknown[] = []

  return {
    setCalls,
    snapshot,
    get(key) {
      return snapshot[key]
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(snapshot, key)
    },
    set(key, value) {
      setCalls.push(key)
      if (typeof key === 'object') {
        Object.assign(snapshot, key)
        return
      }

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

  it('defaults the first-start permission onboarding to incomplete', () => {
    const store = createFakeStore()

    expect(loadAssistantPreferences(store).permissionOnboardingCompleted).toBe(false)
  })

  it('defaults comment submission to random direct sending in persisted preferences', () => {
    const store = createFakeStore()

    expect(loadAssistantPreferences(store).commentSubmitMode).toBe('random')
  })

  it('defaults correction learning preferences for legacy stores', () => {
    const store = createFakeStore()
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteArchiveStrategy
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteCorrectionLearningEnabled
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteCorrectionLearningClassificationEnabled
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteCorrectionRecords
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteKeywordSuggestions

    expect(loadAssistantPreferences(store)).toMatchObject({
      favoriteArchiveStrategy: 'aggressive',
      favoriteCorrectionLearningEnabled: true,
      favoriteCorrectionLearningClassificationEnabled: true,
      favoriteCorrectionRecords: [],
      favoriteKeywordSuggestions: []
    })
  })

  it('defaults and persists DeepSeek daily classification preferences', () => {
    const store = createFakeStore()
    delete (store.snapshot as Record<string, unknown>).deepseekDailyClassificationEnabled
    delete (store.snapshot as Record<string, unknown>).deepseekDailyClassificationMode

    expect(loadAssistantPreferences(store)).toMatchObject({
      deepseekDailyClassificationEnabled: false,
      deepseekDailyClassificationMode: 'all'
    })

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only'
    })

    expect(saved).toMatchObject({
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only'
    })
  })

  it('loads favorite ledgers and first-open prompt state with preferences', () => {
    const store = createFakeStore({
      favoriteLedgers: [
        {
          id: 'custom-photo',
          displayName: 'Bilimi路鍏夊奖鐣欑湡',
          keywords: ['鎽勫奖'],
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
          displayName: 'bilimi·鍏夊奖鐣欑湡'
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
      bilibiliOperationMode: 'page-visual',
      favoriteArchiveMultiMode: 'two',
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
      ],
      defaultCoinCount: 2,
      commentSubmitMode: 'random',
      petStyle: 'classic',
      petHoverShortcuts: ['favorite', 'library', 'prepare-ledgers', 'organize-old-favorites'],
      hidePetDuringVideoFullscreen: true,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      },
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: false,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only',
      deepseekModel: 'deepseek-reasoner',
      deepseekBaseUrl: 'https://deepseek.example',
      permissionOnboardingCompleted: true,
      assistantSidebarWidthPx: 360,
      videoAudioTranscriptionThreadLimit: 2
    })

    expect(saved).toMatchObject({
      favoritesFolderName: 'Archive',
      ledgerPromptDismissed: false,
      bilibiliOperationMode: 'page-visual',
      favoriteArchiveMultiMode: 'two',
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
      ],
      defaultCoinCount: 2,
      commentSubmitMode: 'random',
      petStyle: 'classic',
      petHoverShortcuts: ['favorite', 'library', 'prepare-ledgers', 'organize-old-favorites'],
      hidePetDuringVideoFullscreen: true,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      },
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      deepseekPetChatEnabled: true,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only',
      deepseekModel: 'deepseek-reasoner',
      deepseekBaseUrl: 'https://deepseek.example',
      permissionOnboardingCompleted: true,
      assistantSidebarWidthPx: 360,
      videoAudioTranscriptionThreadLimit: 2
    })
    expect(store.snapshot).toMatchObject(saved)
    expect(store.snapshot.videoNotes).toEqual([])
  })

  it('writes assistant preferences to the store in a single batch', () => {
    const store = createFakeStore()

    saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      defaultCoinCount: 2,
      commentSubmitMode: 'random'
    })

    expect(store.setCalls).toHaveLength(1)
    expect(store.setCalls[0]).toMatchObject({
      defaultCoinCount: 2,
      commentSubmitMode: 'random'
    })
  })

  it('normalizes invalid preference values during a batched save', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      petStyle: 'invalid' as never,
      defaultCoinCount: 9 as never,
      commentSubmitMode: 'manual' as never,
      favoriteArchiveMultiMode: 'many' as never,
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
      favoriteKeywordSuggestions: [null, 'bad'] as never,
      assistantSidebarWidthPx: 999 as never,
      videoAudioTranscriptionThreadLimit: 9 as never
    })

    expect(saved).toMatchObject({
      commentSubmitMode: 'choose',
      defaultCoinCount: 1,
      favoriteArchiveMultiMode: 'off',
      favoriteArchiveStrategy: 'aggressive',
      favoriteCorrectionRecords: [
        expect.objectContaining({
          userLedgerIds: ['game']
        })
      ],
      favoriteKeywordSuggestions: [],
      petStyle: 'big-head',
      assistantSidebarWidthPx: 486,
      videoAudioTranscriptionThreadLimit: 'unlimited'
    })
    expect(store.setCalls).toHaveLength(1)
  })

  it('persists DeepSeek settings and keeps the key out of assistant preferences', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: false,
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local'
    })

    expect(saved).toMatchObject({
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekCommentEnabled: true,
      deepseekAutoSummaryEnabled: true,
      deepseekPetChatEnabled: false,
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local'
    })
    expect(store.snapshot.deepseekApiKey).toBe('')
  })

  it('preserves cleared DeepSeek model and service address preferences', () => {
    const store = createFakeStore({
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local'
    })

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      deepseekModel: '',
      deepseekBaseUrl: ''
    })

    expect(saved).toMatchObject({
      deepseekModel: '',
      deepseekBaseUrl: ''
    })
    expect(loadAssistantPreferences(store)).toMatchObject({
      deepseekModel: '',
      deepseekBaseUrl: ''
    })
  })

  it('loads DeepSeek feature toggles with legacy inheritance', () => {
    const legacyStore = createFakeStore({
      deepseekEnabled: true
    })
    delete (legacyStore.snapshot as Partial<DesktopStoreState>).deepseekCommentEnabled
    delete (legacyStore.snapshot as Partial<DesktopStoreState>).deepseekPetChatEnabled

    expect(loadAssistantPreferences(legacyStore)).toMatchObject({
      deepseekEnabled: true,
      deepseekCommentEnabled: true,
      deepseekPetChatEnabled: true
    })

    const explicitStore = createFakeStore({
      deepseekEnabled: true,
      deepseekCommentEnabled: false,
      deepseekPetChatEnabled: true
    })

    expect(loadAssistantPreferences(explicitStore)).toMatchObject({
      deepseekEnabled: true,
      deepseekCommentEnabled: false,
      deepseekPetChatEnabled: true
    })
  })

  it('normalizes persisted pet hover shortcuts to four valid entries', () => {
    const store = createFakeStore({
      petHoverShortcuts: [
        'favorite',
        'library',
        'favorite',
        'prepare-ledgers',
        'organize-old-favorites',
        'comment',
        'invalid'
      ] as never
    })

    expect(loadAssistantPreferences(store).petHoverShortcuts).toEqual([
      'favorite',
      'library',
      'prepare-ledgers',
      'organize-old-favorites'
    ])

    saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe', 'library']
    } as never)

    expect(store.snapshot.petHoverShortcuts).toEqual(['like', 'coin', 'comment', 'transcribe'])
  })

  it('saves and clears the DeepSeek API key status', () => {
    const store = createFakeStore()

    expect(loadDeepSeekApiKeyStatus(store)).toEqual({ configured: false })
    expect(saveDeepSeekApiKey(store, 'sk-test')).toEqual({ configured: true })
    expect(loadDeepSeekApiKeyStatus(store)).toEqual({ configured: true })
    expect(clearDeepSeekApiKey(store)).toEqual({ configured: false })
    expect(loadDeepSeekApiKeyStatus(store)).toEqual({ configured: false })
  })

  it('reflects DeepSeek API key presence in loaded assistant preferences', () => {
    const store = createFakeStore({ deepseekApiKey: 'sk-test' })

    expect(loadAssistantPreferences(store).deepseekApiKeyStored).toBe(true)
  })
})

describe('pending favorite queue store helpers', () => {
  const pendingQueueItem: PendingFavoriteQueueItem = {
    aid: 202,
    title: '待分类旧藏',
    source: 'old-favorite-scan',
    sourceFolderTitle: '默认收藏夹',
    originalTargetLedgerId: 'inbox',
    suggestedLedgerIds: [],
    candidateLedgerNames: ['bilimi·摄影'],
    reason: '高频标签建议新建',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    status: 'pending'
  }

  it('loads an empty pending queue by default', () => {
    const store = createFakeStore()

    expect(loadPendingFavoriteQueue(store)).toEqual([])
  })

  it('saves, upserts, and updates pending queue items', () => {
    const store = createFakeStore()

    expect(savePendingFavoriteQueue(store, [pendingQueueItem])).toEqual([pendingQueueItem])
    expect(
      upsertPendingFavoriteQueueItems(
        store,
        [{ ...pendingQueueItem, title: '更新标题', suggestedLedgerIds: ['knowledge'] }],
        '2026-06-28T01:00:00.000Z'
      )
    ).toEqual([
      {
        ...pendingQueueItem,
        title: '更新标题',
        suggestedLedgerIds: ['knowledge'],
        updatedAt: '2026-06-28T01:00:00.000Z'
      }
    ])
    expect(
      updatePendingFavoriteQueueItemStatus(store, 202, 'archived', '2026-06-28T02:00:00.000Z')
    ).toEqual([])
  })

  it('clears all pending queue items at once', () => {
    const store = createFakeStore({
      pendingFavoriteQueue: [pendingQueueItem]
    })

    expect(clearPendingFavoriteQueue(store)).toEqual([])
    expect(loadPendingFavoriteQueue(store)).toEqual([])
    expect(store.snapshot.pendingFavoriteQueue).toEqual([])
  })
})

describe('video note store helpers', () => {
  it('loads an empty video note list by default', () => {
    const store = createFakeStore()

    expect(loadVideoNotes(store)).toEqual([])
  })

  it('loads legacy video notes with an empty annotations list', () => {
    const legacyNote = { ...createStoreNote() }
    delete (legacyNote as Partial<VideoNote>).annotations
    const store = createFakeStore({
      videoNotes: [legacyNote as VideoNote]
    })

    expect(loadVideoNotes(store)).toEqual([
      {
        ...legacyNote,
        annotations: []
      }
    ])
  })

  it('saves and updates video notes by stable id', () => {
    const store = createFakeStore()
    const first = createStoreNote()
    const second = {
      ...first,
      userMemo: '鏇存柊澶囨敞',
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z'
    }

    expect(saveVideoNote(store, first)).toEqual([first])
    expect(saveVideoNote(store, second)).toEqual([
      {
        ...second,
        createdAt: first.createdAt
      }
    ])
  })
})

describe('video note archive store helpers', () => {
  it('loads an empty archive list by default', () => {
    const store = createFakeStore()

    expect(loadVideoNoteArchives(store)).toEqual([])
  })

  it('loads legacy archive entries with derived transcript and summary text', () => {
    const note = createStoreNote()
    const archive = {
      id: note.id,
      source: note.source,
      versions: [
        {
          id: 'version-1',
          note,
          createdAt: '2026-06-17T00:00:00.000Z'
        }
      ],
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z'
    } as VideoNoteArchiveEntry
    const store = createFakeStore({ videoNoteArchives: [archive] })

    expect(loadVideoNoteArchives(store)[0].versions[0]).toEqual(
      expect.objectContaining({
        plainTranscript: '',
        summaryText: expect.stringContaining('## 速览')
      })
    )
  })

  it('saves each generated note as a version in the archive', () => {
    const store = createFakeStore()
    const first = createStoreNote()
    const second = {
      ...first,
      transcript: [{ start: null, end: null, text: '第二次转写。' }],
      updatedAt: '2026-06-17T01:00:00.000Z'
    }

    expect(saveVideoNoteArchiveVersion(store, first, '2026-06-17T00:00:00.000Z')[0].versions).toHaveLength(1)
    expect(saveVideoNoteArchiveVersion(store, second, '2026-06-17T01:00:00.000Z')[0].versions).toHaveLength(2)
    expect(store.snapshot.videoNoteArchives[0].versions[1].plainTranscript).toBe('第二次转写。')
    expect(store.snapshot.videoNoteArchives[0].versions[1].summaryText).toBe('')
  })

  it('stores explicit DeepSeek summary text with archive versions', () => {
    const store = createFakeStore()
    const note = createStoreNote()

    saveVideoNoteArchiveVersion(
      store,
      note,
      '2026-06-17T00:00:00.000Z',
      'DeepSeek summary text'
    )

    expect(store.snapshot.videoNoteArchives[0].versions[0].summaryText).toBe(
      'DeepSeek summary text'
    )
  })

  it('updates a saved archive version in place', () => {
    const store = createFakeStore()
    const note = createStoreNote()
    saveVideoNoteArchiveVersion(store, note, '2026-06-17T00:00:00.000Z')
    const archiveId = store.snapshot.videoNoteArchives[0].id
    const versionId = store.snapshot.videoNoteArchives[0].versions[0].id

    const updated = updateVideoNoteArchiveVersion(store, archiveId, versionId, {
      ...note,
      userMemo: '离开档案库前保存',
      updatedAt: '2026-06-17T02:00:00.000Z'
    })

    expect(updated[0].versions).toHaveLength(1)
    expect(store.snapshot.videoNoteArchives[0].versions[0].note.userMemo).toBe('离开档案库前保存')
  })

  it('deletes archive entries and versions', () => {
    const store = createFakeStore()
    const note = createStoreNote()
    saveVideoNoteArchiveVersion(store, note, '2026-06-17T00:00:00.000Z')
    saveVideoNoteArchiveVersion(store, note, '2026-06-17T01:00:00.000Z')
    const archiveId = store.snapshot.videoNoteArchives[0].id
    const versionId = store.snapshot.videoNoteArchives[0].versions[0].id

    expect(deleteVideoNoteArchiveVersion(store, archiveId, versionId)[0].versions).toHaveLength(1)
    expect(deleteVideoNoteArchiveEntry(store, archiveId)).toEqual([])
  })
})

describe('video audio transcription queue store helpers', () => {
  it('loads an empty queue by default', () => {
    const store = createFakeStore()

    expect(loadVideoAudioTranscriptionQueue(store)).toEqual([])
  })

  it('recovers draft notes from stale failed jobs and resets the queue on load', () => {
    const draftNote = createStoreNote('bvid:BV1queue')
    const failedItem: VideoAudioTranscriptionQueueItem = {
      id: 'bvid:BV1queue',
      url: 'https://www.bilibili.com/video/BV1queue',
      title: 'Queue video',
      bvid: 'BV1queue',
      status: 'failed',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:01:00.000Z',
      progress: { step: 'summarizing-deepseek', message: 'Generating DeepSeek summary.' },
      errorMessage: 'DeepSeek is not configured.',
      draftNote
    }
    const pendingItem: VideoAudioTranscriptionQueueItem = {
      id: 'bvid:BV2queue',
      url: 'https://www.bilibili.com/video/BV2queue',
      title: 'Second queue video',
      bvid: 'BV2queue',
      status: 'pending',
      createdAt: '2026-06-25T00:02:00.000Z',
      updatedAt: '2026-06-25T00:02:00.000Z'
    }
    const store = createFakeStore()

    saveVideoAudioTranscriptionQueue(store, [failedItem, pendingItem])

    expect(loadVideoAudioTranscriptionQueue(store)).toEqual([])
    expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([])
    expect(store.snapshot.videoNoteArchives).toHaveLength(1)
    expect(store.snapshot.videoNoteArchives[0]).toMatchObject({
      id: 'bvid:BV1queue',
      versions: [
        expect.objectContaining({
          note: draftNote,
          summaryText: ''
        })
      ]
    })
  })

  it('resets stale running, pending, and completed queue items on load', () => {
    const runningItem: VideoAudioTranscriptionQueueItem = {
      id: 'bvid:BV1queue',
      url: 'https://www.bilibili.com/video/BV1queue',
      title: 'Queue video',
      bvid: 'BV1queue',
      status: 'running',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:01:00.000Z',
      startedAt: '2026-06-25T00:00:30.000Z'
    }
    const pendingItem: VideoAudioTranscriptionQueueItem = {
      id: 'bvid:BV2queue',
      url: 'https://www.bilibili.com/video/BV2queue',
      title: 'Second queue video',
      bvid: 'BV2queue',
      status: 'pending',
      createdAt: '2026-06-25T00:02:00.000Z',
      updatedAt: '2026-06-25T00:02:00.000Z'
    }
    const completedItem: VideoAudioTranscriptionQueueItem = {
      id: 'bvid:BV3queue',
      url: 'https://www.bilibili.com/video/BV3queue',
      title: 'Completed queue video',
      bvid: 'BV3queue',
      status: 'completed',
      createdAt: '2026-06-25T00:03:00.000Z',
      updatedAt: '2026-06-25T00:04:00.000Z',
      completedAt: '2026-06-25T00:04:00.000Z'
    }
    const store = createFakeStore()

    saveVideoAudioTranscriptionQueue(store, [runningItem, pendingItem, completedItem])

    expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([
      runningItem,
      pendingItem,
      completedItem
    ])
    expect(loadVideoAudioTranscriptionQueue(store)).toEqual([])
    expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([])
  })
})
