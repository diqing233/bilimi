import { describe, expect, it } from 'vitest'
import type { VideoNote, VideoNoteAnnotation } from '@shared/types'
import {
  removeVideoNoteAnnotation,
  saveVideoNoteAnnotation,
  sortVideoNoteAnnotations
} from './videoNoteAnnotations'

const baseNote: VideoNote = {
  id: 'bvid:BV1note',
  source: { title: '札记视频', tags: [], bvid: 'BV1note', url: 'https://example.test' },
  transcriptSource: 'auto',
  transcript: [],
  chapters: [],
  overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
  annotations: [],
  userMemo: '',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

const annotation: VideoNoteAnnotation = {
  id: 'annotation-1',
  start: 90,
  title: '重点',
  body: '这段要复看。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z'
}

describe('video note annotations', () => {
  it('adds annotations and sorts timed notes before untimed notes', () => {
    const note = saveVideoNoteAnnotation(
      { ...baseNote, annotations: [{ ...annotation, id: 'annotation-2', start: null }] },
      annotation,
      '2026-06-09T01:00:00.000Z'
    )

    expect(note.annotations.map((item) => item.id)).toEqual(['annotation-1', 'annotation-2'])
    expect(note.updatedAt).toBe('2026-06-09T01:00:00.000Z')
  })

  it('updates an existing annotation and preserves createdAt', () => {
    const note = saveVideoNoteAnnotation(
      { ...baseNote, annotations: [annotation] },
      { ...annotation, title: '更新后的重点', body: '新的正文' },
      '2026-06-09T02:00:00.000Z'
    )

    expect(note.annotations[0]).toEqual({
      ...annotation,
      title: '更新后的重点',
      body: '新的正文',
      updatedAt: '2026-06-09T02:00:00.000Z'
    })
    expect(note.annotations[0].createdAt).toBe(annotation.createdAt)
  })

  it('removes an annotation by id', () => {
    const note = removeVideoNoteAnnotation(
      { ...baseNote, annotations: [annotation] },
      'annotation-1',
      '2026-06-09T03:00:00.000Z'
    )

    expect(note.annotations).toEqual([])
    expect(note.updatedAt).toBe('2026-06-09T03:00:00.000Z')
  })

  it('sorts annotations by time and keeps untimed annotations last', () => {
    expect(
      sortVideoNoteAnnotations([
        { ...annotation, id: 'untimed', start: null },
        { ...annotation, id: 'late', start: 120 },
        { ...annotation, id: 'early', start: 5 }
      ]).map((item) => item.id)
    ).toEqual(['early', 'late', 'untimed'])
  })
})
