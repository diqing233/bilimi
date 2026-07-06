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

  it('rejects invalid or disabled targets, truncates over-limit suggestions, and clears unclassified rows', () => {
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
      [],
      []
    ])
    expect(applied.stats).toEqual({ successCount: 2, failedCount: 2, truncatedCount: 1 })
    expect(applied.redDisplacementMessages).toEqual([
      expect.stringContaining('DeepSeek 整理：bilimi·游戏专区 + bilimi·生活日常 超过 1 个目标')
    ])
    expect(applied.messages).toEqual(expect.arrayContaining([expect.stringContaining('不可用目标 music')]))
    expect(state.items[1].selectedTargetLedgerIds).toEqual(['game'])
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
