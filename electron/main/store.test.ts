import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_PREFERENCES,
  loadVideoNotes,
  loadVideoNoteArchives,
  saveVideoNoteArchiveVersionWithIdentity,
  saveVideoNoteArchiveSummaryWithIdentity,
  loadAssistantPreferences,
  loadFavoriteAccountPreferences,
  loadDeepSeekApiKey,
  loadDeepSeekApiKeyStatus,
  saveVideoNoteArchiveVersion,
  updateVideoNoteArchiveVersion,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  clearDeepSeekApiKey,
  saveDeepSeekApiKey,
  saveVideoNote,
  saveAssistantPreferences,
  saveFavoriteAccountPreferences,
  writeFavoriteLedgerEnabled,
  patchAssistantPreferences,
  writeAssistantPreferencePatch,
  loadPendingFavoriteQueue,
  savePendingFavoriteQueue,
  clearPendingFavoriteQueue,
  dismissFavoriteLibraryRemoteFolder,
  isFavoriteLibraryRemoteFolderDismissed,
  dismissFavoriteLedgerRemoteDraftReminder,
  clearFavoriteLedgerRemoteDraftReminder,
  isFavoriteLedgerRemoteDraftReminderDismissed,
  loadFavoriteLedgerRemoteDraftRediscoveryPending,
  markFavoriteLedgerRemoteDraftRediscoveryPending,
  consumeFavoriteLedgerRemoteDraftRediscoveryPending,
  upsertPendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus,
  loadVideoAudioTranscriptionQueue,
  saveVideoAudioTranscriptionQueue,
  loadNoteProcessingCheckpoints,
  saveNoteProcessingCheckpoint,
  deleteNoteProcessingCheckpoint,
  type DesktopStoreState,
  type AssistantStoreLike,
  type FavoriteLedgerEnabledOverrideStoreLike
} from './store'
import type {
  FavoriteLedgerEnabledPatch,
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

function createSafeStorage({ available = true, failDecrypt = false } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from('encrypted:' + value, 'utf8'),
    decryptString: (value: Buffer) => {
      if (failDecrypt) throw new Error('decrypt failed')
      return value.toString('utf8').replace(/^encrypted:/u, '')
    }
  }
}

