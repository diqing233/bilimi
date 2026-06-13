import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildVideoNoteExtractionScript,
  normalizeExtractedVideoNoteResult,
  normalizeSubtitleBody
} from './videoNoteExtractor'

describe('videoNoteExtractor', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

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

  it('fetches subtitle candidate JSON instead of using page subtitle DOM', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        body: [
          { from: 0, to: 3, content: '完整字幕第一句' },
          { from: 3, to: 7, content: '完整字幕第二句' }
        ]
      })
    })
    vi.stubGlobal('fetch', fetch)
    Object.defineProperty(window, '__INITIAL_STATE__', {
      configurable: true,
      value: {
        videoData: {
          title: '完整字幕视频',
          bvid: 'BV1full',
          subtitle: {
            list: [{ subtitle_url: 'https://subtitle.test/BV1full.json' }]
          }
        }
      }
    })
    document.body.innerHTML = '<span class="bpx-player-subtitle-panel-text">当前可见字幕</span>'

    const result = await window.eval(buildVideoNoteExtractionScript())

    expect(fetch).toHaveBeenCalledWith('https://subtitle.test/BV1full.json', expect.objectContaining({ credentials: 'include' }))
    expect(result.transcript).toEqual([
      { start: 0, end: 3, text: '完整字幕第一句' },
      { start: 3, end: 7, text: '完整字幕第二句' }
    ])
  })

  it('does not use subtitle settings DOM as transcript when no subtitle JSON is available', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    Object.defineProperty(window, '__INITIAL_STATE__', {
      configurable: true,
      value: {
        videoData: {
          title: 'Subtitle settings video',
          bvid: 'BVsettings'
        }
      }
    })
    document.body.innerHTML = `
      <div class="bpx-player-subtitle-setting">
        Subtitle Off Login can enjoy original translation feedback Add subtitles Off
      </div>
      <button class="subtitle-language-item">English</button>
    `

    const result = await window.eval(buildVideoNoteExtractionScript())

    expect(fetch).not.toHaveBeenCalled()
    expect(result.transcript).toEqual([])
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
        transcript: [{ start: 1, end: 3, text: ' 字幕内容 ', index: 7 }]
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

  it('uses manual transcript source when extracted transcript only contains blank text', () => {
    expect(
      normalizeExtractedVideoNoteResult({
        title: '空白字幕视频',
        url: 'https://www.bilibili.com/video/BV1blank',
        transcript: [{ start: 1, end: 3, text: '   ' }]
      })
    ).toEqual({
      source: {
        title: '空白字幕视频',
        author: '',
        description: '',
        tags: [],
        bvid: '',
        url: 'https://www.bilibili.com/video/BV1blank'
      },
      transcript: [],
      transcriptSource: 'manual'
    })
  })
})
