import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { defaultFavoriteSystemToggleAvailable, resolveFavoriteOrganizationLamp, SETTINGS_JUMP_OPTIONS } from './FloatingAssistantApp'

const defaultLedger: FavoriteLedger = {
  id: 'knowledge', displayName: 'bilimi\u00b7\u77e5\u8bc6', keywords: [], enabled: true,
  priority: 10, isDefault: true
}

function workspace(status: OldFavoriteWorkspaceSnapshot['status']): OldFavoriteWorkspaceSnapshot {
  return {
    version: 1, accountMid: '100', workspaceId: 'workspace', status, mode: 'incremental', segmentSize: 2_000,
    hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, sourceFolders: [],
    continuationCount: 0, segments: [], currentSegment: null, classifications: {},
    recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
  }
}

describe('resolveFavoriteOrganizationLamp', () => {
  it('places local data between the Bilibili connection setting and closing setting', () => {
    expect(SETTINGS_JUMP_OPTIONS.slice(-3).map((option) => option.value)).toEqual([
      'bilibili-connection',
      'local-data',
      'close'
    ])
  })

  it('requires a Bilibili account before editing the account-scoped default favorite system', () => {
    expect(defaultFavoriteSystemToggleAvailable(undefined)).toBe(false)
    expect(defaultFavoriteSystemToggleAvailable('100')).toBe(true)
  })

  it('keeps a default-system-disabled account idle instead of reporting a backup gap', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: false,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u6574\u7406\u7a7a\u95f2', tone: 'idle' })
  })

  it('\u7ed9\u540c\u540d\u8fdc\u7a0b\u6536\u85cf\u5939\u51b2\u7a81\u663e\u793a\u5907\u518c\u5f02\u5e38', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: {
        ok: false,
        ledgers: [defaultLedger],
        missingLedgerIds: ['knowledge'],
        backupConflictLedgerIds: ['knowledge'],
        message: '\u53d1\u73b0\u540c\u540d\u6536\u85cf\u5939'
      }
    })).toMatchObject({ label: '\u5907\u518c\u5f02\u5e38', tone: 'error' })
  })

  it('uses the backup status only when no real organization round is active', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u672a\u5907\u518c', tone: 'error' })

    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('scanning'),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '\u6574\u7406\u626b\u63cf\u4e2d', tone: 'running' })
  })

  it.each([
    ['previewing', '\u7b49\u5f85\u786e\u8ba4'],
    ['frozen', '\u7b49\u5f85\u6267\u884c'],
    ['executing', '\u6574\u7406\u6267\u884c\u4e2d'],
    ['reconciling', '\u7b49\u5f85\u5bf9\u8d26'],
    ['completed', '\u6574\u7406\u5b8c\u6210']
  ] as const)('prioritizes the %s workspace state over backup status', (status, label) => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace(status),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    }).label).toBe(label)
  })
})
