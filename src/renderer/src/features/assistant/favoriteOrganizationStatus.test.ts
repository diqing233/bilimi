import type { OldFavoriteWorkspaceSnapshot } from '@shared/oldFavoriteWorkspace'
import { describe, expect, it } from 'vitest'
import { favoriteOrganizationStatus } from './FloatingAssistantApp'

function workspace(overrides: Partial<OldFavoriteWorkspaceSnapshot>): OldFavoriteWorkspaceSnapshot {
  return {
    version: 1,
    accountMid: '100',
    workspaceId: 'workspace-100',
    status: 'previewing',
    mode: 'incremental',
    segmentSize: 2000,
    hasMultipleSegments: false,
    scan: { phase: 'complete', failureCount: 0 },
    continuationCount: 0,
    sourceFolders: [],
    segments: [],
    currentSegment: null,
    classifications: {},
    recommendations: { candidates: [], adoptedCandidateIds: [] },
    history: { cursor: 0, length: 0 },
    ...overrides
  }
}

describe('favoriteOrganizationStatus', () => {
  it('projects authoritative scan, confirmation, execution, reconciliation, and pending completion states', () => {
    expect(favoriteOrganizationStatus(workspace({ status: 'scanning', scan: { phase: 'tags', failureCount: 0 } }))).toMatchObject({
      label: '整理扫描中', tone: 'running'
    })
    expect(favoriteOrganizationStatus(workspace({ planReadiness: { selectedAidCount: 4, classifiedAidCount: 4, unclassifiedAidCount: 0 } }))).toMatchObject({
      label: '等待确认', tone: 'warn'
    })
    expect(favoriteOrganizationStatus(workspace({ status: 'executing', executionProgress: { completedOperationCount: 1, totalOperationCount: 4 } }))).toMatchObject({
      label: '整理执行中', tone: 'running'
    })
    expect(favoriteOrganizationStatus(workspace({ status: 'reconciling' }))).toMatchObject({
      label: '同步待检查', tone: 'warn'
    })
    expect(favoriteOrganizationStatus(workspace({
      status: 'completed',
      completionMode: 'bilibili',
      planReadiness: { selectedAidCount: 4, classifiedAidCount: 2, unclassifiedAidCount: 2 }
    }))).toMatchObject({ label: '整理完成，待备册', tone: 'warn' })
  })

  it('reports a stopped frozen sync as paused with durable progress', () => {
    expect(favoriteOrganizationStatus(workspace({
      status: 'frozen',
      executionProgress: {
        completedOperationCount: 180, totalOperationCount: 2298,
        lastFailureReason: 'invalid-response; http-status=412; content-type=text/html; response-category=html'
      }
    }))).toMatchObject({
      label: '同步已暂停', tone: 'warn', detail: expect.stringContaining('180 / 2298')
    })
  })

  it('reports scan failures instead of presenting a normal idle state', () => {
    expect(favoriteOrganizationStatus(workspace({
      status: 'scanning',
      scan: { phase: 'failed', failureCount: 1, reason: 'network unavailable' }
    }))).toMatchObject({ label: '整理异常', tone: 'error', detail: expect.stringContaining('network unavailable') })
  })

  it('reports a durable paused scan before any normal scan or tag-enrichment state', () => {
    expect(favoriteOrganizationStatus(workspace({
      status: 'scanning',
      scan: { phase: 'inventory', failureCount: 0, paused: true },
      tagEnrichment: {
        status: 'running', totalItemCount: 2_553, completedItemCount: 1_914,
        pendingItemCount: 639, failedItemCount: 0
      }
    }))).toMatchObject({
      label: '整理扫描已暂停',
      tone: 'warn',
      detail: expect.stringContaining('扫描已暂停')
    })
  })

  it('keeps tag enrichment visible as a running scan after source scanning completes', () => {
    expect(favoriteOrganizationStatus(workspace({
      tagEnrichment: {
        status: 'running', totalItemCount: 2_553, completedItemCount: 1_914,
        pendingItemCount: 639, failedItemCount: 0
      }
    }))).toMatchObject({
      label: '整理扫描中', tone: 'running', detail: expect.stringContaining('补取视频标签')
    })
  })
})
