import { describe, expect, it } from 'vitest'
import type { DeepSeekArchiveVideoResult, FavoriteLedger } from '@shared/types'
import { createArchivePlanState } from './favoriteArchivePlanState'
import {
  applyDeepSeekArchiveResults,
  buildDeepSeekArchiveRequest,
  createDeepSeekArchiveSnapshot,
  revertDeepSeekArchiveRun
} from './deepseekArchiveOrganizer'

const ledgers: FavoriteLedger[] = [
  {
    id: 'life-interest',
    displayName: 'bilimi·生活日常',
    keywords: ['旅行攻略'],
    enabled: true,
    priority: 10,
    isDefault: true
  },
  {
    id: 'game',
    displayName: 'bilimi·游戏专区',
    keywords: ['游戏攻略'],
    enabled: true,
    priority: 20,
    isDefault: true
  },
  {
    id: 'music',
    displayName: 'bilimi·音乐舞台',
    keywords: ['歌曲'],
    enabled: false,
    priority: 30,
    isDefault: true
  }
]

describe('deepseekArchiveOrganizer', () => {
  it('validates DeepSeek targets and applies successful suggestions to the preview plan', () => {
    const applied = applyDeepSeekArchiveResults({
      state: createArchivePlanState([
        {
          aid: 1,
          title: '东京旅行攻略',
          sourceFolderTitle: '默认收藏夹',
          originalSuggestedLedgerIds: [],
          currentTargetLedgerIds: [],
          selectedTargetLedgerIds: [],
          userModified: false
        }
      ]),
      ledgers,
      enabledLedgerIds: ['life-interest'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: '旅行攻略',
          confidence: 0.86,
          lowConfidence: false,
          secondPassChanged: true
        }
      ]
    })

    expect(applied.state.items[0]).toMatchObject({
      currentTargetLedgerIds: ['life-interest'],
      selectedTargetLedgerIds: ['life-interest'],
      lastChangeSource: 'deepseek'
    })
    expect(applied.messages[0]).toContain('DeepSeek 整理：未分类 -> bilimi·生活日常')
    expect(applied.stats).toEqual({ successCount: 1, failedCount: 0, truncatedCount: 0 })
  })

  it('rejects invalid disabled and unclassified targets while keeping the previous plan', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '东京旅行攻略',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        userModified: false
      },
      {
        aid: 2,
        title: '钢琴曲',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        userModified: false
      },
      {
        aid: 3,
        title: '未知内容',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])

    const applied = applyDeepSeekArchiveResults({
      state,
      ledgers,
      enabledLedgerIds: ['life-interest', 'game'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          targetLedgerIds: ['life-interest', 'game'],
          keepOriginal: true,
          reason: '旅行攻略',
          confidence: 0.8,
          lowConfidence: false
        },
        {
          aid: 2,
          targetLedgerIds: ['未分类'],
          keepOriginal: false,
          reason: '不应执行归档',
          confidence: 0.7,
          lowConfidence: false
        },
        {
          aid: 3,
          targetLedgerIds: ['music'],
          keepOriginal: false,
          reason: 'disabled ledger',
          confidence: 0.7,
          lowConfidence: false
        },
        {
          aid: 4,
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: 'missing video',
          confidence: 0.7,
          lowConfidence: false
        }
      ]
    })

    expect(applied.state.items.map((item) => item.selectedTargetLedgerIds)).toEqual([
      ['game'],
      ['game'],
      []
    ])
    expect(applied.stats).toEqual({ successCount: 1, failedCount: 3, truncatedCount: 1 })
    expect(applied.nonApplicationCounts).toEqual({
      'kept-unclassified': 1,
      'unavailable-target': 1,
      'invalid-result': 0,
      'unmatched-video': 1,
      'request-failed': 0
    })
    expect(applied.redDisplacementMessages).toEqual([
      expect.stringContaining('DeepSeek 整理：bilimi·游戏专区 + bilimi·生活日常 超过 1 个目标')
    ])
    expect(applied.messages).toEqual(expect.arrayContaining([expect.stringContaining('不可用目标 music')]))
    expect(state.items[1].selectedTargetLedgerIds).toEqual(['game'])
  })

  it('separates invalid model output from request failures', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '模型格式错误',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      },
      {
        aid: 2,
        title: '请求失败',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])

    const applied = applyDeepSeekArchiveResults({
      state,
      ledgers,
      enabledLedgerIds: ['life-interest', 'game'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: [],
          keepOriginal: false,
          reason: '',
          lowConfidence: true,
          invalid: true,
          errorMessage: 'DeepSeek result row is invalid: invalid confidence.'
        },
        {
          aid: 2,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: [],
          keepOriginal: false,
          reason: '',
          lowConfidence: true,
          invalid: true,
          failureKind: 'request-failed',
          errorMessage: 'DeepSeek API request failed: 503'
        }
      ]
    })

    expect(applied.nonApplicationCounts).toMatchObject({
      'invalid-result': 1,
      'request-failed': 1
    })
  })

  it('applies one duplicate aid row by source folder title without changing the other row', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '东京旅行攻略',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      },
      {
        aid: 1,
        title: '东京旅行攻略',
        sourceFolderTitle: '稍后观看',
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        userModified: false
      }
    ])

    const applied = applyDeepSeekArchiveResults({
      state,
      ledgers,
      enabledLedgerIds: ['life-interest', 'game'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          sourceFolderTitle: '默认收藏夹',
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: '默认收藏夹里的这一条是旅行内容',
          confidence: 0.88,
          lowConfidence: false
        }
      ]
    })

    expect(applied.stats).toEqual({ successCount: 1, failedCount: 0, truncatedCount: 0 })
    expect(applied.state.items).toEqual([
      expect.objectContaining({
        aid: 1,
        sourceFolderTitle: '默认收藏夹',
        selectedTargetLedgerIds: ['life-interest'],
        lastChangeSource: 'deepseek'
      }),
      expect.objectContaining({
        aid: 1,
        sourceFolderTitle: '稍后观看',
        selectedTargetLedgerIds: ['game'],
        lastChangeSource: 'classifier'
      })
    ])
  })

  it('builds requests by mode with enabled ledger context only', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '已分类',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        userModified: false
      },
      {
        aid: 2,
        title: '未分类',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])

    expect(buildDeepSeekArchiveRequest(state, ledgers, 'classified-only', 2)).toMatchObject({
      kind: 'favorite-archive-organize',
      mode: 'classified-only',
      multiArchiveLimit: 2,
      videos: [expect.objectContaining({ aid: 1, selectedTargetLedgerIds: ['game'] })],
      ledgers: [
        expect.objectContaining({ id: 'life-interest', displayName: 'bilimi·生活日常' }),
        expect.objectContaining({ id: 'game', displayName: 'bilimi·游戏专区' })
      ]
    })
    expect(buildDeepSeekArchiveRequest(state, ledgers, 'unclassified-only', 1).videos).toEqual([
      expect.objectContaining({ aid: 2 })
    ])
  })

  it('sends DeepSeek constraints separately from local keywords', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '原神世界观考据',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])
    const request = buildDeepSeekArchiveRequest(
      state,
      [
        {
          id: 'genshin-lore',
          displayName: 'bilimi·原神考据',
          keywords: [
            '原神',
            '米哈游',
            '【DeepSeek约束】',
            '只收剧情解析、角色考据、世界观分析。不要收抽卡、整活、直播切片。'
          ],
          ruleType: 'keyword',
          enabled: true,
          priority: -20,
          isDefault: false
        },
        {
          id: 'deepseek-lore',
          displayName: 'bilimi·剧情考据',
          keywords: ['只收剧情解析、角色考据、世界观分析。'],
          ruleType: 'deepseek',
          enabled: true,
          priority: -10,
          isDefault: false
        }
      ],
      'all',
      1
    )

    expect(request.ledgers).toEqual([
      expect.objectContaining({
        id: 'genshin-lore',
        keywords: ['原神', '米哈游'],
        deepSeekConstraint: '只收剧情解析、角色考据、世界观分析。不要收抽卡、整活、直播切片。'
      }),
      expect.objectContaining({
        id: 'deepseek-lore',
        keywords: [],
        ruleType: 'deepseek',
        deepSeekConstraint: '只收剧情解析、角色考据、世界观分析。'
      })
    ])
  })

  it('builds the default DeepSeek archive request from low-confidence and unclassified rows', () => {
    const state = createArchivePlanState([
      {
        aid: 10,
        title: 'low confidence classified',
        sourceFolderTitle: 'default',
        originalSuggestedLedgerIds: ['game'],
        currentTargetLedgerIds: ['game'],
        selectedTargetLedgerIds: ['game'],
        lowConfidence: true,
        userModified: false
      },
      {
        aid: 11,
        title: 'confident classified',
        sourceFolderTitle: 'default',
        originalSuggestedLedgerIds: ['life-interest'],
        currentTargetLedgerIds: ['life-interest'],
        selectedTargetLedgerIds: ['life-interest'],
        lowConfidence: false,
        userModified: false
      },
      {
        aid: 12,
        title: 'unclassified',
        sourceFolderTitle: 'default',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        lowConfidence: false,
        userModified: false
      }
    ])

    expect(
      buildDeepSeekArchiveRequest(state, ledgers, 'low-confidence-and-unclassified', 1).videos
    ).toEqual([expect.objectContaining({ aid: 10 }), expect.objectContaining({ aid: 12 })])
  })

  it('applies concrete low-confidence DeepSeek targets and rejects staging suggestions', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '决定不了的旧藏',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      },
      {
        aid: 2,
        title: '被建议暂存的旧藏',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])

    const applied = applyDeepSeekArchiveResults({
      state,
      ledgers: [
        ...ledgers,
        {
          id: 'inbox',
          displayName: 'bilimi·暂存',
          keywords: [],
          enabled: true,
          priority: 0,
          isDefault: true
        }
      ],
      enabledLedgerIds: ['life-interest', 'game', 'inbox'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: 'DeepSeek 没有把握。',
          confidence: 0.42,
          lowConfidence: true
        },
        {
          aid: 2,
          targetLedgerIds: ['inbox'],
          keepOriginal: false,
          reason: '先放暂存。',
          confidence: 0.7,
          lowConfidence: false
        }
      ]
    })

    expect(applied.state.items.map((item) => item.selectedTargetLedgerIds)).toEqual([
      ['life-interest'],
      []
    ])
    expect(applied.stats).toEqual({ successCount: 1, failedCount: 1, truncatedCount: 0 })
    expect(applied.messages).toEqual(expect.arrayContaining([expect.stringContaining('inbox')]))
  })

  it('reverts a run from an isolated snapshot', () => {
    const state = createArchivePlanState([
      {
        aid: 1,
        title: '东京旅行攻略',
        sourceFolderTitle: '默认收藏夹',
        originalSuggestedLedgerIds: [],
        currentTargetLedgerIds: [],
        selectedTargetLedgerIds: [],
        userModified: false
      }
    ])
    const snapshot = createDeepSeekArchiveSnapshot(state)
    state.items[0].selectedTargetLedgerIds.push('mutated-after-snapshot')

    const applied = applyDeepSeekArchiveResults({
      state,
      ledgers,
      enabledLedgerIds: ['life-interest'],
      multiArchiveLimit: 1,
      results: [
        {
          aid: 1,
          targetLedgerIds: ['life-interest'],
          keepOriginal: false,
          reason: '旅行攻略',
          confidence: 0.86,
          lowConfidence: false
        } satisfies DeepSeekArchiveVideoResult
      ]
    })

    expect(revertDeepSeekArchiveRun(applied.state, snapshot).items[0].selectedTargetLedgerIds).toEqual([])
  })
})
