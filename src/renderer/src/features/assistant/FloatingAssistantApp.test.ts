import { describe, expect, it } from 'vitest'
import type { FavoriteLedger } from '@shared/types'
import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { resolveFavoriteOrganizationLamp } from './FloatingAssistantApp'

const defaultLedger: FavoriteLedger = {
  id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true,
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
  it('keeps a default-system-disabled account idle instead of reporting a backup gap', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: false,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理空闲', tone: 'idle' })
  })

  it('给同名远程收藏夹冲突显示备册异常', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: {
        ok: false,
        ledgers: [defaultLedger],
        missingLedgerIds: ['knowledge'],
        backupConflictLedgerIds: ['knowledge'],
        message: '发现同名收藏夹'
      }
    })).toMatchObject({ label: '备册异常', tone: 'error' })
  })

  it('uses the backup status only when no real organization round is active', () => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: null,
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '未备册', tone: 'error' })

    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace('scanning'),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    })).toMatchObject({ label: '整理扫描中', tone: 'running' })
  })

  it.each([
    ['previewing', '等待确认'],
    ['frozen', '等待执行'],
    ['executing', '整理执行中'],
    ['reconciling', '等待对账'],
    ['completed', '整理完成']
  ] as const)('prioritizes the %s workspace state over backup status', (status, label) => {
    expect(resolveFavoriteOrganizationLamp({
      snapshot: workspace(status),
      defaultFavoriteSystemEnabled: true,
      ledgers: [defaultLedger],
      favoriteLedgerStatus: null
    }).label).toBe(label)
  })
})
