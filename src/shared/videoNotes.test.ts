import { describe, expect, it } from 'vitest'
import { createVideoNoteId, upsertVideoNote } from './videoNotes'
import type { VideoNote } from './types'

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: createVideoNoteId({ bvid: 'BV1note', url: 'https://www.bilibili.com/video/BV1note', title: '本地札记' }),
    source: {
      title: '本地札记',
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      tags: []
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 3, text: '第一段文稿' }],
    chapters: [],
    overview: {
      shortSummary: ['第一段文稿'],
      keywords: ['文稿'],
      timeline: [],
      highlights: []
    },
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    ...overrides
  }
}

describe('video note helpers', () => {
  it('creates a stable id from bvid before falling back to url', () => {
    expect(createVideoNoteId({ bvid: 'BV1abc', url: 'https://example.test/a', title: 'A' })).toBe('bvid:BV1abc')
    expect(createVideoNoteId({ url: 'https://www.bilibili.com/video/BV1url?p=2', title: 'A', tags: [] })).toBe(
      'url:https://www.bilibili.com/video/BV1url?p=2'
    )
  })

  it('updates an existing note with the same id and keeps the original createdAt', () => {
    const existing = createNote()
    const updated = createNote({
      transcript: [{ start: 10, end: 14, text: '更新后的文稿' }],
      createdAt: '2026-04-29T00:00:00.000Z',
      updatedAt: '2026-04-29T00:00:00.000Z'
    })

    expect(upsertVideoNote([existing], updated)).toEqual([
      {
        ...updated,
        createdAt: existing.createdAt
      }
    ])
  })
})