function createFakeStore(
  initial: Partial<DesktopStoreState> = {}
): AssistantStoreLike & { setCalls: unknown[]; snapshot: DesktopStoreState } {
  const snapshot: DesktopStoreState = {
    favoritesFolderName: initial.favoritesFolderName ?? DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName,
    favoriteLedgers: initial.favoriteLedgers ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers,
    favoriteAccountPreferences: initial.favoriteAccountPreferences ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteAccountPreferences,
    favoriteLibraryDismissedRemoteFolderIdsByAccount: initial.favoriteLibraryDismissedRemoteFolderIdsByAccount ?? {},
    favoriteLedgerRemoteDraftReminderDismissedByAccount: initial.favoriteLedgerRemoteDraftReminderDismissedByAccount ?? {},
    favoriteLedgerRemoteDraftRediscoveryPendingByAccount: initial.favoriteLedgerRemoteDraftRediscoveryPendingByAccount ?? {},
    ledgerPromptDismissed:
      initial.ledgerPromptDismissed ?? DEFAULT_ASSISTANT_PREFERENCES.ledgerPromptDismissed,
    petStyle: initial.petStyle ?? DEFAULT_ASSISTANT_PREFERENCES.petStyle,
    petHoverShortcuts: initial.petHoverShortcuts ?? DEFAULT_ASSISTANT_PREFERENCES.petHoverShortcuts,
    hidePetDuringVideoFullscreen:
      initial.hidePetDuringVideoFullscreen ??
      DEFAULT_ASSISTANT_PREFERENCES.hidePetDuringVideoFullscreen,
    closeBehavior: initial.closeBehavior ?? DEFAULT_ASSISTANT_PREFERENCES.closeBehavior,
    confirmBeforeExit: initial.confirmBeforeExit ?? DEFAULT_ASSISTANT_PREFERENCES.confirmBeforeExit,
    rememberCloseChoice:
      initial.rememberCloseChoice ?? DEFAULT_ASSISTANT_PREFERENCES.rememberCloseChoice,
    closeChoiceMigrationVersion:
      initial.closeChoiceMigrationVersion ?? DEFAULT_ASSISTANT_PREFERENCES.closeChoiceMigrationVersion,
    bilibiliOperationMode:
      initial.bilibiliOperationMode ?? DEFAULT_ASSISTANT_PREFERENCES.bilibiliOperationMode,
    bilibiliConnectionMode:
      initial.bilibiliConnectionMode ?? DEFAULT_ASSISTANT_PREFERENCES.bilibiliConnectionMode,
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
    favoriteAdjustmentRecordsVersion:
      initial.favoriteAdjustmentRecordsVersion ??
      DEFAULT_ASSISTANT_PREFERENCES.favoriteAdjustmentRecordsVersion,
    favoriteCorrectionRecords:
      initial.favoriteCorrectionRecords ?? DEFAULT_ASSISTANT_PREFERENCES.favoriteCorrectionRecords,
    favoriteArchiveProtectionRecords:
      initial.favoriteArchiveProtectionRecords ??
      DEFAULT_ASSISTANT_PREFERENCES.favoriteArchiveProtectionRecords,
    favoriteArchiveProtectionInitializedAccountMids:
      initial.favoriteArchiveProtectionInitializedAccountMids ??
      DEFAULT_ASSISTANT_PREFERENCES.favoriteArchiveProtectionInitializedAccountMids,
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
    deepseekArchiveOrganizationEnabled:
      initial.deepseekArchiveOrganizationEnabled ??
      DEFAULT_ASSISTANT_PREFERENCES.deepseekArchiveOrganizationEnabled,
    deepseekFeatureDefaultsInitialized:
      initial.deepseekFeatureDefaultsInitialized ??
      DEFAULT_ASSISTANT_PREFERENCES.deepseekFeatureDefaultsInitialized,
    deepseekModel: initial.deepseekModel ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl: initial.deepseekBaseUrl ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    showPetAssistantShortcut:
      initial.showPetAssistantShortcut ?? DEFAULT_ASSISTANT_PREFERENCES.showPetAssistantShortcut,
    permissionOnboardingCompleted:
      initial.permissionOnboardingCompleted ??
      DEFAULT_ASSISTANT_PREFERENCES.permissionOnboardingCompleted,
    assistantSidebarWidthPx:
      initial.assistantSidebarWidthPx ?? DEFAULT_ASSISTANT_PREFERENCES.assistantSidebarWidthPx,
    videoAudioTranscriptionThreadLimit:
      initial.videoAudioTranscriptionThreadLimit ??
      DEFAULT_ASSISTANT_PREFERENCES.videoAudioTranscriptionThreadLimit,
    deepseekApiKey: initial.deepseekApiKey ?? '',
    deepseekApiKeyEncrypted: initial.deepseekApiKeyEncrypted ?? '',
    videoNotes: initial.videoNotes ?? [],
    videoNoteArchives: initial.videoNoteArchives ?? [],
    pendingFavoriteQueue: initial.pendingFavoriteQueue ?? [],
    videoAudioTranscriptionQueue: initial.videoAudioTranscriptionQueue ?? [],
    noteProcessingCheckpointsV1: initial.noteProcessingCheckpointsV1 ?? {}
  }
  const setCalls: unknown[] = []
  const set: AssistantStoreLike['set'] = (
    keyOrValues: Partial<DesktopStoreState> | keyof DesktopStoreState,
    value?: DesktopStoreState[keyof DesktopStoreState]
  ) => {
    setCalls.push(keyOrValues)
    if (typeof keyOrValues === 'object') {
      Object.assign(snapshot, keyOrValues)
      return
    }

    Object.assign(snapshot, { [keyOrValues]: value })
  }

  return {
    setCalls,
    snapshot,
    get(key) {
      return snapshot[key]
    },
    has(key) {
      return Object.prototype.hasOwnProperty.call(snapshot, key)
    },
    set
  }
}

function createFakeEnabledOverrideStore(initial: Record<string, Record<string, boolean>> = {}) {
  let snapshot = structuredClone(initial)
  const appended: unknown[] = []
  const store: FavoriteLedgerEnabledOverrideStoreLike & { appended: unknown[]; snapshot: () => typeof snapshot } = {
    getOverrides() { return snapshot },
    async append(patch) {
      appended.push(patch)
      snapshot[patch.accountMid] ??= {}
      snapshot[patch.accountMid][patch.ledgerId] = patch.enabled
    },
    clear(accountMid) {
      if (!accountMid) { snapshot = {}; return }
      const { [accountMid]: _removed, ...remaining } = snapshot
      snapshot = remaining
    },
    appended,
    snapshot: () => snapshot
  }
  return store
}

