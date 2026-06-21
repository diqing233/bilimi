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
