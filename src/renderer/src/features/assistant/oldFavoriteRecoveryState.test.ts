import { describe, expect, it } from 'vitest'
import { classifyOldFavoriteRecoveryState } from './oldFavoriteRecoveryState'

function baseItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    aid: index + 1,
    title: `video-${index + 1}`,
    sourceFolderTitle: 'source',
    sourceFolderIds: ['source'],
    sourceFolderTitles: ['source'],
    currentBilimiFolderIds: [],
    targetLedgerId: 'knowledge',
    targetFolderId: 'target',
    targetDisplayName: 'bilimi knowledge',
    reviewRequired: false,
    alreadyInTarget: false,
    selected: true,
    originalSuggestedLedgerIds: ['knowledge'],
    currentTargetLedgerIds: ['knowledge'],
    selectedTargetLedgerIds: ['knowledge'],
    lowConfidence: false
  }))
}

describe('classifyOldFavoriteRecoveryState', () => {
  it('classifies a compact 242-item workspace with complete tag records as recoverable', () => {
    const base = baseItems(242)

    expect(classifyOldFavoriteRecoveryState({
      base,
      tags: base.map((item) => ({ aid: item.aid, tags: ['tag'] })),
      sources: base.map((item) => ({ aid: item.aid, sourceFolderIds: ['source'] }))
    })).toMatchObject({
      kind: 'recoverable',
      itemCount: 242,
      tagCoverage: 'complete',
      tagRecordCount: 242,
      missingTagAids: []
    })
  })

  it('counts an empty tags array as a completed tag record', () => {
    expect(classifyOldFavoriteRecoveryState({
      base: baseItems(2),
      tags: [{ aid: 1, tags: [] }, { aid: 2, tags: [] }],
      sources: []
    })).toMatchObject({
      kind: 'recoverable',
      tagCoverage: 'complete',
      tagRecordCount: 2,
      missingTagAids: []
    })
  })

  it('keeps a partially tagged workspace recoverable and identifies the missing aids', () => {
    expect(classifyOldFavoriteRecoveryState({
      base: baseItems(4),
      tags: [{ aid: 1, tags: ['one'] }, { aid: 3, tags: [] }],
      sources: []
    })).toMatchObject({
      kind: 'recoverable',
      itemCount: 4,
      tagCoverage: 'partial',
      tagRecordCount: 2,
      missingTagAids: [2, 4]
    })
  })

  it('returns a rescan classification for an empty workspace batch', () => {
    expect(classifyOldFavoriteRecoveryState({
      base: [],
      tags: [],
      sources: []
    })).toEqual({
      kind: 'rescan-required',
      reason: 'empty-workspace'
    })
  })

  it('rejects a malformed persisted base item', () => {
    expect(classifyOldFavoriteRecoveryState({
      base: [{ ...baseItems(1)[0], title: 42 }],
      tags: [],
      sources: []
    })).toEqual({
      kind: 'error',
      reason: 'corrupt-base'
    })
  })

  it('rejects a malformed persisted tag record', () => {
    expect(classifyOldFavoriteRecoveryState({
      base: baseItems(1),
      tags: [{ aid: 1, tags: 'not-an-array' }],
      sources: []
    })).toEqual({
      kind: 'error',
      reason: 'corrupt-tags'
    })
  })
})
