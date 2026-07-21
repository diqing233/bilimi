import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'

describe('OldFavoriteConfirmationStep', () => {
  it('keeps local save and Bilibili sync available for the classified portion of an incomplete plan', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 }, history: { cursor: 0, length: 0 }
      }}
      loading={false}
      onSaveLocally={vi.fn()}
      onConfirmAndSync={vi.fn()}
      onExecuteFrozenPlan={vi.fn()}
      onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveClass('favorite-ledger-panel__confirm-warning')
    expect(screen.getByRole('button', { name: '\u4ec5\u4fdd\u5b58\u672c\u8f6e\u5230\u6536\u85cf\u5e93' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '\u786e\u8ba4\u5e76\u540c\u6b65\u5230 B \u7ad9' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('\u672c\u5730\u6682\u5b58')
  })

  it('keeps local save available when every selected video is unclassified', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 0, unclassifiedAidCount: 2 }, history: { cursor: 0, length: 0 }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '\u4ec5\u4fdd\u5b58\u672c\u8f6e\u5230\u6536\u85cf\u5e93' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '\u786e\u8ba4\u5e76\u540c\u6b65\u5230 B \u7ad9' })).toBeDisabled()
  })

  it('shows main-process execution progress while the frozen plan is syncing', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'executing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0 }, executionProgress: { completedOperationCount: 3, totalOperationCount: 8 }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('已完成 3 / 8 条')
    expect(screen.getByRole('progressbar', { name: '正在同步到 B 站' })).toHaveAttribute('value', '3')
    expect(screen.getByRole('progressbar', { name: '正在同步到 B 站' })).toHaveAttribute('max', '8')
    expect(screen.queryByRole('button', { name: '对账 B 站结果' })).not.toBeInTheDocument()
  })

  it('offers reconciliation only after the main process marks the remote result uncertain', () => {
    const reconcile = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0 }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={reconcile}
    />)

    screen.getByRole('button', { name: '对账 B 站结果' }).click()
    expect(reconcile).toHaveBeenCalledOnce()
  })

  it('keeps a main-process confirmation failure visible beneath the actions', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0 }
      }}
      loading={false} executionError="无法确认当前 B 站页面，请保持已登录的 B 站页面打开后重试。"
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('无法确认当前 B 站页面')
  })
})
