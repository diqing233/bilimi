import { describe, expect, it } from 'vitest'
import {
  applyAidCorrectionMemory,
  confirmCorrectionDrafts,
  createCorrectionDraft,
  discardCorrectionDrafts,
  isArchiveAdjustmentRecordableSource,
  normalizeCorrectionRecords,
  normalizeKeywordSuggestions
} from './correctionLearning'

describe('correctionLearning', () => {
  it('records only card transfers and DeepSeek archive divergences', () => {
    expect(isArchiveAdjustmentRecordableSource('transfer')).toBe(true)
    expect(isArchiveAdjustmentRecordableSource('deepseek')).toBe(true)
    expect(isArchiveAdjustmentRecordableSource('user')).toBe(false)
    expect(isArchiveAdjustmentRecordableSource('classifier')).toBe(false)
    expect(isArchiveAdjustmentRecordableSource('rejudge')).toBe(false)
  })

  it('keeps preview corrections as drafts until execution confirms them', () => {
    const draft = createCorrectionDraft({
      aid: 1,
      title: '星铁剧情解析',
      originalLedgerId: 'movie-tv',
      userLedgerIds: ['game'],
      sourceScene: 'archive-preview',
      source: 'user',
      tags: ['星铁']
    })

    expect(draft.confirmedAt).toBeUndefined()
    expect(confirmCorrectionDrafts([draft], '2026-07-05T00:00:00.000Z')[0].confirmedAt).toBe(
      '2026-07-05T00:00:00.000Z'
    )
  })

  it('uses aid-level memory before normal classification when enabled', () => {
    const record = confirmCorrectionDrafts(
      [
        createCorrectionDraft({
          aid: 1,
          title: '东京旅行攻略',
          originalLedgerId: 'game',
          userLedgerIds: ['life-interest'],
          sourceScene: 'archive-preview',
          source: 'user',
          tags: []
        })
      ],
      '2026-07-05T00:00:00.000Z'
    )[0]

    expect(applyAidCorrectionMemory({ aid: 1 }, [record])?.ledgerIds).toEqual(['life-interest'])
  })

  it('discards correction drafts by aid without removing confirmed records', () => {
    const firstDraft = createCorrectionDraft({
      aid: 1,
      title: '错误分到游戏的视频',
      originalLedgerId: 'game',
      userLedgerIds: ['knowledge'],
      sourceScene: 'archive-preview',
      source: 'user',
      tags: []
    })
    const secondDraft = createCorrectionDraft({
      aid: 2,
      title: '另一个草稿',
      userLedgerIds: ['music'],
      sourceScene: 'archive-preview',
      source: 'deepseek',
      tags: []
    })
    const confirmed = confirmCorrectionDrafts([firstDraft], '2026-07-05T00:00:00.000Z')[0]

    expect(discardCorrectionDrafts([firstDraft, secondDraft, confirmed], 1)).toEqual([secondDraft, confirmed])
    expect(discardCorrectionDrafts([firstDraft, secondDraft])).toEqual([])
  })

  it('normalizes keyword suggestions to known actions and statuses', () => {
    expect(
      normalizeKeywordSuggestions([
        {
          id: 'keep',
          action: 'add-keyword',
          ledgerId: 'game',
          keyword: '星铁',
          reason: '用户多次纠正到游戏',
          source: 'user',
          status: 'accepted',
          createdAt: '2026-07-05T00:00:00.000Z'
        },
        {
          id: 'bad-action',
          action: 'invent-action',
          reason: 'invalid',
          source: 'user',
          status: 'pending',
          createdAt: '2026-07-05T00:00:00.000Z'
        },
        {
          id: 'bad-status',
          action: 'remove-keyword',
          reason: 'invalid',
          source: 'user',
          status: 'archived',
          createdAt: '2026-07-05T00:00:00.000Z'
        }
      ] as never)
    ).toEqual([
      {
        id: 'keep',
        action: 'add-keyword',
        ledgerId: 'game',
        keyword: '星铁',
        reason: '用户多次纠正到游戏',
        source: 'user',
        status: 'accepted',
        createdAt: '2026-07-05T00:00:00.000Z'
      }
    ])
  })

  it('drops non-object keyword suggestions instead of throwing', () => {
    expect(normalizeKeywordSuggestions([null, 'bad'] as never)).toEqual([])
  })

  it('ignores malformed confirmed records during aid memory lookup', () => {
    expect(
      applyAidCorrectionMemory({ aid: 1 }, [
        {
          id: 'bad-record',
          aid: 1,
          title: 'bad',
          source: 'user',
          feedbackType: 'strong-correction',
          sourceScene: 'archive-preview',
          confirmedAt: '2026-07-05T00:00:00.000Z'
        }
      ] as never)
    ).toBeNull()
  })

  it('filters malformed ledger ids from correction records', () => {
    const records = normalizeCorrectionRecords([
      {
        id: 'record-1',
        aid: 1,
        title: 'same video',
        userLedgerIds: [123, ' ', 'game'],
        source: 'user',
        feedbackType: 'strong-correction',
        sourceScene: 'archive-preview',
        tags: [],
        matchedKeywords: [],
        createdAt: '2026-07-05T00:00:00.000Z',
        confirmedAt: '2026-07-05T00:00:01.000Z'
      }
    ] as never)

    expect(records[0]?.userLedgerIds).toEqual(['game'])
    expect(applyAidCorrectionMemory({ aid: 1 }, records)?.ledgerIds).toEqual(['game'])
  })

  it('creates distinct draft ids for repeated corrections on the same aid', () => {
    const firstDraft = createCorrectionDraft({
      aid: 1,
      title: 'same video',
      userLedgerIds: ['game'],
      sourceScene: 'archive-preview',
      source: 'user',
      tags: [],
      createdAt: '2026-07-05T00:00:00.000Z'
    })
    const secondDraft = createCorrectionDraft({
      aid: 1,
      title: 'same video',
      userLedgerIds: ['knowledge'],
      sourceScene: 'archive-preview',
      source: 'user',
      tags: [],
      createdAt: '2026-07-05T00:00:01.000Z'
    })

    expect(secondDraft.id).not.toBe(firstDraft.id)
  })
})
