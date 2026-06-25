import { describe, expect, it } from 'vitest'
import type { VideoNote, VideoNoteArchiveEntry } from './types'
import {
  appendVideoNoteArchiveVersion,
  createPlainTranscriptText,
  createSummaryText,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  searchVideoNoteArchives,
  updateVideoNoteArchiveVersion
} from './videoNoteArchive'
import { createVideoNoteId } from './videoNotes'

function createNote(overrides: Partial<VideoNote> = {}): VideoNote {
  return {
    id: createVideoNoteId({ bvid: 'BV1note', url: 'https://www.bilibili.com/video/BV1note' }),
    source: {
      title: '机器学习入门',
      author: '李老师',
      bvid: 'BV1note',
      url: 'https://www.bilibili.com/video/BV1note',
      tags: ['AI']
    },
    transcriptSource: 'audio',
    transcript: [
      { start: 0, end: 12, text: '先介绍机器学习的基本概念。' },
      { start: 75, end: 120, text: '再说明训练数据如何影响模型。' }
    ],
    chapters: [],
    overview: {
      shortSummary: ['一句话：三分钟讲清机器学习的基本思路。', '核心要点：训练数据决定模型上限。'],
      keywords: ['机器学习', '训练数据'],
      timeline: [
        { start: 0, title: '开场', detail: '解释机器学习为什么有用。' },
        { start: 75, title: '数据', detail: '说明数据质量的重要性。' }
      ],
      highlights: [
        { start: 75, title: '值得复看', detail: '训练数据决定模型上限。' }
      ]
    },
    annotations: [],
    userMemo: '',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    ...overrides
  }
}

describe('video note archive helpers', () => {
  it('creates copyable plain transcript text without timestamps', () => {
    expect(createPlainTranscriptText(createNote())).toBe(
      '先介绍机器学习的基本概念。\n\n再说明训练数据如何影响模型。'
    )
  })

  it('creates copyable summary text from the overview', () => {
    expect(createSummaryText(createNote())).toContain('## 速览')
    expect(createSummaryText(createNote())).toContain('- 一句话：三分钟讲清机器学习的基本思路。')
    expect(createSummaryText(createNote())).toContain('关键词：机器学习、训练数据')
    expect(createSummaryText(createNote())).toContain('- [01:15] 数据：说明数据质量的重要性。')
  })

  it('appends versions to the same video archive by bvid', () => {
    const firstNote = createNote()
    const secondNote = createNote({
      updatedAt: '2026-06-17T01:00:00.000Z',
      transcript: [{ start: 4, end: 8, text: '第二次转写的正文。' }]
    })

    const afterFirst = appendVideoNoteArchiveVersion([], firstNote, '2026-06-17T00:00:00.000Z')
    const afterSecond = appendVideoNoteArchiveVersion(afterFirst, secondNote, '2026-06-17T01:00:00.000Z')

    expect(afterSecond).toHaveLength(1)
    expect(afterSecond[0].versions).toHaveLength(2)
    expect(afterSecond[0].versions[1]).toEqual(
      expect.objectContaining({
        plainTranscript: '第二次转写的正文。',
        summaryText: ''
      })
    )
  })

  it('stores explicit DeepSeek summary text when appending an archive version', () => {
    const archives = appendVideoNoteArchiveVersion(
      [],
      createNote(),
      '2026-06-17T00:00:00.000Z',
      'DeepSeek summary text'
    )

    expect(archives[0].versions[0].summaryText).toBe('DeepSeek summary text')
  })

  it('searches title, author, bvid, transcript and summary text', () => {
    const archives = appendVideoNoteArchiveVersion([], createNote(), '2026-06-17T00:00:00.000Z')

    expect(searchVideoNoteArchives(archives, { query: '李老师' })).toHaveLength(1)
    expect(searchVideoNoteArchives(archives, { query: 'BV1note' })).toHaveLength(1)
    expect(searchVideoNoteArchives(archives, { query: '训练数据' })).toHaveLength(1)
    expect(searchVideoNoteArchives(archives, { query: '不存在' })).toHaveLength(0)
  })

  it('filters archives with memo and starred notes', () => {
    const archives = appendVideoNoteArchiveVersion(
      [],
      createNote({
        userMemo: '准备复习。',
        starred: true
      }),
      '2026-06-17T00:00:00.000Z'
    )

    expect(searchVideoNoteArchives(archives, { query: '', hasMemo: true })).toHaveLength(1)
    expect(searchVideoNoteArchives(archives, { query: '', hasStarred: true })).toHaveLength(1)
  })

  it('deletes archive entries and individual versions', () => {
    const archives = appendVideoNoteArchiveVersion(
      appendVideoNoteArchiveVersion([], createNote(), '2026-06-17T00:00:00.000Z'),
      createNote({ updatedAt: '2026-06-17T01:00:00.000Z' }),
      '2026-06-17T01:00:00.000Z'
    )
    const archiveId = archives[0].id
    const versionId = archives[0].versions[0].id

    expect(deleteVideoNoteArchiveVersion(archives, archiveId, versionId)[0].versions).toHaveLength(1)
    expect(deleteVideoNoteArchiveEntry(archives, archiveId)).toEqual([])
  })

  it('updates an existing archive version without appending a new transcription', () => {
    const archives = appendVideoNoteArchiveVersion([], createNote(), '2026-06-17T00:00:00.000Z')
    const updatedNote = {
      ...archives[0].versions[0].note,
      annotations: [
        {
          id: 'annotation-1',
          start: null,
          title: '复看',
          body: '这里需要补充例子。',
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T00:00:00.000Z'
        }
      ],
      userMemo: '周末复习',
      starred: true,
      updatedAt: '2026-06-18T00:00:00.000Z'
    }

    const updated = updateVideoNoteArchiveVersion(
      archives,
      archives[0].id,
      archives[0].versions[0].id,
      updatedNote
    )

    expect(updated[0].versions).toHaveLength(1)
    expect(updated[0].versions[0].note).toMatchObject({
      annotations: [expect.objectContaining({ title: '复看' })],
      userMemo: '周末复习',
      starred: true
    })
    expect(searchVideoNoteArchives(updated, { query: '', hasMemo: true })).toHaveLength(1)
    expect(searchVideoNoteArchives(updated, { query: '', hasStarred: true })).toHaveLength(1)
  })

  it('normalizes legacy archive entries with usable versions', () => {
    const note = createNote()
    const legacyArchive = {
      id: 'bvid:BV1note',
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

    expect(searchVideoNoteArchives([legacyArchive], { query: '基本概念' })[0].versions[0]).toEqual(
      expect.objectContaining({
        plainTranscript: expect.stringContaining('基本概念'),
        summaryText: expect.stringContaining('速览')
      })
    )
  })
})
