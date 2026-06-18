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
    expect(note.annotations).toEqual([])
  })

  it('creates a study-oriented overview from transcript chapters', () => {
    const note = createLocalVideoNoteDraft({
      now: '2026-06-17T10:00:00.000Z',
      source: {
        title: '如何建立个人知识库',
        author: 'UP 主',
        description: '讲解收集、整理、复习和输出知识的方法',
        tags: ['学习方法', '知识管理'],
        bvid: 'BVstudy',
        url: 'https://www.bilibili.com/video/BVstudy'
      },
      transcriptSource: 'audio',
      transcript: [
        { start: 0, end: 12, text: '个人知识库的目标不是收藏更多资料，而是让资料能被复用。' },
        { start: 15, end: 28, text: '收集时要记录来源、问题和使用场景，避免只保存链接。' },
        { start: 85, end: 96, text: '整理时按照主题和项目建立索引，让内容能被快速找回。' },
        { start: 150, end: 164, text: '复习时用问题检查理解，把关键结论改写成自己的表达。' }
      ]
    })

    expect(note.overview.shortSummary).toEqual([
      '一句话：个人知识库的目标不是收藏更多资料，而是让资料能被复用。',
      '核心要点：个人知识库的目标不是收藏更多资料，而是让资料能被复用。',
      '核心要点：整理时按照主题和项目建立索引，让内容能被快速找回。',
      '值得复看：个人知识库的目标不是收藏更多资料，而是让资料能被复用。',
      '待查问题：这些方法如何迁移到你的真实项目里？'
    ])
    expect(note.overview.highlights).toEqual([
      expect.objectContaining({
        start: 0,
        title: '值得复看',
        detail: '个人知识库的目标不是收藏更多资料，而是让资料能被复用。'
      }),
      expect.objectContaining({
        start: 85,
        title: '值得复看',
        detail: '整理时按照主题和项目建立索引，让内容能被快速找回。'
      })
    ])
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

    expect(note.overview.shortSummary).toEqual(['尚未取得文稿，可先转写音频后再整理。'])
    expect(note.chapters).toEqual([])
  })
})
