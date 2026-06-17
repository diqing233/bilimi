import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSISTANT_PREFERENCES,
  loadVideoNotes,
  loadVideoNoteArchives,
  loadAssistantPreferences,
  saveVideoNoteArchiveVersion,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  saveVideoNote,
  saveAssistantPreferences,
  type DesktopStoreState,
  type AssistantStoreLike
} from './store'
import type { VideoNote, VideoNoteArchiveEntry } from '../../src/shared/types'

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
    preferenceCounts: initial.preferenceCounts ?? { ...DEFAULT_ASSISTANT_PREFERENCES.preferenceCounts },
    videoNotes: initial.videoNotes ?? [],
    videoNoteArchives: initial.videoNoteArchives ?? []
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
      petStyle: 'classic',
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })

    expect(saved).toMatchObject({
      favoritesFolderName: 'Archive',
      ledgerPromptDismissed: false,
      petStyle: 'classic',
      preferenceCounts: {
        story: 4,
        suspicious: 1
      }
    })
    expect(store.snapshot).toMatchObject(saved)
    expect(store.snapshot.videoNotes).toEqual([])
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
