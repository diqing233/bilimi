import { describe, expect, it } from 'vitest'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult,
  normalizeSubtitleBody
} from './videoNoteExtractor'

describe('videoNoteExtractor', () => {
  it('builds a read-only script for current video metadata and subtitle discovery', () => {
    const script = buildVideoNoteExtractionScript()

    expect(script).toContain('document.querySelector')
    expect(script).toContain('window.__INITIAL_STATE__')
    expect(script).toContain('subtitle')
    expect(script).not.toContain('localStorage.setItem')
    expect(script).not.toContain('document.cookie')
  })

  it('normalizes bilibili subtitle body items into transcript segments', () => {
    expect(
      normalizeSubtitleBody({
        body: [
          { from: 0.5, to: 2.25, content: ' 开场白 ' },
          { from: 3, to: 4.5, content: '核心观点' },
          { from: 5, to: 7, content: '' }
        ]
      })
    ).toEqual([
      { start: 0.5, end: 2.25, text: '开场白' },
      { start: 3, end: 4.5, text: '核心观点' }
    ])
  })

  it('normalizes raw page extraction into a safe result shape', () => {
    expect(
      normalizeExtractedVideoNoteResult({
        title: '视频标题 - 哔哩哔哩',
        author: 'UP 主',
        description: '简介',
        tags: ['知识', '教程', '知识'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note',
        transcript: [{ start: 1, end: 3, text: '字幕内容' }]
      })
    ).toEqual({
      source: {
        title: '视频标题',
        author: 'UP 主',
        description: '简介',
        tags: ['知识', '教程'],
        bvid: 'BV1note',
        url: 'https://www.bilibili.com/video/BV1note'
      },
      transcript: [{ start: 1, end: 3, text: '字幕内容' }],
      transcriptSource: 'auto'
    })
  })
})
