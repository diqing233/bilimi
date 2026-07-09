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

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('Mention the video title or UP name only when it fits naturally')
    expect(systemMessage).toContain('100 characters or fewer')
    expect(systemMessage).not.toContain('must mention the video title and the UP name')
  })

  it('rejects review comments longer than the sendable 100 character limit', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'review-comment',
          intent: '',
          title: 'Demo',
          author: 'Ada',
          description: 'About type systems',
          tags: ['typescript'],
          classification: 'knowledge'
        },
        fetchImpl: createJsonFetch(
          JSON.stringify({
            comments: ['short one', 'short two', 'x'.repeat(101)]
          })
        )
      })
    ).rejects.toMatchObject({ code: 'invalid-output' })
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

  it('parses favorite archive organization JSON and normalizes keyword suggestions', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        results: [
          {
            aid: 1,
            sourceFolderTitle: '默认收藏夹',
            targetLedgerIds: ['life-interest'],
            keepOriginal: false,
            reason: '旅行攻略语义更接近日常生活',
            confidence: 0.86,
            lowConfidence: false,
            secondPassChanged: true
          }
        ],
        keywordSuggestions: [
          {
            action: 'replace-with-combination',
            ledgerId: 'game',
            keyword: '攻略',
            replacement: '游戏攻略',
            reason: '裸攻略容易误分旅行内容'
          }
        ]
      })
    )

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'favorite-archive-organize',
          mode: 'all',
          videos: [
            {
              aid: 1,
              title: '东京旅行攻略',
              sourceFolderTitle: '默认收藏夹',
              originalSuggestedLedgerIds: [],
              currentTargetLedgerIds: [],
              selectedTargetLedgerIds: []
            }
          ],
          ledgers: [
            {
              id: 'life-interest',
              displayName: 'bilimi·生活日常',
              keywords: ['旅行攻略'],
              enabled: true,
              deepSeekConstraint: '只收真实出行经验，不收游戏攻略。'
            }
          ],
          multiArchiveLimit: 1
        } as unknown as DeepSeekGenerateRequest,
        fetchImpl
      })
    ).resolves.toMatchObject({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 1,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: '旅行攻略语义更接近日常生活',
          confidence: 0.86,
          lowConfidence: false,
          secondPassChanged: true
        }
      ],
      keywordSuggestions: [
        {
          id: 'deepseek:game:replace-with-combination:攻略:游戏攻略',
          action: 'replace-with-combination',
          ledgerId: 'game',
          keyword: '攻略',
          replacement: '游戏攻略',
          reason: '裸攻略容易误分旅行内容',
          source: 'deepseek',
          status: 'pending'
        }
      ]
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('only output existing enabled bilimi ledgers')
    expect(systemMessage).toContain('未分类')
    expect(systemMessage).toContain('choose the closest existing enabled ledger')
    expect(systemMessage).toContain('keywordSuggestions')
    expect(systemMessage).toContain('Use 未分类 only as a last resort')
    expect(systemMessage).toContain('cannot create folders')
    expect(systemMessage).toContain('cannot directly edit keywords')
    expect(systemMessage).toContain('deepSeekConstraint')
    expect(systemMessage).toContain('must use it as folder-specific decision guidance')
    expect(systemMessage).toContain('Return JSON only')
    expect(body.messages.find((message) => message.role === 'user')?.content).toContain(
      '只收真实出行经验，不收游戏攻略。'
    )
  })

  it('marks archive unclassified results invalid when a meaningful video only lacks an exact category', async () => {
    const result = await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'favorite-archive-organize',
        mode: 'unclassified-only',
        videos: [
          {
            aid: 77,
            title: '【一气看完】喜欢文本位的可以跑进来了。',
            tags: ['爽文', '大女主', '小说推文', '文本位', '宝藏小说'],
            sourceFolderTitle: '默认收藏夹',
            originalSuggestedLedgerIds: [],
            currentTargetLedgerIds: [],
            selectedTargetLedgerIds: []
          }
        ],
        ledgers: [
          {
            id: 'movie-tv',
            displayName: 'bilimi·影视动漫',
            keywords: ['影视剧情', '角色分析'],
            enabled: true
          },
          {
            id: 'entertainment',
            displayName: 'bilimi·搞笑杂谈',
            keywords: ['娱乐', '杂谈'],
            enabled: true
          }
        ],
        multiArchiveLimit: 1
      },
      fetchImpl: createJsonFetch(
        JSON.stringify({
          results: [
            {
              aid: 77,
              sourceFolderTitle: '默认收藏夹',
              targetLedgerIds: ['unclassified'],
              keepOriginal: false,
              reason: '没有小说推文这个精确分类。',
              confidence: 0.7,
              lowConfidence: false
            }
          ],
          keywordSuggestions: []
        })
      )
    })

    expect(result).toMatchObject({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 77,
          invalid: true,
          errorMessage: expect.stringContaining('closest existing enabled ledger')
        }
      ]
    })
  })

  it('marks archive rows invalid when confidence is missing without dropping usable rows', async () => {
    const result = await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'favorite-archive-organize',
        mode: 'all',
        videos: [],
        ledgers: [],
        multiArchiveLimit: 1
      },
      fetchImpl: createJsonFetch(
        JSON.stringify({
          results: [
            {
              aid: 1,
              targetLedgerIds: ['life-interest'],
              keepOriginal: false,
              reason: '旅行攻略',
              lowConfidence: false
            },
            {
              aid: 2,
              targetLedgerIds: ['game'],
              keepOriginal: false,
              reason: '游戏攻略',
              confidence: 0.9,
              lowConfidence: false
            }
          ],
          keywordSuggestions: []
        })
      )
    })

    expect(result).toMatchObject({
      kind: 'favorite-archive-organize',
      results: [
        {
          aid: 1,
          invalid: true,
          errorMessage: expect.stringContaining('invalid confidence')
        },
        {
          aid: 2,
          targetLedgerIds: ['game']
        }
      ]
    })
    expect(result.kind === 'favorite-archive-organize' ? result.results[1].invalid : true).toBeUndefined()
  })

  it('parses daily favorite classification review JSON and filters unusable targets', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        targetLedgerIds: ['life-interest', 'disabled-ledger'],
        corrected: true,
        reason: '旅行攻略应归入生活日常，不是游戏攻略。',
        confidence: 0.82,
        keywordSuggestions: [
          {
            action: 'replace-with-combination',
            ledgerId: 'game',
            keyword: '攻略',
            replacement: '游戏攻略',
            reason: '裸攻略容易误判旅行内容'
          }
        ]
      })
    )

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'favorite-daily-classify-review',
          video: {
            aid: 701,
            title: '大阪地铁换乘攻略',
            author: '旅行研究所',
            description: '交通路线与避坑',
            tags: ['旅行', '攻略'],
            category: '生活',
            pageText: '大阪地铁换乘攻略'
          },
          localClassification: {
            targetLedgerIds: ['game'],
            primaryLedgerId: 'game',
            displayNames: ['bilimi·游戏'],
            reason: '本地命中攻略',
            diagnostics: [
              {
                ledgerId: 'game',
                score: 4,
                runnerUpLedgerId: 'life-interest',
                runnerUpScore: 3.5,
                scoreGap: 0.5,
                confidence: 'low',
                lowConfidence: true,
                matchedKeywords: ['攻略'],
                strongSignals: [],
                weakSignals: ['攻略'],
                entityAliases: [],
                conceptClusters: [],
                positiveRules: [],
                negativeRules: []
              }
            ]
          },
          ledgers: [
            {
              id: 'game',
              displayName: 'bilimi·游戏',
              keywords: ['游戏攻略'],
              enabled: true
            },
            {
              id: 'life-interest',
              displayName: 'bilimi·生活日常',
              keywords: ['旅行攻略'],
              enabled: true
            },
            {
              id: 'disabled-ledger',
              displayName: '停用',
              keywords: [],
              enabled: false
            }
          ]
        },
        fetchImpl
      })
    ).resolves.toMatchObject({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: ['life-interest'],
      corrected: true,
      reason: '旅行攻略应归入生活日常，不是游戏攻略。',
      confidence: 0.82,
      keywordSuggestions: [
        {
          id: 'deepseek:game:replace-with-combination:攻略:游戏攻略',
          source: 'deepseek',
          status: 'pending'
        }
      ]
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('existing enabled bilimi ledgers')
    expect(systemMessage).toContain('unclassified')
    expect(systemMessage).toContain('choose the closest existing enabled ledger')
    expect(systemMessage).toContain('keywordSuggestions')
    expect(systemMessage).toContain('JSON only')
    expect(systemMessage).toContain('keywordSuggestions are only pending suggestions')
  })

  it('marks daily inbox results invalid when a meaningful video only lacks an exact category', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'favorite-daily-classify-review',
          video: {
            aid: 88,
            title: '【一气看完】喜欢文本位的可以跑进来了。',
            tags: ['爽文', '大女主', '小说推文', '文本位', '宝藏小说']
          },
          localClassification: {
            targetLedgerIds: [],
            primaryLedgerId: 'inbox',
            displayNames: ['bilimi·暂存'],
            reason: '本地没有命中精确分类',
            diagnostics: []
          },
          ledgers: [
            {
              id: 'movie-tv',
              displayName: 'bilimi·影视动漫',
              keywords: ['影视剧情', '角色分析'],
              enabled: true
            },
            {
              id: 'entertainment',
              displayName: 'bilimi·搞笑杂谈',
              keywords: ['娱乐', '杂谈'],
              enabled: true
            },
            {
              id: 'inbox',
              displayName: 'bilimi·暂存',
              keywords: [],
              enabled: true
            }
          ]
        },
        fetchImpl: createJsonFetch(
          JSON.stringify({
            targetLedgerIds: ['inbox'],
            corrected: false,
            reason: '没有小说推文这个精确分类。',
            confidence: 0.7,
            keywordSuggestions: []
          })
        )
      })
    ).resolves.toMatchObject({
      kind: 'favorite-daily-classify-review',
      invalid: true,
      errorMessage: expect.stringContaining('closest existing enabled ledger')
    })
  })

  it('marks daily classification review invalid when confidence or targets are unusable', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'favorite-daily-classify-review',
          video: { aid: 702, title: '疑难视频', tags: [] },
          localClassification: {
            targetLedgerIds: ['game'],
            primaryLedgerId: 'game',
            displayNames: ['bilimi·游戏'],
            diagnostics: []
          },
          ledgers: [
            {
              id: 'game',
              displayName: 'bilimi·游戏',
              keywords: ['游戏'],
              enabled: true
            }
          ]
        },
        fetchImpl: createJsonFetch(
          JSON.stringify({
            targetLedgerIds: ['unknown-ledger'],
            corrected: true,
            reason: '目标不可用',
            confidence: 1.4,
            keywordSuggestions: []
          })
        )
      })
    ).resolves.toMatchObject({
      kind: 'favorite-daily-classify-review',
      targetLedgerIds: [],
      corrected: false,
      invalid: true,
      errorMessage: expect.stringContaining('invalid confidence')
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

  it('teaches pet chat enough bilimi product context to answer user questions', async () => {
    const fetchImpl = createJsonFetch('bilimi helps you review, collect, and summarize Bilibili videos.')

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

    expect(systemMessage).toContain('bilimi')
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
