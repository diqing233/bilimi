import { describe, expect, it } from 'vitest'
import type { VideoNote, VideoNoteArchiveEntry } from './types'
import {
  appendVideoNoteArchiveVersion,
  createNotePosterCopyParts,
  normalizeNotePosterTextForDisplay,
  createNotePosterText,
  createPlainTranscriptText,
  createSummaryText,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  normalizeVideoNoteArchives,
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
  it('puts every non-empty transcription fragment on its own line without inventing punctuation', () => {
    const note = createNote({
      transcript: [
        { start: 0, end: 2, text: '今天我们测试手机续航' },
        { start: 2.2, end: 4, text: '  ' },
        { start: 4.2, end: 6, text: '先说明测试条件' },
        { start: 6.2, end: 8, text: '再公布实测结果' }
      ]
    })

    expect(createPlainTranscriptText(note)).toBe(
      '今天我们测试手机续航\n先说明测试条件\n再公布实测结果'
    )
  })

  it('preserves punctuation already present in transcription fragments', () => {
    const note = createNote({
      transcript: [
        { start: 0, end: 2, text: '今天我们测试手机续航。' },
        { start: 2.2, end: 4, text: '结果符合预期！' },
        { start: 4.2, end: 6, text: '下一项继续测试' }
      ]
    })

    expect(createPlainTranscriptText(note)).toBe('今天我们测试手机续航。\n结果符合预期！\n下一项继续测试')
  })

  it('recreates saved plain transcripts from source fragments when reading old archives', () => {
    const note = createNote({
      transcript: [
        { start: 0, end: 2, text: '第一句' },
        { start: 2.2, end: 4, text: '第二句' }
      ]
    })
    const archive: VideoNoteArchiveEntry = {
      id: 'archive-1',
      source: note.source,
      versions: [{ id: 'version-1', note, plainTranscript: '旧格式', summaryText: '', createdAt: note.createdAt }],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    }

    expect(normalizeVideoNoteArchives([archive])[0].versions[0].plainTranscript).toBe('第一句\n第二句')
  })

  it('creates copyable plain transcript text without timestamps', () => {
    expect(createPlainTranscriptText(createNote())).toBe(
      '先介绍机器学习的基本概念。\n再说明训练数据如何影响模型。'
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

  it('assigns a unique persistent version id when the same timestamp is appended twice', () => {
    const note = createNote()
    const createdAt = '2026-06-17T00:00:00.000Z'
    const afterFirst = appendVideoNoteArchiveVersion([], note, createdAt)
    const afterSecond = appendVideoNoteArchiveVersion(afterFirst, note, createdAt)

    expect(afterSecond[0].versions.map((version) => version.id)).toEqual([
      `${note.id}:version:${createdAt}`,
      `${note.id}:version:${createdAt}:2`
    ])
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

  it('formats DeepSeek output with summary first and polished transcript below', () => {
    const text = createNotePosterText({
      title: '机器学习入门',
      subtitle: '整体主旨：用数据和模型解释机器学习。',
      keyPoints: ['核心内容：训练数据影响模型表现。'],
      keywords: ['机器学习', '训练数据'],
      prompt: '',
      polishedTranscriptText: '## 精修文稿\n\n先介绍机器学习的基本概念。',
      auditChecklistText: '- 数据：训练数据\n- 结论：数据质量影响模型'
    })

    expect(text).toContain('## 精准总结')
    expect(text).toContain('机器学习入门')
    expect(text).toContain('- 核心内容：训练数据影响模型表现。')
    expect(text).not.toContain('关键词：')
    expect(text).toContain('## 精修文稿')
    expect(text).toContain('先介绍机器学习的基本概念。')
    expect(text).toContain('## 详细内容提要')
    expect(text).toContain('- 数据：训练数据')
    expect(text.indexOf('## 精准总结')).toBeLessThan(text.indexOf('## 精修文稿'))
  })

  it('uses the unified summary structure while retaining legacy checklist archives', () => {
    const text = createNotePosterText({
      title: '测试条件复盘',
      subtitle: '讲者比较两种方案的测试结果。',
      keyPoints: ['方案 A 在 25 摄氏度的测试中更稳定。'],
      keywords: ['测试'],
      prompt: 'unused',
      detailedOutline: ['先说明测试条件。', '再比较方案 A 与方案 B。'],
      polishedTranscriptText: '保真精修文稿。',
      reviewItems: [{ text: 'X200 型号', reason: '型号读音不确定' }]
    })

    expect(text).toContain('## 精准总结')
    expect(text).toContain('## 详细内容提要')
    expect(text).toContain('- 先说明测试条件。')
    expect(text).toContain('## 精修文稿')
    expect(text).toContain('待确认：X200 型号（型号读音不确定）')
    expect(text).not.toContain('## 待人工确认')
    expect(text).not.toContain('segment-')
    expect(text).not.toContain('精修记录')

    const legacy = createNotePosterCopyParts([
      '## 精准总结', '', '旧总结仍在。', '', '## 精修文稿', '', '旧精修文稿。', '',
      '## 内容核对清单', '', '- 旧档案细节。', '', '精修记录：', '- segment-1：甲 → 乙'
    ].join('\n'))
    expect(legacy.summaryText).toContain('旧总结仍在。')
    expect(legacy.summaryText).toContain('## 详细内容提要')
    expect(legacy.summaryText).toContain('- 旧档案细节。')
    expect(legacy.summaryText).not.toContain('精修记录')
    expect(legacy.polishedTranscriptText).toBe('旧精修文稿。')
    expect(normalizeNotePosterTextForDisplay([
      '## 精准总结', '', '旧总结仍在。', '', '## 精修文稿', '', '旧精修文稿。', '',
      '## 内容核对清单', '', '- 旧档案细节。', '', '精修记录：', '- segment-1：甲 → 乙'
    ].join('\n'))).toEqual([
      '## 精准总结', '', '旧总结仍在。', '', '## 详细内容提要', '', '- 旧档案细节。', '',
      '## 精修文稿', '', '旧精修文稿。'
    ].join('\n'))
  })

  it('removes legacy segment identifiers from manual-review display text', () => {
    const normalized = normalizeNotePosterTextForDisplay([
      '## 精准总结', '', '旧总结仍在。', '',
      '## 待人工确认（1）', '', '- segment-2：X200 型号（读音不确定）'
    ].join('\n'))

    expect(normalized).toContain('X200 型号（读音不确定）')
    expect(normalized).not.toContain('segment-')
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