describe('assistant preference store helpers', () => {
  it('keeps dismissed remote work folders local to their normalized account', () => {
    const store = createFakeStore({
      favoriteLibraryDismissedRemoteFolderIdsByAccount: { '00100': [' 4070414411 ', '', 7 as never], '200': ['other'] }
    })

    expect(isFavoriteLibraryRemoteFolderDismissed(store, '100', '4070414411')).toBe(true)
    expect(isFavoriteLibraryRemoteFolderDismissed(store, '200', '4070414411')).toBe(false)
    dismissFavoriteLibraryRemoteFolder(store, '100', ' 4070414411 ')
    dismissFavoriteLibraryRemoteFolder(store, '100', 'new-folder')
    expect(store.snapshot.favoriteLibraryDismissedRemoteFolderIdsByAccount).toEqual({
      '100': ['4070414411', 'new-folder'], '200': ['other']
    })
  })

  it('keeps remote-only ledger reminder dismissals local to the account and remote folder', () => {
    const store = createFakeStore()

    expect(isFavoriteLedgerRemoteDraftReminderDismissed(store, '00100', ' 4070414411 ')).toBe(false)
    dismissFavoriteLedgerRemoteDraftReminder(store, '00100', ' 4070414411 ')
    dismissFavoriteLedgerRemoteDraftReminder(store, '100', '4070414411')

    expect(isFavoriteLedgerRemoteDraftReminderDismissed(store, '100', '4070414411')).toBe(true)
    expect(isFavoriteLedgerRemoteDraftReminderDismissed(store, '200', '4070414411')).toBe(false)
    expect(store.snapshot.favoriteLedgerRemoteDraftReminderDismissedByAccount).toEqual({ '100': ['4070414411'] })
  })

  it('keeps a locally deleted remote draft pending until an explicit later backup consumes it', () => {
    const store = createFakeStore({
      favoriteLedgerRemoteDraftReminderDismissedByAccount: {
        '100': ['4070414411', 'keep-me'],
        '200': ['other-account']
      },
      favoriteLedgerRemoteDraftRediscoveryPendingByAccount: {
        '200': ['other-pending']
      }
    })

    markFavoriteLedgerRemoteDraftRediscoveryPending(store, '00100', [' 4070414411 ', 'missing'])

    expect(store.snapshot.favoriteLedgerRemoteDraftReminderDismissedByAccount).toEqual({
      '100': ['4070414411', 'keep-me'],
      '200': ['other-account']
    })
    expect(loadFavoriteLedgerRemoteDraftRediscoveryPending(store, '100')).toEqual(['4070414411', 'missing'])
    expect(loadFavoriteLedgerRemoteDraftRediscoveryPending(store, '200')).toEqual(['other-pending'])

    expect(consumeFavoriteLedgerRemoteDraftRediscoveryPending(store, '00100')).toEqual(['4070414411', 'missing'])
    expect(loadFavoriteLedgerRemoteDraftRediscoveryPending(store, '100')).toEqual([])
    expect(loadFavoriteLedgerRemoteDraftRediscoveryPending(store, '200')).toEqual(['other-pending'])
    expect(store.snapshot.favoriteLedgerRemoteDraftReminderDismissedByAccount).toEqual({
      '100': ['4070414411', 'keep-me'],
      '200': ['other-account']
    })
  })

  it('patches review preferences without overwriting a newer DeepSeek endpoint', () => {
    const store = createFakeStore({
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.yunshulink.com/v1'
    })

    patchAssistantPreferences(store, { preferenceCounts: { funny: 3 } })

    expect(loadAssistantPreferences(store)).toMatchObject({
      preferenceCounts: { funny: 3 },
      deepseekModel: 'deepseek-v4-flash',
      deepseekBaseUrl: 'https://api.yunshulink.com/v1'
    })
  })

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

  it('rebuilds defaults from the sparse store left by an in-app full clear', () => {
    const store = createFakeStore()
    for (const key of Object.keys(store.snapshot)) delete (store.snapshot as Record<string, unknown>)[key]
    Object.assign(store.snapshot, { rememberCloseChoice: false, closeChoiceMigrationVersion: 1 })

    const preferences = loadAssistantPreferences(store)

    expect(preferences.favoriteLedgers).toEqual(DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers)
    expect(preferences.favoriteAccountPreferences).toEqual({})
    expect(preferences.favoritesFolderName).toBe(DEFAULT_ASSISTANT_PREFERENCES.favoritesFolderName)
  })

  it('writes an ordinary preference patch without rewriting untouched heavy branches', () => {
    const correctionRecords = [{
      id: 'record-1', aid: 1, title: 'Heavy', originalLedgerId: 'inbox', userLedgerIds: ['game'],
      source: 'user', feedbackType: 'strong-correction', sourceScene: 'archive-preview', tags: [],
      matchedKeywords: [], createdAt: '2026-07-29T00:00:00.000Z', confirmedAt: '2026-07-29T00:00:00.000Z'
    }] as never
    const store = createFakeStore({
      favoriteAdjustmentRecordsVersion: 1,
      favoriteCorrectionRecords: correctionRecords
    })

    const saved = patchAssistantPreferences(store, { deepseekAutoSummaryEnabled: false })

    expect(store.setCalls.at(-1)).toEqual({ deepseekAutoSummaryEnabled: false })
    expect(store.snapshot.favoriteCorrectionRecords).toBe(correctionRecords)
    expect(saved.deepseekAutoSummaryEnabled).toBe(false)
  })

  it('returns only the normalized fields from the fast preference patch writer', () => {
    const store = createFakeStore()

    const written = writeAssistantPreferencePatch(store, {
      deepseekEnabled: 1 as never,
      assistantSidebarWidthPx: 999
    })

    expect(written).toEqual({ deepseekEnabled: true, assistantSidebarWidthPx: 486 })
    expect(store.setCalls.at(-1)).toEqual(written)
  })

  it('writes pet hover shortcuts through the narrow patch without rewriting preferences', () => {
    const store = createFakeStore()

    const written = writeAssistantPreferencePatch(store, {
      petHoverShortcuts: [
        'comment',
        'like',
        'comment',
        'assistant',
        'coin',
        'transcribe',
        'favorite'
      ] as never
    })

    expect(written).toEqual({
      petHoverShortcuts: ['comment', 'like', 'coin', 'transcribe']
    })
    expect(store.setCalls.at(-1)).toEqual(written)
  })

  it('accepts an empty pet hover shortcut list through the narrow patch', () => {
    const store = createFakeStore()

    const written = writeAssistantPreferencePatch(store, { petHoverShortcuts: [] })

    expect(written).toEqual({ petHoverShortcuts: [] })
    expect(store.setCalls.at(-1)).toEqual(written)
  })

  it('writes the old-favorite batch size through the narrow preference patch', () => {
    const store = createFakeStore()

    const written = writeAssistantPreferencePatch(store, {
      oldFavoriteWorkspaceSegmentSize: 2_000
    })

    expect(written).toEqual({ oldFavoriteWorkspaceSegmentSize: 2_000 })
    expect(store.setCalls.at(-1)).toEqual(written)
  })

  it('persists the experimental unlimited old-favorite batch size through the narrow preference patch', () => {
    const store = createFakeStore()

    const written = writeAssistantPreferencePatch(store, {
      oldFavoriteWorkspaceSegmentSize: Number.MAX_SAFE_INTEGER
    })

    expect(written).toEqual({ oldFavoriteWorkspaceSegmentSize: Number.MAX_SAFE_INTEGER })
    expect(store.setCalls.at(-1)).toEqual(written)
  })

  it('defaults and persists the Bilibili connection mode', () => {
    const store = createFakeStore()

    expect(loadAssistantPreferences(store)).toMatchObject({ bilibiliConnectionMode: 'auto' })
    expect(saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      bilibiliConnectionMode: 'direct'
    } as typeof DEFAULT_ASSISTANT_PREFERENCES)).toMatchObject({ bilibiliConnectionMode: 'direct' })
  })

  it('defaults missing action preferences to two coins and comment choice mode', () => {
    const store = createFakeStore()
    delete (store.snapshot as Partial<DesktopStoreState>).defaultCoinCount
    delete (store.snapshot as Partial<DesktopStoreState>).commentSubmitMode

    expect(loadAssistantPreferences(store)).toMatchObject({
      defaultCoinCount: 2,
      commentSubmitMode: 'choose'
    })
  })

  it('preserves persisted action preferences from existing users', () => {
    const store = createFakeStore({
      defaultCoinCount: 1,
      commentSubmitMode: 'random'
    })

    expect(loadAssistantPreferences(store)).toMatchObject({
      defaultCoinCount: 1,
      commentSubmitMode: 'random'
    })
  })

  it('migrates existing close settings to ask again once', () => {
    const store = createFakeStore()
    delete (store.snapshot as Partial<DesktopStoreState>).closeBehavior
    delete (store.snapshot as Partial<DesktopStoreState>).confirmBeforeExit
    delete (store.snapshot as Partial<DesktopStoreState>).rememberCloseChoice
    delete (store.snapshot as Partial<DesktopStoreState>).closeChoiceMigrationVersion

    expect(loadAssistantPreferences(store)).toMatchObject({
      closeBehavior: 'minimize-to-tray',
      rememberCloseChoice: false,
      closeChoiceMigrationVersion: 1
    })
    expect(store.snapshot).toMatchObject({ rememberCloseChoice: false, closeChoiceMigrationVersion: 1 })
  })

  it('persists the main window close behavior preferences', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      closeBehavior: 'exit-launcher',
      confirmBeforeExit: false
    })

    expect(saved).toMatchObject({
      closeBehavior: 'exit-launcher',
      confirmBeforeExit: false
    })
    expect(store.snapshot).toMatchObject({
      closeBehavior: 'exit-launcher',
      confirmBeforeExit: false
    })
  })

  it('migrates the assistant pet shortcut into its standalone toggle', () => {
    const store = createFakeStore({
      petHoverShortcuts: ['like', 'assistant', 'coin', 'comment', 'transcribe']
    })

    expect(loadAssistantPreferences(store)).toMatchObject({
      petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe'],
      showPetAssistantShortcut: true
    })
  })

  it('defaults the standalone assistant pet shortcut toggle to visible', () => {
    const store = createFakeStore()
    delete (store.snapshot as Partial<DesktopStoreState>).showPetAssistantShortcut

    expect(loadAssistantPreferences(store).showPetAssistantShortcut).toBe(true)
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

  it('loads and saves normalized favorite archive protection records', () => {
    const store = createFakeStore({
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
    })

    expect(loadAssistantPreferences(store).favoriteArchiveProtectionRecords).toEqual([
      {
        accountMid: '42',
        aid: 7,
        targetLedgerIds: ['game'],
        targetFolderIds: ['9001'],
        completedAt: '2026-07-10T00:00:00.000Z'
      }
    ])

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      favoriteArchiveProtectionRecords: [
        {
          accountMid: '42',
          aid: 9,
          targetLedgerIds: ['knowledge', 'knowledge'],
          targetFolderIds: ['9002'],
          completedAt: '2026-07-10T01:00:00.000Z'
        }
      ]
    })

    expect(saved.favoriteArchiveProtectionRecords).toEqual([
      {
        accountMid: '42',
        aid: 9,
        targetLedgerIds: ['knowledge'],
        targetFolderIds: ['9002'],
        completedAt: '2026-07-10T01:00:00.000Z'
      }
    ])
  })

  it('defaults favorite archive protection records for legacy stores', () => {
    const store = createFakeStore()
    delete (store.snapshot as Partial<DesktopStoreState>).favoriteArchiveProtectionRecords

    expect(loadAssistantPreferences(store).favoriteArchiveProtectionRecords).toEqual([])
  })

  it('normalizes accounts that completed the legacy favorite archive migration', () => {
    const store = createFakeStore({
      favoriteArchiveProtectionInitializedAccountMids: ['42', '42', ' ', '99']
    })

    expect(loadAssistantPreferences(store).favoriteArchiveProtectionInitializedAccountMids).toEqual(['42', '99'])
    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      favoriteArchiveProtectionInitializedAccountMids: ['7', '7', ' ']
    })
    expect(saved.favoriteArchiveProtectionInitializedAccountMids).toEqual(['7'])
  })

  it('defaults and persists independent DeepSeek organization preferences', () => {
    const store = createFakeStore()
    delete (store.snapshot as Record<string, unknown>).deepseekDailyClassificationEnabled
    delete (store.snapshot as Record<string, unknown>).deepseekDailyClassificationMode
    delete (store.snapshot as Record<string, unknown>).deepseekArchiveOrganizationEnabled
    delete (store.snapshot as Record<string, unknown>).deepseekFeatureDefaultsInitialized

    expect(loadAssistantPreferences(store)).toMatchObject({
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'all',
      deepseekArchiveOrganizationEnabled: true,
      deepseekFeatureDefaultsInitialized: false
    })

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only',
      deepseekArchiveOrganizationEnabled: false,
      deepseekFeatureDefaultsInitialized: true
    })

    expect(saved).toMatchObject({
      deepseekDailyClassificationEnabled: true,
      deepseekDailyClassificationMode: 'low-confidence-only',
      deepseekArchiveOrganizationEnabled: false,
      deepseekFeatureDefaultsInitialized: true
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

  it('initializes default favorites once and restores each account configuration', () => {
    const store = createFakeStore()
    const customLedgers = [{
      id: 'custom-tech', displayName: 'bilimi·科技', keywords: ['科技'],
      enabled: true, priority: 10, isDefault: false
    }]

    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({
      defaultFavoriteSystemEnabled: true,
      favoriteLedgers: DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers
    })

    saveFavoriteAccountPreferences(store, '100', {
      defaultFavoriteSystemEnabled: false,
      favoriteLedgers: customLedgers
    })

    expect(loadFavoriteAccountPreferences(store, '200').defaultFavoriteSystemEnabled).toBe(true)
    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({
      defaultFavoriteSystemEnabled: false,
      favoriteLedgers: expect.arrayContaining(customLedgers)
    })
  })

  it('loads an existing favorite account without reading unrelated persisted branches', () => {
    const store = createFakeStore({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: [{
            id: 'music', displayName: 'bilimi·音乐', keywords: ['music'], enabled: true, priority: 10, isDefault: false
          }],
          transcriptionModelId: 'whisper-small'
        }
      }
    })
    const originalGet = store.get.bind(store)
    store.get = ((key: keyof DesktopStoreState) => {
      if (key !== 'favoriteAccountPreferences') throw new Error(`unrelated branch read: ${String(key)}`)
      return originalGet(key)
    }) as AssistantStoreLike['get']

    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({
      favoriteLedgers: expect.arrayContaining([expect.objectContaining({ id: 'music', keywords: ['music'] })]),
      transcriptionModelId: 'whisper-small'
    })
  })

  it('keeps Whisper small as the safe account default until SenseVoice passes its acceptance gate', () => {
    const store = createFakeStore()
    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({ transcriptionModelId: 'whisper-small' })

    saveFavoriteAccountPreferences(store, '100', {
      ...loadFavoriteAccountPreferences(store, '100'),
      transcriptionModelId: 'whisper-small'
    })
    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({ transcriptionModelId: 'whisper-small' })
  })

  it('persists a durable timestamp with every favorite-account preference projection', () => {
    const store = createFakeStore()

    const initialized = loadFavoriteAccountPreferences(store, '100')
    const saved = saveFavoriteAccountPreferences(store, '100', { ...initialized, defaultFavoriteSystemEnabled: false })

    expect(initialized).toMatchObject({ updatedAt: expect.any(String) })
    expect(saved).toMatchObject({ defaultFavoriteSystemEnabled: false, updatedAt: expect.any(String) })
    expect(loadFavoriteAccountPreferences(store, '100')).toMatchObject({ updatedAt: saved.updatedAt })
  })

  it('updates one account ledger enabled flag with one narrow journal append', async () => {
    const store = createFakeEnabledOverrideStore()

    const patch = await writeFavoriteLedgerEnabled(store, '00100', ' music ', true)

    expect(patch).toEqual({ accountMid: '100', ledgerId: 'music', enabled: true })
    expect(store.appended).toEqual([{ accountMid: '100', ledgerId: 'music', enabled: true }])
    expect(store.snapshot()).toEqual({ '100': { music: true } })
  })

  it('appends one constant-size record without reading 30k persisted overrides', async () => {
    const mainStore = createFakeStore({
      favoriteAccountPreferences: {
        '100': {
          defaultFavoriteSystemEnabled: true,
          favoriteLedgers: Array.from({ length: 30_000 }, (_, index) => ({
            id: `ledger-${index}`, displayName: `Ledger ${index}`, keywords: [], enabled: false, priority: index, isDefault: false
          }))
        }
      }
    })
    const originalGet = mainStore.get.bind(mainStore)
    mainStore.get = ((key: keyof DesktopStoreState) => {
      if (key === 'favoriteAccountPreferences') throw new Error('large rules accessed')
      return originalGet(key)
    }) as AssistantStoreLike['get']
    const history = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [`ledger-${index}`, false]))
    const guardedHistory = new Proxy(history, {
      ownKeys() { throw new Error('override history enumerated during click') }
    })
    let inMemory: Record<string, Record<string, boolean>> = { '100': guardedHistory }
    const appended: FavoriteLedgerEnabledPatch[] = []
    const overrideStore: FavoriteLedgerEnabledOverrideStoreLike = {
      getOverrides: () => { throw new Error('override history replayed during click') },
      async append(patch) {
        appended.push(patch)
        inMemory[patch.accountMid] ??= {}
        inMemory[patch.accountMid][patch.ledgerId] = patch.enabled
      },
      clear: () => { inMemory = {} }
    }

    expect(await writeFavoriteLedgerEnabled(overrideStore, '100', 'ledger-29999', true)).toEqual({
      accountMid: '100', ledgerId: 'ledger-29999', enabled: true
    })
    expect(mainStore.setCalls).toHaveLength(0)
    expect(appended).toEqual([
      { accountMid: '100', ledgerId: 'ledger-29999', enabled: true }
    ])
  })

  it('merges enabled overrides on load and clears them after an explicit account save', () => {
    const store = createFakeStore({ favoriteAccountPreferences: { '100': {
      defaultFavoriteSystemEnabled: true,
      favoriteLedgers: [{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }]
    } } })
    const overrides = createFakeEnabledOverrideStore({ '100': { music: true, removed: false }, '200': { other: true } })

    expect(loadFavoriteAccountPreferences(store, '100', overrides).favoriteLedgers.find(
      (ledger) => ledger.id === 'music'
    )).toEqual(expect.objectContaining({ id: 'music', enabled: true }))

    saveFavoriteAccountPreferences(store, '100', {
      defaultFavoriteSystemEnabled: true,
      favoriteLedgers: [{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }]
    }, overrides)
    expect(overrides.snapshot()).toEqual({ '200': { other: true } })
    expect(loadFavoriteAccountPreferences(store, '100', overrides).favoriteLedgers[0].enabled).toBe(false)
  })

  it('saves favorites folder name and preference counts and returns the persisted shape', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      favoritesFolderName: 'Archive',
      favoriteLedgers: DEFAULT_ASSISTANT_PREFERENCES.favoriteLedgers,
      ledgerPromptDismissed: false,
      bilibiliOperationMode: 'page-visual',
      bilibiliConnectionMode: 'direct',
      favoriteArchiveMultiMode: 'two',
      oldFavoriteWorkspaceSegmentSize: 1_500,
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
      ],
      defaultCoinCount: 2,
      commentSubmitMode: 'random',
      petStyle: 'classic',
      petHoverShortcuts: ['favorite'],
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
      showPetAssistantShortcut: false,
      permissionOnboardingCompleted: true,
      assistantSidebarWidthPx: 360,
      videoAudioTranscriptionThreadLimit: 2
    })

    expect(saved).toMatchObject({
      favoritesFolderName: 'Archive',
      ledgerPromptDismissed: false,
      bilibiliOperationMode: 'page-visual',
      bilibiliConnectionMode: 'direct',
      favoriteArchiveMultiMode: 'two',
      oldFavoriteWorkspaceSegmentSize: 1_500,
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
      petHoverShortcuts: ['favorite'],
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
      showPetAssistantShortcut: false,
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
      oldFavoriteWorkspaceSegmentSize: 5_001,
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
      oldFavoriteWorkspaceSegmentSize: 2_000,
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

  it('drops retired shortcuts before capping persisted pet hover shortcuts', () => {
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
      'comment'
    ])

    saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      petHoverShortcuts: ['like', 'coin', 'comment', 'transcribe', 'library']
    } as never)

    expect(store.snapshot.petHoverShortcuts).toEqual(['like', 'coin', 'comment', 'transcribe'])
  })

  it('saves and clears the DeepSeek API key status', () => {
    const store = createFakeStore()
    const safeStorage = createSafeStorage()

    expect(loadDeepSeekApiKeyStatus(store, safeStorage)).toEqual({
      configured: false,
      protection: 'unavailable'
    })
    expect(saveDeepSeekApiKey(store, 'sk-test', safeStorage)).toEqual({
      configured: true,
      protection: 'encrypted'
    })
    expect(loadDeepSeekApiKey(store, safeStorage)).toBe('sk-test')
    expect(store.snapshot.deepseekApiKey).toBe('')
    expect(store.snapshot.deepseekApiKeyEncrypted).toBeTruthy()
    expect(loadDeepSeekApiKeyStatus(store, safeStorage)).toEqual({
      configured: true,
      protection: 'encrypted'
    })
    expect(clearDeepSeekApiKey(store)).toEqual({ configured: false, protection: 'unavailable' })
    expect(loadDeepSeekApiKeyStatus(store, safeStorage)).toEqual({
      configured: false,
      protection: 'unavailable'
    })
  })

  it('falls back to plaintext DeepSeek API key status when encryption is unavailable', () => {
    const store = createFakeStore()
    const safeStorage = createSafeStorage({ available: false })

    expect(saveDeepSeekApiKey(store, 'sk-plain', safeStorage)).toEqual({
      configured: true,
      protection: 'plaintext'
    })
    expect(loadDeepSeekApiKey(store, safeStorage)).toBe('sk-plain')
    expect(loadDeepSeekApiKeyStatus(store, safeStorage)).toEqual({
      configured: true,
      protection: 'plaintext'
    })
  })

  it('migrates legacy plaintext DeepSeek API keys into encrypted storage', () => {
    const store = createFakeStore({ deepseekApiKey: 'sk-legacy' })
    const safeStorage = createSafeStorage()

    expect(loadDeepSeekApiKeyStatus(store, safeStorage)).toEqual({
      configured: true,
      protection: 'encrypted'
    })
    expect(store.snapshot.deepseekApiKey).toBe('')
    expect(loadDeepSeekApiKey(store, safeStorage)).toBe('sk-legacy')
  })

  it('reports unreadable encrypted DeepSeek API keys as an error state', () => {
    const safeStorage = createSafeStorage()
    const encrypted = safeStorage.encryptString('sk-broken').toString('base64')
    const store = createFakeStore({ deepseekApiKeyEncrypted: encrypted })

    expect(loadDeepSeekApiKeyStatus(store, createSafeStorage({ failDecrypt: true }))).toEqual({
      configured: false,
      protection: 'error'
    })
    expect(loadDeepSeekApiKey(store, createSafeStorage({ failDecrypt: true }))).toBe('')
  })

  it('reflects DeepSeek API key presence in loaded assistant preferences', () => {
    const store = createFakeStore({ deepseekApiKey: 'sk-test' })

    expect(loadAssistantPreferences(store).deepseekApiKeyStored).toBe(true)
  })

  it('does not project an unreadable encrypted DeepSeek key as stored when a protector is supplied', () => {
    const safeStorage = createSafeStorage()
    const store = createFakeStore({
      deepseekApiKeyEncrypted: safeStorage.encryptString('sk-encrypted').toString('base64')
    })

    expect(loadAssistantPreferences(store, createSafeStorage({ failDecrypt: true })).deepseekApiKeyStored).toBe(false)
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
  it('persists resumable note checkpoints locally and removes them after a completed summary', () => {
    const store = createFakeStore()
    const checkpoint = {
      accountMid: '42', videoId: 'BV1checkpoint', transcriptHash: 'hash', promptVersion: 'faithful-v1', model: 'deepseek-chat',
      completedBatchIds: ['segment-1'], polishedTextBySegmentId: { 'segment-1': '保留的精修片段' }, updatedAt: new Date().toISOString()
    }

    saveNoteProcessingCheckpoint(store, checkpoint)
    expect(loadNoteProcessingCheckpoints(store)).toEqual({ '42:BV1checkpoint:hash:faithful-v1:deepseek-chat': checkpoint })

    deleteNoteProcessingCheckpoint(store, checkpoint)
    expect(loadNoteProcessingCheckpoints(store)).toEqual({})
  })

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

  it('updates only the second save when identical timestamps would otherwise collide', () => {
    const store = createFakeStore()
    const note = createStoreNote()
    const createdAt = '2026-06-17T00:00:00.000Z'

    const first = saveVideoNoteArchiveVersionWithIdentity(store, note, createdAt)
    const second = saveVideoNoteArchiveVersionWithIdentity(store, note, createdAt)
    const updated = updateVideoNoteArchiveVersion(
      store,
      second.archiveId,
      second.versionId,
      note,
      'Only the second version is summarized.'
    )

    expect(second.archiveId).toBe(first.archiveId)
    expect(second.versionId).not.toBe(first.versionId)
    expect(updated[0].versions).toHaveLength(2)
    expect(updated[0].versions.map((version) => version.summaryText)).toEqual([
      '',
      'Only the second version is summarized.'
    ])
  })

  it('rejects a write when the exact archive version cannot be re-read from persistent storage', () => {
    const store = createFakeStore()
    const originalSet = store.set
    function ignoreArchiveWrites(values: Partial<DesktopStoreState>): void
    function ignoreArchiveWrites<Key extends keyof DesktopStoreState>(
      key: Key,
      value: DesktopStoreState[Key]
    ): void
    function ignoreArchiveWrites(
      keyOrValues: Partial<DesktopStoreState> | keyof DesktopStoreState,
      value?: DesktopStoreState[keyof DesktopStoreState]
    ): void {
      if (keyOrValues === 'videoNoteArchives') return
      if (typeof keyOrValues === 'object') {
        originalSet(keyOrValues)
        return
      }
      originalSet(
        keyOrValues as keyof DesktopStoreState,
        value as DesktopStoreState[keyof DesktopStoreState]
      )
    }
    store.set = ignoreArchiveWrites

    expect(() => saveVideoNoteArchiveVersionWithIdentity(
      store,
      createStoreNote(),
      '2026-06-17T00:00:00.000Z'
    )).toThrow('Archive version could not be re-read after saving.')
  })

  it('returns the newly written archive version when a queue note uses an account and part id instead of the archive id', () => {
    const store = createFakeStore()
    const first = {
      ...createStoreNote('account:42:aid:7:cid:70'),
      source: {
        ...createStoreNote().source,
        accountMid: '42',
        aid: 7,
        cid: 70,
        bvid: 'BV1queue'
      },
      transcript: [{ start: 0, end: 10, text: 'first archived transcript' }]
    }
    const second = {
      ...first,
      transcript: [{ start: 0, end: 10, text: 'second archived transcript' }],
      updatedAt: '2026-06-17T01:00:00.000Z'
    }

    const initial = saveVideoNoteArchiveVersionWithIdentity(store, first, '2026-06-17T00:00:00.000Z')
    const next = saveVideoNoteArchiveVersionWithIdentity(store, second, '2026-06-17T01:00:00.000Z')

    expect(next.archiveId).toBe(initial.archiveId)
    expect(next.versionId).not.toBe(initial.versionId)
    expect(next.archives[0]?.versions).toHaveLength(2)
    expect(next.archives[0]?.versions.find((version) => version.id === next.versionId)?.note.transcript[0]?.text)
      .toBe('second archived transcript')
  })

  it('persists a recovered DeepSeek summary into the exact existing archive version and re-reads it', () => {
    const store = createFakeStore()
    const note = {
      ...createStoreNote('account:42:aid:7:cid:70'),
      source: {
        ...createStoreNote('account:42:aid:7:cid:70').source,
        accountMid: '42', aid: 7, cid: 70, bvid: 'BV1store'
      }
    }
    const saved = saveVideoNoteArchiveVersionWithIdentity(store, note, '2026-06-17T00:00:00.000Z')

    const confirmed = saveVideoNoteArchiveSummaryWithIdentity(
      store,
      saved.archiveId,
      saved.versionId,
      note,
      'Recovered DeepSeek summary'
    )

    expect(confirmed).toMatchObject({ archiveId: saved.archiveId, versionId: saved.versionId })
    expect(loadVideoNoteArchives(store).find((archive) => archive.id === saved.archiveId)?.versions)
      .toContainEqual(expect.objectContaining({ id: saved.versionId, summaryText: 'Recovered DeepSeek summary' }))
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
  it('migrates legacy queue items without a captured model to Whisper small', () => {
    const legacy = {
      id: 'legacy', url: 'https://www.bilibili.com/video/BV1legacy', title: 'Legacy', status: 'waiting-restart',
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z'
    } as VideoAudioTranscriptionQueueItem
    const store = createFakeStore({ videoAudioTranscriptionQueue: [legacy] })

    expect(loadVideoAudioTranscriptionQueue(store)[0]).toMatchObject({ transcriptionModelId: 'whisper-small' })
  })
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

  it('keeps imported waiting-restart transcription visible across restart without turning it into pending work', () => {
    const waitingItem: VideoAudioTranscriptionQueueItem = {
      id: 'account:100:aid:1:cid:11', accountMid: '100', aid: 1, cid: 11,
      url: 'https://www.bilibili.com/video/av1?p=1', title: 'Interrupted import', status: 'waiting-restart',
      createdAt: '2026-07-24T00:00:00.000Z', updatedAt: '2026-07-24T00:01:00.000Z'
    }
    const store = createFakeStore()
    saveVideoAudioTranscriptionQueue(store, [waitingItem])

    expect(loadVideoAudioTranscriptionQueue(store)).toEqual([{ ...waitingItem, transcriptionModelId: 'whisper-small' }])
    expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([{ ...waitingItem, transcriptionModelId: 'whisper-small' }])
  })
})
