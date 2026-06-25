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
  loadVideoAudioTranscriptionQueue,
  saveVideoAudioTranscriptionQueue,
  type DesktopStoreState,
  type AssistantStoreLike
} from './store'
import type {
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
): AssistantStoreLike & { snapshot: DesktopStoreState } {
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
    preferenceCounts: initial.preferenceCounts ?? { ...DEFAULT_ASSISTANT_PREFERENCES.preferenceCounts },
    deepseekEnabled: initial.deepseekEnabled ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekEnabled,
    deepseekApiKeyStored:
      initial.deepseekApiKeyStored ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekApiKeyStored,
    deepseekModel: initial.deepseekModel ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekModel,
    deepseekBaseUrl: initial.deepseekBaseUrl ?? DEFAULT_ASSISTANT_PREFERENCES.deepseekBaseUrl,
    deepseekApiKey: initial.deepseekApiKey ?? '',
    videoNotes: initial.videoNotes ?? [],
    videoNoteArchives: initial.videoNoteArchives ?? [],
    videoAudioTranscriptionQueue: initial.videoAudioTranscriptionQueue ?? []
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
          displayName: 'Bilimi路鍏夊奖鐣欑湡'
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
      petStyle: 'classic',
      petHoverShortcuts: ['favorite', 'library', 'prepare-ledgers', 'organize-old-favorites'],
      hidePetDuringVideoFullscreen: true,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      },
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekModel: 'deepseek-reasoner',
      deepseekBaseUrl: 'https://deepseek.example'
    })

    expect(saved).toMatchObject({
      favoritesFolderName: 'Archive',
      ledgerPromptDismissed: false,
      bilibiliOperationMode: 'page-visual',
      petStyle: 'classic',
      petHoverShortcuts: ['favorite', 'library', 'prepare-ledgers', 'organize-old-favorites'],
      hidePetDuringVideoFullscreen: true,
      preferenceCounts: {
        story: 4,
        suspicious: 1
      },
      deepseekEnabled: true,
      deepseekModel: 'deepseek-reasoner',
      deepseekBaseUrl: 'https://deepseek.example'
    })
    expect(store.snapshot).toMatchObject(saved)
    expect(store.snapshot.videoNotes).toEqual([])
  })

  it('persists DeepSeek settings and keeps the key out of assistant preferences', () => {
    const store = createFakeStore()

    const saved = saveAssistantPreferences(store, {
      ...DEFAULT_ASSISTANT_PREFERENCES,
      deepseekEnabled: true,
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local'
    })

    expect(saved).toMatchObject({
      deepseekEnabled: true,
      deepseekApiKeyStored: false,
      deepseekModel: 'deepseek-chat',
      deepseekBaseUrl: 'https://api.deepseek.local'
    })
    expect(store.snapshot.deepseekApiKey).toBe('')
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

  it('saves queue items and normalizes interrupted running jobs as failed on load', () => {
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
    const store = createFakeStore()

    saveVideoAudioTranscriptionQueue(store, [runningItem, pendingItem])

    expect(store.snapshot.videoAudioTranscriptionQueue).toEqual([runningItem, pendingItem])
    expect(loadVideoAudioTranscriptionQueue(store)).toEqual([
      {
        ...runningItem,
        status: 'failed',
        errorMessage: 'Bilimi was closed before this transcription finished.'
      },
      pendingItem
    ])
  })
})
