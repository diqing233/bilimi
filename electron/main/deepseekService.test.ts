import { describe, expect, it, vi } from 'vitest'
import { DeepSeekServiceError, generateDeepSeekResult, type DeepSeekConfig } from './deepseekService'
import type { DeepSeekGenerateRequest, VideoNote } from '../../src/shared/types'

const baseConfig: DeepSeekConfig = {
  enabled: true,
  apiKey: 'sk-test',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com'
}

function createJsonFetch(content: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    text: vi.fn().mockResolvedValue(
      JSON.stringify({
        choices: [{ message: { content } }]
      })
    )
  })
}

function createNote(): VideoNote {
  return {
    id: 'bvid:BV1deepseek',
    source: {
      title: 'DeepSeek demo',
      author: 'Author',
      description: 'A compact explanation',
      tags: ['AI'],
      url: 'https://www.bilibili.com/video/BV1deepseek'
    },
    transcriptSource: 'auto',
    transcript: [{ start: 0, end: 3, text: 'first line' }],
    chapters: [],
    overview: {
      shortSummary: ['summary'],
      keywords: ['AI'],
      timeline: [],
      highlights: []
    },
    annotations: [],
    userMemo: 'remember this',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z'
  }
}

describe('DeepSeek main service', () => {
  it('rejects missing keys as not configured', async () => {
    await expect(
      generateDeepSeekResult({
        config: { ...baseConfig, apiKey: '' },
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'hello' }]
        }
      })
    ).rejects.toMatchObject({ code: 'not-configured' })
  })

  it('parses review comment JSON into three comments', async () => {
    const fetchImpl = createJsonFetch('{"comments":["a","b","c","d"]}')

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'review-comment',
          intent: 'praise technical detail',
          title: 'Demo',
          author: 'Ada',
          description: 'About type systems',
          tags: ['typescript'],
          classification: 'knowledge'
        },
        fetchImpl
      })
    ).resolves.toEqual({ kind: 'review-comment', comments: ['a', 'b', 'c'] })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    )
  })

  it('parses note poster JSON into a summary', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        title: 'Learning Types',
        subtitle: 'Compact note',
        keyPoints: ['one', 'two'],
        keywords: ['ts'],
        prompt: 'clean poster'
      })
    )

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createNote() },
        fetchImpl
      })
    ).resolves.toEqual({
      kind: 'note-poster',
      poster: {
        title: 'Learning Types',
        subtitle: 'Compact note',
        keyPoints: ['one', 'two'],
        keywords: ['ts'],
        prompt: 'clean poster'
      }
    })
  })

  it('asks DeepSeek for a richer Chinese note summary instead of a compact poster', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        title: '机器学习入门',
        subtitle: '围绕概念、数据和训练目标展开的精读总结',
        keyPoints: [
          '先解释机器学习的基本定义，再说明它如何从样本中归纳规律。',
          '重点强调训练数据质量会直接影响模型表现和泛化上限。'
        ],
        keywords: ['机器学习', '训练数据'],
        prompt: '适合复习的 DeepSeek 结构化总结'
      })
    )

    await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('DeepSeek 视频札记总结')
    expect(systemMessage).toContain('中文')
    expect(systemMessage).toContain('更丰富')
    expect(systemMessage).toContain('更精细')
    expect(systemMessage).toContain('4 到 5 条')
    expect(systemMessage).not.toContain('compact one-image video note poster')
  })

  it('parses favorite ledger insight suggestions without replacing deterministic scanning', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        suggestions: [
          {
            sourceKind: 'tag-cluster',
            sourceName: 'AI',
            displayName: 'Bilimi·AI效率工坊',
            keywords: ['AI', '效率', '自动化'],
            reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。'
          },
          {
            sourceKind: 'author',
            sourceName: '效率研究所',
            displayName: 'Bilimi·效率研究所追更',
            keywords: ['效率研究所'],
            reason: '固定 UP 收藏集中。'
          }
        ]
      })
    )

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'favorite-ledger-insights',
          totalVideos: 8,
          topAuthors: [{ name: '效率研究所', count: 4, share: 0.5 }],
          topTags: [
            { name: 'AI', count: 5 },
            { name: '工具', count: 3 }
          ],
          topCategories: [{ name: '科技', count: 5 }],
          titleSeries: [{ name: 'AI工具效率教程', count: 4 }],
          candidates: [
            {
              kind: 'tag-cluster',
              sourceName: 'AI',
              displayName: 'Bilimi·AI工具',
              keywords: ['AI', '工具'],
              count: 5,
              confidence: 'high',
              reason: '高频标签“AI”出现 5 次，适合单独成册。',
              aiEnhanced: false
            }
          ]
        },
        fetchImpl
      })
    ).resolves.toEqual({
      kind: 'favorite-ledger-insights',
      suggestions: [
        {
          sourceKind: 'tag-cluster',
          sourceName: 'AI',
          displayName: 'Bilimi·AI效率工坊',
          keywords: ['AI', '效率', '自动化'],
          reason: 'AI、效率、工具共现明显，适合合并成一个工作流册目。'
        },
        {
          sourceKind: 'author',
          sourceName: '效率研究所',
          displayName: 'Bilimi·效率研究所追更',
          keywords: ['效率研究所'],
          reason: '固定 UP 收藏集中。'
        }
      ]
    })
  })

  it('returns a short pet chat message string', async () => {
    const fetchImpl = createJsonFetch('Thanks for sharing this page.')

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'watch this page' }]
        },
        fetchImpl
      })
    ).resolves.toEqual({ kind: 'pet-chat', message: 'Thanks for sharing this page.' })
  })

  it('teaches pet chat enough Bilimi product context to answer user questions', async () => {
    const fetchImpl = createJsonFetch('Bilimi helps you review, collect, and summarize Bilibili videos.')

    await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'bilimi 可以做什么？' }]
      },
      fetchImpl
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('Bilimi')
    expect(systemMessage).toContain('Bilibili')
    expect(systemMessage).toContain('批阅')
    expect(systemMessage).toContain('掌库')
    expect(systemMessage).toContain('札记')
    expect(systemMessage).toContain('DeepSeek')
  })

  it('maps non-OK API responses to api-error', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'hello' }]
        },
        fetchImpl: createJsonFetch('nope', false)
      })
    ).rejects.toBeInstanceOf(DeepSeekServiceError)

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'hello' }]
        },
        fetchImpl: createJsonFetch('nope', false)
      })
    ).rejects.toMatchObject({ code: 'api-error' })
  })
})
