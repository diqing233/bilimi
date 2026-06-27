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

function createLongTranscriptNote(): VideoNote {
  return {
    ...createNote(),
    transcript: Array.from({ length: 36 }, (_, index) => ({
      start: index * 10,
      end: index * 10 + 8,
      text:
        index === 35
          ? 'final transcript detail about the closing argument and concrete takeaway'
          : `transcript segment ${index + 1} with useful context`
    }))
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

  it('parses note poster JSON into a summary with polished transcript and checklist', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        title: 'Learning Types',
        subtitle: 'Compact note',
        keyPoints: [
          '类型系统先定义数据结构和约束，再帮助开发者在编译阶段发现错误。',
          '示例代码说明泛型可以保留输入输出关系，减少运行时类型判断。'
        ],
        keywords: ['ts'],
        prompt: 'clean poster',
        polishedTranscriptText: '## 精修文稿\n\n完整文稿正文。',
        auditChecklistText: '- 人物：讲者\n- 观点：类型系统'
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
        keyPoints: [
          '类型系统先定义数据结构和约束，再帮助开发者在编译阶段发现错误。',
          '示例代码说明泛型可以保留输入输出关系，减少运行时类型判断。'
        ],
        keywords: ['ts'],
        prompt: 'clean poster',
        polishedTranscriptText: '## 精修文稿\n\n完整文稿正文。',
        auditChecklistText: '- 人物：讲者\n- 观点：类型系统'
      }
    })
  })

  it('asks DeepSeek to polish the transcript before creating a faithful Chinese summary', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        title: '机器学习入门',
        subtitle: '围绕概念、数据和训练目标展开的精读总结',
        keyPoints: [
          '先解释机器学习的基本定义，再说明它如何从样本中归纳规律。',
          '重点强调训练数据质量会直接影响模型表现和泛化上限。'
        ],
        keywords: ['机器学习', '训练数据'],
        prompt: '适合复习的 DeepSeek 结构化总结',
        polishedTranscriptText: '## 精修文稿\n\n完整保留文稿。',
        auditChecklistText: '- 数据：训练数据\n- 结论：模型表现受数据影响'
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
    expect(systemMessage).toContain('第一阶段')
    expect(systemMessage).toContain('精修文稿')
    expect(systemMessage).toContain('第二阶段')
    expect(systemMessage).toContain('精准总结')
    expect(systemMessage).toContain('尽量信息不失真')
    expect(systemMessage).toContain('内容核对清单')
    expect(systemMessage).toContain('polishedTranscriptText')
    expect(systemMessage).toContain('auditChecklistText')
    expect(systemMessage).not.toContain('compact one-image video note poster')
  })

  it('sends broad transcript context so DeepSeek can summarize without dropping late details', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        title: 'Long lecture',
        subtitle: 'A faithful study summary',
        keyPoints: [
          'point 1 includes enough reasoning and context for review',
          'point 2 includes enough reasoning and context for review',
          'point 3 includes enough reasoning and context for review',
          'point 4 includes enough reasoning and context for review',
          'point 5 includes enough reasoning and context for review',
          'point 6 includes enough reasoning and context for review',
          'point 7 includes enough reasoning and context for review',
          'point 8 includes enough reasoning and context for review'
        ],
        keywords: ['lecture'],
        prompt: 'study card',
        polishedTranscriptText: '## Polished transcript\n\nFull transcript text.',
        auditChecklistText: '- detail: closing argument'
      })
    )

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createLongTranscriptNote() },
        fetchImpl
      })
    ).resolves.toMatchObject({
      kind: 'note-poster',
      poster: {
        keyPoints: [
          'point 1 includes enough reasoning and context for review',
          'point 2 includes enough reasoning and context for review',
          'point 3 includes enough reasoning and context for review',
          'point 4 includes enough reasoning and context for review',
          'point 5 includes enough reasoning and context for review',
          'point 6 includes enough reasoning and context for review',
          'point 7 includes enough reasoning and context for review',
          'point 8 includes enough reasoning and context for review'
        ],
        polishedTranscriptText: '## Polished transcript\n\nFull transcript text.',
        auditChecklistText: '- detail: closing argument'
      }
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const userMessage = body.messages.find((message) => message.role === 'user')?.content ?? ''

    expect(userMessage).toContain('transcript segment 1 with useful context')
    expect(userMessage).toContain('final transcript detail about the closing argument')
  })

  it('rejects shallow note summaries that omit polished transcript or useful detail', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createNote() },
        fetchImpl: createJsonFetch(
          JSON.stringify({
            title: '世界树很大',
            subtitle: '注意看前面这棵很高大的树',
            keyPoints: ['注意看前面这棵树', '我现在的位置在城堡', '注意看前面这棵树'],
            keywords: ['好了', '世界树'],
            prompt: ''
          })
        )
      })
    ).rejects.toMatchObject({ code: 'invalid-output' })

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createNote() },
        fetchImpl: createJsonFetch(
          JSON.stringify({
            title: '世界树很大',
            subtitle: '注意看前面这棵很高大的树',
            keyPoints: [
              '这一条稍微长一点但仍然没有提供足够的信息密度',
              '另一条也只是重复画面描述，没有整理出有效内容'
            ],
            keywords: ['世界树'],
            prompt: '',
            polishedTranscriptText: '注意看前面这棵很高大的树。',
            auditChecklistText: '- 画面：世界树'
          })
        )
      })
    ).rejects.toMatchObject({ code: 'invalid-output' })
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
