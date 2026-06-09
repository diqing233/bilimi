import { describe, expect, it } from 'vitest'
import type { VideoNote } from '@shared/types'
import { createVideoNoteMarkdown } from './videoNoteMarkdown'

const note: VideoNote = {
  id: 'bvid:BV1note',
  source: {
    title: '机器学习入门',
    author: '李老师',
    tags: ['AI', '模型'],
    bvid: 'BV1note',
    url: 'https://www.bilibili.com/video/BV1note'
  },
  transcriptSource: 'auto',
  transcript: [
    { start: 0, end: 12, text: '先介绍机器学习的基本概念。' },
    { start: 75, end: 120, text: '再说明训练数据如何影响模型。' }
  ],
  chapters: [],
  overview: {
    shortSummary: ['三分钟讲清机器学习的基本思路。'],
    keywords: ['机器学习', '训练数据'],
    timeline: [{ start: 75, title: '数据', detail: '说明数据质量的重要性。' }],
    highlights: [{ start: 75, title: '核心提示', detail: '训练数据决定模型上限。' }]
  },
  annotations: [
    {
      id: 'annotation-1',
      start: 75,
      title: '这里要复看',
      body: '数据质量这一点可以写进报告。',
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z'
    }
  ],
  userMemo: '这条适合周会分享。',
  createdAt: '2026-06-09T00:00:00.000Z',
  updatedAt: '2026-06-09T01:00:00.000Z'
}

describe('createVideoNoteMarkdown', () => {
  it('exports source, overview, annotations, transcript, and memo', () => {
    const markdown = createVideoNoteMarkdown(note)

    expect(markdown).toContain('# 机器学习入门')
    expect(markdown).toContain('- UP：李老师')
    expect(markdown).toContain('- BV：BV1note')
    expect(markdown).toContain('## 速览')
    expect(markdown).toContain('- 三分钟讲清机器学习的基本思路。')
    expect(markdown).toContain('## 时间线')
    expect(markdown).toContain('- [01:15] 数据：说明数据质量的重要性。')
    expect(markdown).toContain('## 批注')
    expect(markdown).toContain('- [01:15] **这里要复看**：数据质量这一点可以写进报告。')
    expect(markdown).toContain('## 文稿')
    expect(markdown).toContain('- [00:00] 先介绍机器学习的基本概念。')
    expect(markdown).toContain('## 备注')
    expect(markdown).toContain('这条适合周会分享。')
  })

  it('keeps export readable when optional fields are missing', () => {
    const markdown = createVideoNoteMarkdown({
      ...note,
      source: { title: '无 BV 视频', tags: [], url: 'https://example.test/video' },
      annotations: [],
      userMemo: ''
    })

    expect(markdown).toContain('- UP：未署名')
    expect(markdown).toContain('- BV：未识别')
    expect(markdown).toContain('暂无批注。')
    expect(markdown).toContain('暂无备注。')
  })
})
