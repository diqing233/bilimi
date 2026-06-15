import { describe, expect, it } from 'vitest'
import { createVideoNoteId, normalizeVideoNote, upsertVideoNote } from './videoNotes'
import type { VideoNote, VideoNoteAnnotation } from './types'

const sampleAnnotation: VideoNoteAnnotation = {
  id: 'annotation-1',
  start: 75,
  title: '数据质量',
  body: '这一段解释了训练数据为什么重要。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: createVideoNoteId({ bvid: 'BV1note', url: 'https://www.bilibili.com/video/BV1note' }),
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
    annotations: [],
    userMemo: '',
    createdAt: '2026-04-28T00:00:00.000Z',
    updatedAt: '2026-04-28T00:00:00.000Z',
    ...overrides
  }
}

describe('video note helpers', () => {
  it('creates a stable id from bvid before falling back to url', () => {
    expect(createVideoNoteId({ bvid: 'BV1abc', url: 'https://example.test/a' })).toBe('bvid:BV1abc')
    expect(createVideoNoteId({ url: 'https://www.bilibili.com/video/BV1url?p=2' })).toBe(
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

  it('normalizes legacy notes with an empty annotations list', () => {
    const legacyNote = createNote()
    delete (legacyNote as Partial<VideoNote>).annotations

    expect(normalizeVideoNote(legacyNote as VideoNote).annotations).toEqual([])
  })

  it('keeps audio transcript source when normalizing notes', () => {
    const note = createNote({ transcriptSource: 'audio' })

    expect(normalizeVideoNote(note).transcriptSource).toBe('audio')
  })

  it('keeps annotations when updating an existing note', () => {
    const existing = createNote({ annotations: [sampleAnnotation] })
    const updated = createNote({
      id: existing.id,
      annotations: [
        {
          ...sampleAnnotation,
          id: 'annotation-2',
          title: '模型上限'
        }
      ],
      updatedAt: '2026-06-09T01:00:00.000Z'
    })

    expect(upsertVideoNote([existing], updated)).toEqual([
      {
        ...updated,
        createdAt: existing.createdAt
      }
    ])
  })
})
