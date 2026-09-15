import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { Packer } from 'docx'
import type { VideoNote, VideoNoteArchiveEntry } from './types'
import { createVideoNoteMarkdown, createVideoNoteWord } from './videoNoteExport'

function createNote(): VideoNote {
  return {
    id: 'bvid:BV1export',
    source: {
      accountMid: '42',
      title: 'Export title',
      author: 'Author',
      description: 'Saved description',
      tags: ['tag-a', 'tag-b'],
      bvid: 'BV1export',
      url: 'https://www.bilibili.com/video/BV1export?spm_id_from=333.1'
    },
    transcriptSource: 'audio',
    transcript: [
      { start: 75.8, end: 80, text: 'Timed text' },
      { start: null, end: null, text: 'Untimed text' }
    ],
    chapters: [],
    overview: { shortSummary: [], keywords: [], timeline: [], highlights: [] },
    annotations: [{
      id: 'note-1', start: 10, title: 'Private note', body: 'Do not export by default',
      createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z'
    }],
    userMemo: 'Private memo',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  }
}

function createArchive(): VideoNoteArchiveEntry {
  const note = createNote()
  return {
    id: note.id,
    source: note.source,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    versions: [{
      id: 'version-1',
      note,
      plainTranscript: 'Plain transcript',
      summaryText: '',
      createdAt: note.createdAt
    }]
  }
}

describe('video note Markdown export', () => {
  it('exports current saved content with a floored Bilibili timestamp link', () => {
    const archive = createArchive()

    const markdown = createVideoNoteMarkdown({
      archive,
      version: archive.versions[0],
      scope: 'current',
      currentContent: 'timed'
    })

    expect(markdown).toContain('# Export title')
    expect(markdown).toContain('[01:15](https://www.bilibili.com/video/BV1export?spm_id_from=333.1&t=75) Timed text')
    expect(markdown).not.toContain('Plain transcript')
    expect(markdown).not.toContain('Private memo')
    expect(markdown).not.toContain('Private note')
  })

  it('exports complete saved archive content with a missing-summary section and optional notes', () => {
    const archive = createArchive()

    const withoutNotes = createVideoNoteMarkdown({ archive, version: archive.versions[0], scope: 'complete' })
    const withNotes = createVideoNoteMarkdown({
      archive,
      version: archive.versions[0],
      scope: 'complete',
      includeNotes: true
    })

    expect(withoutNotes).toContain('Saved description')
    expect(withoutNotes).toContain('tag-a, tag-b')
    expect(withoutNotes).toContain('Plain transcript')
    expect(withoutNotes).toContain('\u6682\u65e0\u751f\u6210')
    expect(withoutNotes).not.toContain('Private memo')
    expect(withoutNotes).not.toContain('Private note')
    expect(withNotes).toContain('Private memo')
    expect(withNotes).toContain('Private note')
  })

  it('exports legacy DeepSeek archives without internal proofreading records', () => {
    const archive = createArchive()
    archive.versions[0].summaryText = [
      '## 精准总结', '', '旧总结。', '', '## 精修文稿', '', '旧精修。', '',
      '## 内容核对清单', '', '- 原始测试条件。', '', '精修记录：', '- segment-1：甲 → 乙'
    ].join('\n')

    const markdown = createVideoNoteMarkdown({ archive, version: archive.versions[0], scope: 'current', currentContent: 'summary' })
    expect(markdown).toContain('## 详细内容提要')
    expect(markdown).toContain('- 原始测试条件。')
    expect(markdown).not.toContain('精修记录')
    expect(markdown).not.toContain('segment-1')
  })

  it('exports each DeepSeek section as an independent current item and can append notes', () => {
    const archive = createArchive()
    archive.versions[0].summaryText = [
      '## 精准总结', '', '一句精准总结。', '',
      '## 详细内容提要', '', '- 第一项细节。', '',
      '## 精修文稿', '', '自然分段的精修文稿。'
    ].join('\n')

    const precise = createVideoNoteMarkdown({ archive, version: archive.versions[0], scope: 'current', currentContent: 'summary-precise' })
    const outline = createVideoNoteMarkdown({ archive, version: archive.versions[0], scope: 'current', currentContent: 'summary-outline' })
    const polished = createVideoNoteMarkdown({ archive, version: archive.versions[0], scope: 'current', currentContent: 'summary-polished', includeNotes: true })

    expect(precise).toContain('一句精准总结。')
    expect(precise).not.toContain('第一项细节。')
    expect(outline).toContain('第一项细节。')
    expect(outline).not.toContain('自然分段的精修文稿。')
    expect(polished).toContain('自然分段的精修文稿。')
    expect(polished).toContain('Private memo')
  })
})

describe('video note Word export', () => {
  it('creates a Word document from complete saved content and keeps notes opt-in', async () => {
    const archive = createArchive()
    const document = createVideoNoteWord({ archive, version: archive.versions[0], scope: 'complete' })
    const buffer = await Packer.toBuffer(document)
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')

    expect(buffer.subarray(0, 2).toString()).toBe('PK')
    expect(xml).toContain('Export title')
    expect(xml).toContain('Plain transcript')
    expect(xml).toContain('\u6682\u65e0\u751f\u6210')
    expect(xml).not.toContain('Private memo')
    expect(xml).not.toContain('Private note')
  })
})
