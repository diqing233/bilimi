import { describe, expect, it } from 'vitest'
import { createLocalVideoNoteDraft } from './videoNoteSummarizer'

describe('videoNoteSummarizer', () => {
  it('creates local overview, timeline, and keywords from transcript text', () => {
    const note = createLocalVideoNoteDraft({
      now: '2026-04-28T10:00:00.000Z',
      source: {
        title: '机器学习入门教程',
        author: 'UP 主',
        description: '从模型、训练、数据讲清楚机器学习',
        tags: ['教程', '机器学习'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note'
      },
      transcriptSource: 'auto',
      transcript: [
        { start: 0, end: 8, text: '机器学习需要数据和模型。' },
        { start: 10, end: 18, text: '训练过程会不断调整参数。' },
        { start: 85, end: 96, text: '最后用测试数据验证效果。' }
      ]
    })

    expect(note.id).toBe('bvid:BV1note')
    expect(note.overview.shortSummary.length).toBeGreaterThan(0)
    expect(note.overview.keywords).toContain('机器学习')
    expect(note.overview.timeline).toEqual([
      expect.objectContaining({ start: 0 }),
      expect.objectContaining({ start: 85 })
    ])
    expect(note.transcript).toHaveLength(3)
  })

  it('creates an empty-note explanation when no transcript exists', () => {
    const note = createLocalVideoNoteDraft({
      now: '2026-04-28T10:00:00.000Z',
      source: {
        title: '无字幕视频',
        tags: [],
        url: 'https://www.bilibili.com/video/BVempty'
      },
      transcriptSource: 'manual',
      transcript: []
    })

    expect(note.overview.shortSummary).toEqual(['尚未取得文稿，可粘贴文稿后再整理。'])
    expect(note.chapters).toEqual([])
  })
})
