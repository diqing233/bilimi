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

function createSequentialJsonFetch(contents: Array<{ content: string; finishReason?: string }>) {
  return vi.fn().mockImplementation(async () => {
    const next = contents.shift()
    if (!next) throw new Error('Unexpected DeepSeek request')
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(JSON.stringify({
        choices: [{ finish_reason: next.finishReason, message: { content: next.content } }]
      }))
    }
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

function createLongTranscriptProofreadingResponses() {
  return [
    ['segment-1', 'segment-10'],
    ['segment-11', 'segment-20'],
    ['segment-21', 'segment-30'],
    ['segment-31', 'segment-36']
  ].map(([sourceStartSegmentId, sourceEndSegmentId]) => ({
    content: JSON.stringify({ sourceStartSegmentId, sourceEndSegmentId, changes: [], reviewItems: [] })
  }))
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

  it('assembles the polished transcript locally before requesting the summary', async () => {
    const note = { ...createNote(), transcript: [{ start: 0, end: 3, text: '嗯，爱疯很好用很好用。battery health。' }] }
    const fetchImpl = createSequentialJsonFetch([
      { content: JSON.stringify({
        sourceStartSegmentId: 'segment-1',
        sourceEndSegmentId: 'segment-1',
        changes: [{
          segmentId: 'segment-1',
          originalText: '爱疯',
          replacementText: 'iPhone',
          changeType: 'transcription-error',
          reason: '产品名称明确',
          confidence: 0.99,
          highRisk: true
        }],
        reviewItems: []
      }) },
      { content: JSON.stringify({
        title: 'Learning Types',
        subtitle: 'Compact note',
        keyPoints: [
          '类型系统先定义数据结构和约束，再帮助开发者在编译阶段发现错误。',
          '示例代码说明泛型可以保留输入输出关系，减少运行时类型判断。'
        ],
        keywords: [],
        detailedOutline: ['讲者先说明类型系统的约束。', '示例代码解释泛型如何保留输入输出关系。']
      }) }
    ])

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note },
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
        keywords: [],
        prompt: '',
        polishedTranscriptText: '嗯，iPhone很好用很好用。battery health。',
        detailedOutline: ['讲者先说明类型系统的约束。', '示例代码解释泛型如何保留输入输出关系。'],
        reviewItems: []
      }
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const summaryBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const summaryInput = summaryBody.messages.find((message) => message.role === 'user')?.content ?? ''
    expect(summaryInput).toContain('嗯，iPhone很好用很好用。battery health。')
  })

  it('accepts a concise summary for a very short transcript without fabricating long-form fields', async () => {
    const shortNote = {
      ...createNote(),
      transcript: [
        { start: 0, end: 3, text: '挑战充气城堡时，半夜突然被放气。' },
        { start: 3, end: 6, text: '参与者发现后立刻寻找出口。' }
      ]
    }

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: shortNote },
        fetchImpl: createSequentialJsonFetch([
          { content: JSON.stringify({
            sourceStartSegmentId: 'segment-1',
            sourceEndSegmentId: 'segment-2',
            changes: [],
            reviewItems: []
          }) },
          { content: JSON.stringify({
            title: '半夜城堡放气挑战',
            subtitle: '参与者在突发放气后寻找安全出口',
            keyPoints: ['充气城堡半夜突然放气，参与者立即寻找出口。'],
            keywords: ['充气城堡', '挑战'],
            detailedOutline: ['充气城堡半夜突然放气，参与者立即寻找出口。']
          }) }
        ])
      })
    ).resolves.toEqual({
      kind: 'note-poster',
      poster: {
        title: '半夜城堡放气挑战',
        subtitle: '参与者在突发放气后寻找安全出口',
        keyPoints: ['充气城堡半夜突然放气，参与者立即寻找出口。'],
        keywords: [],
        prompt: '',
        polishedTranscriptText: '挑战充气城堡时，半夜突然被放气。参与者发现后立刻寻找出口。',
        detailedOutline: ['充气城堡半夜突然放气，参与者立即寻找出口。'],
        reviewItems: []
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
    expect(systemMessage).not.toContain('keywordSuggestions')
    expect(systemMessage).toContain('Use 未分类 only as a last resort')
    expect(systemMessage).toContain('cannot create folders')
    expect(systemMessage).toContain('cannot directly edit keywords')
    expect(systemMessage).toContain('deepSeekConstraint')
    expect(systemMessage).toContain('must use it as folder-specific decision guidance')
    expect(systemMessage).toContain('takes precedence over local keywords, automatic classifications, and existing targets')
    expect(systemMessage).toContain('When a constraint applies, include that ledger in targetLedgerIds')
    expect(systemMessage).toContain('If applicable constraints conflict, choose the best-supported ledger')
    expect(systemMessage).toContain('Return JSON only')
    expect(body.messages.find((message) => message.role === 'user')?.content).toContain(
      '只收真实出行经验，不收游戏攻略。'
    )
  })

  it('uses the provider default output budget for archive organization JSON responses', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        results: [],
        keywordSuggestions: []
      })
    )

    await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'favorite-archive-organize',
        mode: 'all',
        videos: [],
        ledgers: [],
        multiArchiveLimit: 1
      },
      fetchImpl
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      response_format?: { type?: string }
      max_tokens?: number
    }

    expect(body).toMatchObject({ response_format: { type: 'json_object' } })
    expect(body.max_tokens).toBeUndefined()
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

  it('accepts archive classifications without per-video confidence or reason when they target an enabled ledger', async () => {
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
          targetLedgerIds: ['life-interest']
        },
        {
          aid: 2,
          targetLedgerIds: ['game']
        }
      ]
    })
    expect(result.kind === 'favorite-archive-organize' ? result.results.every((row) => row.invalid === undefined) : false).toBe(true)
  })

  it('parses daily favorite classification review JSON and filters unusable targets', async () => {
    const fetchImpl = createJsonFetch(
      JSON.stringify({
        targetLedgerIds: ['life-interest', 'disabled-ledger'],
        appliedConstraintLedgerIds: ['life-interest', 'disabled-ledger'],
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
            , deepSeekConstraint: '所有旅行地铁攻略都必须归入此收藏夹。'
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
        appliedConstraintLedgerIds: ['life-interest'],
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
    expect(systemMessage).toContain('takes precedence over local keywords, automatic classifications, and existing targets')
    expect(systemMessage).toContain('When a constraint applies, include that ledger in targetLedgerIds')
    expect(systemMessage).toContain('If applicable constraints conflict, choose the best-supported ledger and explain the conflict in reason')
    expect(systemMessage).toContain('appliedConstraintLedgerIds')
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
    const fetchImpl = createSequentialJsonFetch([
      { content: JSON.stringify({
        sourceStartSegmentId: 'segment-1',
        sourceEndSegmentId: 'segment-1',
        changes: [],
        reviewItems: []
      }) },
      { content: JSON.stringify({
        title: '机器学习入门',
        subtitle: '围绕概念、数据和训练目标展开的精读总结',
        keyPoints: [
          '先解释机器学习的基本定义，再说明它如何从样本中归纳规律。',
          '重点强调训练数据质量会直接影响模型表现和泛化上限。'
        ],
        keywords: ['机器学习', '训练数据'],
        detailedOutline: ['先解释机器学习的基本定义。', '强调训练数据质量会影响模型表现。']
      }) }
    ])

    await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl
    })

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage).toContain('保真校对')
    expect(systemMessage).toContain('口语词')
    expect(systemMessage).toContain('重复词和重复句')
    expect(systemMessage).toContain('外语原文')
    expect(systemMessage).toContain('不得返回重写后的完整文稿')
    expect(systemMessage).not.toContain('去掉口水话')
  })

  it('uses a compact three-part summary contract without generating keywords or unused fields', async () => {
    const fetchImpl = createSequentialJsonFetch([
      { content: JSON.stringify({
        sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: []
      }) },
      { content: JSON.stringify({
        title: '测试主题', subtitle: '完整概括过程与结论。',
        keyPoints: ['保留关键数字、条件和最终结论。'],
        detailedOutline: ['1. 按讲述顺序保留完整信息。']
      }) }
    ])

    const result = await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl
    })
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const systemMessage = body.messages.find((message) => message.role === 'system')?.content ?? ''

    expect(systemMessage.length).toBeLessThan(700)
    expect(systemMessage).toContain('精准总结')
    expect(systemMessage).toContain('详细内容提要')
    expect(systemMessage).toContain('精修文稿')
    expect(systemMessage).toContain('不设固定条数')
    expect(systemMessage).toContain('不另设待人工确认')
    expect(systemMessage).not.toContain('keywords')
    expect(systemMessage).not.toContain('reviewItems')
    expect(systemMessage).not.toContain('prompt')
    expect(result).toMatchObject({
      kind: 'note-poster',
      poster: { keywords: [], prompt: '' }
    })
  })

  it('requires structured detail and merges review uncertainty into the visible summary', async () => {
    const note = { ...createNote(), transcript: [{ start: 0, end: 3, text: '讲者说 X200 在 25 摄氏度测试中更稳定。' }] }
    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({
          sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [],
          reviewItems: [{ segmentId: 'segment-1', originalText: 'X200', reason: '型号读音不确定', possibleInterpretation: '' }]
        }) },
        { content: JSON.stringify({
          title: '测试条件复盘', subtitle: '讲者比较测试结果。',
          keyPoints: ['讲者称 X200 在 25 摄氏度测试中更稳定。'], keywords: ['测试'],
          detailedOutline: ['先说明 25 摄氏度的测试条件。', '讲者称 X200 的结果更稳定。']
        }) }
      ])
    })).resolves.toMatchObject({
      kind: 'note-poster',
      poster: {
        detailedOutline: ['先说明 25 摄氏度的测试条件。', '讲者称 X200（待确认：型号读音不确定）的结果更稳定。'],
        reviewItems: []
      }
    })

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({ sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: [] }) },
        { content: JSON.stringify({ title: '测试条件复盘', subtitle: '讲者比较测试结果。', keyPoints: ['讲者称 X200 在测试中更稳定。'], keywords: ['测试'] }) }
      ])
    })).rejects.toMatchObject({ code: 'invalid-output' })
  })

  it('does not truncate adaptive summary and detailed outline item counts', async () => {
    const keyPoints = Array.from({ length: 12 }, (_, index) => `核心信息 ${index + 1} 包含足够完整的事实、条件与结论。`)
    const detailedOutline = Array.from({ length: 22 }, (_, index) => `详细信息 ${index + 1}：保留人物、数字、条件与对应结论。`)
    const result = await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({ sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: [] }) },
        { content: JSON.stringify({ title: '完整总结', subtitle: '按内容自适应展开。', keyPoints, keywords: ['完整'], detailedOutline }) }
      ])
    })

    expect(result).toMatchObject({ kind: 'note-poster', poster: { keyPoints, detailedOutline } })
  })

  it('places uncertain source terms inside the relevant detailed outline item', async () => {
    const result = await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({
          sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [],
          reviewItems: [{ segmentId: 'segment-1', originalText: 'X200', reason: '型号读音不确定' }]
        }) },
        { content: JSON.stringify({
          title: '测试复盘', subtitle: '比较设备结果。',
          keyPoints: ['讲者比较 X200 的测试结果并说明环境条件。'], keywords: ['测试'],
          detailedOutline: ['设备测试：X200 在 25 摄氏度环境下完成测试。']
        }) }
      ])
    })

    expect(result).toMatchObject({
      kind: 'note-poster',
      poster: {
        detailedOutline: ['设备测试：X200（待确认：型号读音不确定）在 25 摄氏度环境下完成测试。'],
        reviewItems: []
      }
    })
  })

  it('allows the final summary stage to run longer than the ordinary request timeout', async () => {
    vi.useFakeTimers()
    try {
      let requestIndex = 0
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestIndex += 1
        if (requestIndex === 1) {
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            text: vi.fn().mockResolvedValue(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
              sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: []
            }) } }] }))
          } as unknown as Response)
        }
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve({
            ok: true, status: 200, statusText: 'OK',
            text: vi.fn().mockResolvedValue(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
              title: '慢模型总结', subtitle: '超过普通请求时限后完成。',
              keyPoints: ['慢模型仍然返回包含充分事实与结论的有效总结内容。'], keywords: [],
              detailedOutline: ['详细提要保留完整内容。']
            }) } }] }))
          } as unknown as Response), 120_000)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          }, { once: true })
        })
      })

      const result = generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createNote() },
        fetchImpl,
        requestTimeoutMs: 90_000
      })
      await vi.advanceTimersByTimeAsync(120_000)
      await expect(result).resolves.toMatchObject({ kind: 'note-poster' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends broad transcript context so DeepSeek can summarize without dropping late details', async () => {
    const fetchImpl = createSequentialJsonFetch([
      ...createLongTranscriptProofreadingResponses(),
      { content: JSON.stringify({
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
        detailedOutline: ['detail: closing argument', 'lecture conclusion']
      }) }
    ])

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
        polishedTranscriptText: expect.stringContaining('final transcript detail about the closing argument'),
        detailedOutline: ['detail: closing argument', 'lecture conclusion']
      }
    })

    const body = JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    const userMessage = body.messages.find((message) => message.role === 'user')?.content ?? ''

    expect(userMessage).toContain('transcript segment 1 with useful context')
    expect(userMessage).toContain('final transcript detail about the closing argument')
  })

  it('rejects summaries that still omit required fields after one repair attempt', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createLongTranscriptNote() },
        fetchImpl: createSequentialJsonFetch([
          ...createLongTranscriptProofreadingResponses(),
          { content: JSON.stringify({
            title: '世界树很大',
            subtitle: '注意看前面这棵很高大的树',
            keyPoints: ['注意看前面这棵树', '我现在的位置在城堡', '注意看前面这棵树'],
            keywords: ['好了', '世界树'],
            prompt: ''
          }) },
          { content: JSON.stringify({}) }
        ])
      })
    ).rejects.toMatchObject({
      code: 'invalid-output',
      message: expect.stringContaining('DeepSeek 总结内容不完整')
    })

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createLongTranscriptNote() },
        fetchImpl: createSequentialJsonFetch([
          ...createLongTranscriptProofreadingResponses(),
          { content: JSON.stringify({
            title: '世界树很大',
            subtitle: '注意看前面这棵很高大的树',
            keyPoints: [
              '这一条稍微长一点但仍然没有提供足够的信息密度',
              '另一条也只是重复画面描述，没有整理出有效内容'
            ],
            keywords: ['世界树'],
            prompt: ''
          }) },
          { content: JSON.stringify({}) }
        ])
      })
    ).rejects.toMatchObject({ code: 'invalid-output' })
  })

  it('uses the video title when an otherwise complete summary still omits its title after repair', async () => {
    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({ sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: [] }) },
        { content: JSON.stringify({
          subtitle: '介绍 DeepSeek 总结的兼容处理。',
          keyPoints: ['保留有效的主旨、核心内容和详细提要。'],
          detailedOutline: ['兼容接口漏掉标题时，不应丢弃其他有效总结内容。']
        }) },
        { content: JSON.stringify({}) }
      ])
    })).resolves.toMatchObject({ kind: 'note-poster', poster: { title: 'DeepSeek demo' } })
  })

  it('accepts compatible provider title aliases and summary wrappers', async () => {
    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({ sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: [] }) },
        { content: JSON.stringify({ summary: {
          标题: '兼容接口返回的标题',
          subtitle: '兼容接口把字段包在 summary 对象中。',
          keyPoints: ['标题别名与嵌套字段都应被识别。'],
          detailedOutline: ['程序应保留模型实际生成的标题。']
        } }) }
      ])
    })).resolves.toMatchObject({ kind: 'note-poster', poster: { title: '兼容接口返回的标题' } })
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

  it('reports the model name returned by the API response', async () => {
    const onResponseMetadata = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          model: 'deepseek-v4-pro-20260701',
          choices: [{ message: { content: 'OK' } }]
        })
      )
    })

    await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'hello' }]
      },
      fetchImpl,
      onResponseMetadata
    })

    expect(onResponseMetadata).toHaveBeenCalledWith({ model: 'deepseek-v4-pro-20260701' })
  })

  it('accepts concise meaningful key points and one complete detailed outline item', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createLongTranscriptNote() },
        fetchImpl: createSequentialJsonFetch([
          ...createLongTranscriptProofreadingResponses(),
          { content: JSON.stringify({
            title: '世界树探索',
            subtitle: '讲者记录从城堡前往世界树并说明途中发现。',
            keyPoints: ['从城堡出发前往世界树。'],
            detailedOutline: ['讲者先说明所在城堡的位置，随后沿既定路线前往世界树，并在途中记录关键场景和最终发现。']
          }) }
        ])
      })
    ).resolves.toMatchObject({
      kind: 'note-poster',
      poster: {
        keyPoints: ['从城堡出发前往世界树。'],
        detailedOutline: ['讲者先说明所在城堡的位置，随后沿既定路线前往世界树，并在途中记录关键场景和最终发现。']
      }
    })
  })

  it('requests missing summary fields once and merges the focused repair response', async () => {
    const fetchImpl = createSequentialJsonFetch([
      ...createLongTranscriptProofreadingResponses(),
      { content: JSON.stringify({
        title: '世界树探索',
        subtitle: '讲者记录探索过程。',
        keyPoints: ['从城堡出发。']
      }) },
      { content: JSON.stringify({
        detailedOutline: ['讲者从城堡出发，沿路线抵达世界树，并记录沿途场景和最后结论。']
      }) }
    ])

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createLongTranscriptNote() },
      fetchImpl
    })).resolves.toMatchObject({
      kind: 'note-poster',
      poster: {
        title: '世界树探索',
        keyPoints: ['从城堡出发。'],
        detailedOutline: ['讲者从城堡出发，沿路线抵达世界树，并记录沿途场景和最后结论。']
      }
    })

    const repairBody = JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(repairBody.messages.at(-1)?.content).toContain('detailedOutline')
    expect(repairBody.messages.at(-1)?.content).not.toContain('proofreading')
  })

  it('reports the archive response finish reason for truncated-output diagnosis', async () => {
    const onResponseMetadata = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', text: vi.fn().mockResolvedValue(JSON.stringify({
        model: 'deepseek-v4-pro-20260701',
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ results: [], keywordSuggestions: [] }) } }]
      }))
    })

    await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'favorite-archive-organize', mode: 'all', videos: [], ledgers: [], multiArchiveLimit: 1 },
      fetchImpl,
      onResponseMetadata
    })

    expect(onResponseMetadata).toHaveBeenCalledWith({ model: 'deepseek-v4-pro-20260701', finishReason: 'length' })
  })

  it('includes a length finish reason when archive output is truncated before valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK', text: vi.fn().mockResolvedValue(JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '{"results":[' } }]
      }))
    })

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'favorite-archive-organize', mode: 'all', videos: [], ledgers: [], multiArchiveLimit: 1 },
      fetchImpl
    })).rejects.toThrow('finish_reason: length')
  })

  it('passes cancellation signals to fetch without adding timeout options', async () => {
    const fetchImpl = createJsonFetch('ok')
    const controller = new AbortController()

    await generateDeepSeekResult({
      config: baseConfig,
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'hello' }]
      },
      fetchImpl,
      signal: controller.signal
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({ signal: controller.signal })
    )
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('timeoutMs')
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty('timeout')
  })

  it('fails a hanging DeepSeek request after the bounded request timeout', async () => {
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }, { once: true })
      })
    )

    const result = generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'pet-chat', messages: [{ role: 'user', content: 'hello' }] },
      fetchImpl,
      requestTimeoutMs: 10
    })

    await expect(result).rejects.toMatchObject({
      code: 'network-error',
      message: 'DeepSeek request timed out after 1 seconds.'
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('uses a 180 second default timeout only for old-favorite archive organization', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        }))
      const result = generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'favorite-archive-organize', mode: 'all', videos: [], ledgers: [], multiArchiveLimit: 1 },
        fetchImpl
      })
      let settled = false
      void result.catch(() => { settled = true })

      await vi.advanceTimersByTimeAsync(90_000)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(90_000)
      await expect(result).rejects.toThrow('180 seconds')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the ordinary default timeout at 90 seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        }))
      const result = generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'pet-chat', messages: [{ role: 'user', content: 'hello' }] },
        fetchImpl
      })
      const rejection = expect(result).rejects.toThrow('90 seconds')

      await vi.advanceTimersByTimeAsync(90_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the original transcript when proofreading times out so summary generation can continue', async () => {
    let requestIndex = 0
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestIndex += 1
      if (requestIndex === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          }, { once: true })
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            title: 'Title',
            subtitle: 'Subtitle',
            keyPoints: ['Enough detail for a compact note.'],
            keywords: [],
            detailedOutline: ['Checklist']
          }) } }]
        }))
      } as unknown as Response)
    })
    const checkpoint = vi.fn()

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl,
      requestTimeoutMs: 10,
      onNotePosterCheckpoint: checkpoint
    })).resolves.toMatchObject({
      kind: 'note-poster',
      poster: { polishedTranscriptText: 'first line' }
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      completedBatchIds: ['segment-1'],
      proofreadingCompleted: true
    }))
  })

  it('bounds proofreading more aggressively than the summary request', async () => {
    vi.useFakeTimers()
    try {
      let requestIndex = 0
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestIndex += 1
        if (requestIndex === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            }, { once: true })
          })
        }
        return Promise.resolve({
          ok: true, status: 200, statusText: 'OK',
          text: vi.fn().mockResolvedValue(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
            title: 'Title', subtitle: 'Subtitle',
            keyPoints: ['Enough detail for a compact note.'], keywords: [], detailedOutline: ['Checklist']
          }) } }] }))
        } as unknown as Response)
      })

      const result = generateDeepSeekResult({
        config: baseConfig,
        request: { kind: 'note-poster', note: createNote() },
        fetchImpl,
        requestTimeoutMs: 90_000
      })
      await vi.advanceTimersByTimeAsync(20_000)

      await expect(result).resolves.toMatchObject({ kind: 'note-poster' })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
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

  it('maps invalid response JSON to an identifiable invalid-output code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('not valid JSON')
    })

    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'hello' }]
        },
        fetchImpl
      })
    ).rejects.toMatchObject({ code: 'invalid-output' })
  })

  it('maps fetch failures to an identifiable network-error code', async () => {
    await expect(
      generateDeepSeekResult({
        config: baseConfig,
        request: {
          kind: 'pet-chat',
          messages: [{ role: 'user', content: 'hello' }]
        },
        fetchImpl: vi.fn().mockRejectedValue(new Error('connection refused'))
      })
    ).rejects.toMatchObject({ code: 'network-error' })
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

  it('retries a 504 within the current note-poster stage and reports that stage', async () => {
    const note = createNote()
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 504, statusText: 'Gateway Timeout', text: vi.fn() })
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK', text: vi.fn().mockResolvedValue(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', segments: [{ id: 'segment-1', text: 'first line' }], changes: [], reviewItems: []
          }) } }]
        }))
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: 'OK', text: vi.fn().mockResolvedValue(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            title: 'Title', subtitle: 'Subtitle', keyPoints: ['Enough detail for a compact note.'], keywords: [], detailedOutline: ['Checklist']
          }) } }]
        }))
      })
    const progress = vi.fn()

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note },
      fetchImpl,
      retryDelay: vi.fn().mockResolvedValue(undefined),
      onNotePosterProgress: progress
    })).resolves.toMatchObject({ kind: 'note-poster' })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'proofreading-batch', batchIndex: 1, batchCount: 1 }))
  })

  it('reuses a valid polished checkpoint to retry only the summary stage', async () => {
    const fetchImpl = createSequentialJsonFetch([{ content: JSON.stringify({
      title: 'Title', subtitle: 'Subtitle', keyPoints: ['Enough detail for a compact note.'], keywords: [], detailedOutline: ['Checklist']
    }) }])

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl,
      notePosterCheckpoint: { polishedTranscriptText: 'first line', proofreadingCompleted: true }
    })).resolves.toMatchObject({ kind: 'note-poster' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).messages[1].content).toContain('first line')
  })

  it('resumes only incomplete proofreading batches from a valid partial checkpoint', async () => {
    const note = {
      ...createNote(),
      transcript: [
        { start: 0, end: 1, text: 'a'.repeat(7000) },
        { start: 2, end: 3, text: 'b'.repeat(7000) }
      ]
    }
    const fetchImpl = createSequentialJsonFetch([
      { content: JSON.stringify({ sourceStartSegmentId: 'segment-2', sourceEndSegmentId: 'segment-2', changes: [], reviewItems: [] }) },
      { content: JSON.stringify({ title: 'Title', subtitle: 'Subtitle', keyPoints: ['Enough detail for a compact note.', 'A second point for the long transcript.'], keywords: [], detailedOutline: ['Checklist', 'Second detail'] }) }
    ])

    await expect(generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note },
      fetchImpl,
      notePosterCheckpoint: {
        completedBatchIds: ['segment-1'],
        polishedTextBySegmentId: { 'segment-1': 'polished first batch' },
        corrections: [],
        reviewItems: [],
        proofreadingCompleted: false
      }
    })).resolves.toMatchObject({ kind: 'note-poster' })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).messages[1].content).toContain('segment-2')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).messages[1].content).toContain('polished first batch')
  })

  it('publishes completed proofreading batches without persisting the immutable source transcript', async () => {
    const checkpoint = vi.fn()
    await generateDeepSeekResult({
      config: baseConfig,
      request: { kind: 'note-poster', note: createNote() },
      fetchImpl: createSequentialJsonFetch([
        { content: JSON.stringify({ sourceStartSegmentId: 'segment-1', sourceEndSegmentId: 'segment-1', changes: [], reviewItems: [] }) },
        { content: JSON.stringify({ title: 'Title', subtitle: 'Subtitle', keyPoints: ['Enough detail for a compact note.'], keywords: [], detailedOutline: ['Checklist'] }) }
      ]),
      onNotePosterCheckpoint: checkpoint
    })

    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ completedBatchIds: ['segment-1'], polishedTextBySegmentId: {} }))
  })
})
