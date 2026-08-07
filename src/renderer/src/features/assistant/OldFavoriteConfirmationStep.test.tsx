import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'
import { OldFavoriteGuide } from './OldFavoriteGuide'

describe('OldFavoriteConfirmationStep', () => {
  it('defaults multi-batch confirmation to a compact whole-run summary while single batches keep the existing page', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }], segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ], currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 501, classifiedAidCount: 500, unclassifiedAidCount: 1 }, history: { cursor: 0, length: 0, entries: [] },
      overview: {
        available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 1, sourceFolders: [], recommendationCounts: [],
        processedItemCount: 500, classifiedItemCount: 499, unmatchedItemCount: 1, waitingItemCount: 1,
        archiveTargets: [
          { ledgerId: 'knowledge', itemCount: 499, segmentCounts: [{ segmentId: 'segment-1', count: 499 }] },
          { ledgerId: 'inbox', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] }
        ]
      }
    }
    const props = {
      loading: false, onSaveLocally: vi.fn(), onConfirmAndSync: vi.fn(), onExecuteFrozenPlan: vi.fn(), onReconcile: vi.fn()
    }
    const ledgers = [{ id: 'knowledge', displayName: '知识学习', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }]
    const rendered = render(<OldFavoriteConfirmationStep snapshot={snapshot} ledgers={ledgers} {...props} />)

    expect(screen.getByRole('group', { name: '确认执行视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(screen.getByText('已处理 500 条 · 已分类 499 条 · 暂存 1 条')).toBeInTheDocument()
    expect(screen.queryByText('等待扫描 1 条')).not.toBeInTheDocument()
    expect(screen.getByText('预计归档 499 条')).toBeInTheDocument()
    expect(screen.getByText('bilimi·暂存')).toBeInTheDocument()
    expect(screen.getByText('预计归档 1 条')).toBeInTheDocument()
    expect(screen.queryByText('默认不同步到 B 站')).not.toBeInTheDocument()
    expect(screen.getByText('知识学习')).toBeInTheDocument()
    expect(screen.queryByText('knowledge')).not.toBeInTheDocument()

    expect(screen.getByRole('group', { name: '本批操作' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '本轮操作' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveClass('favorite-ledger-panel__confirm-warning')

    fireEvent.click(screen.getByRole('button', { name: '当前批次' }))
    expect(screen.getByText('当前批次：第 1/2 批 · 500 条')).toBeInTheDocument()

    rendered.rerender(<OldFavoriteConfirmationStep snapshot={{ ...snapshot, hasMultipleSegments: false, segments: [snapshot.segments[0]] }} ledgers={ledgers} {...props} />)
    expect(screen.queryByRole('group', { name: '确认执行视图' })).not.toBeInTheDocument()
  })

  it('lets the user acknowledge a completed Bilibili sync', () => {
    const acknowledge = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'completed', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, completionMode: 'bilibili'
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
      onAcknowledgeCompletion={acknowledge}
    />)

    screen.getByRole('button', { name: '好的' }).click()
    expect(acknowledge).toHaveBeenCalledOnce()
  })

  it('shows a cancellable whole-run wait instead of executing incomplete batches', () => {
    const cancel = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 500, readiness: 'tagging', completedTagItemCount: 100, pendingTagItemCount: 400 }
        ], currentSegment: { id: 'segment-1', aids: [], items: [] }, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1000, classifiedAidCount: 400, unclassifiedAidCount: 600 }, history: { cursor: 0, length: 0, entries: [] },
        executionIntent: { mode: 'bilibili', status: 'waiting', waitingSegmentCount: 1, waitingForDeepSeek: true }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onCancelExecutionIntent={cancel}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('等待 1 个批次完成预处理')
    expect(screen.getByRole('status')).toHaveTextContent('DeepSeek 全轮整理完成后会自动继续')
    expect(screen.queryByRole('button', { name: '保存本轮到收藏库' })).not.toBeInTheDocument()
    screen.getByRole('button', { name: '取消等待执行' }).click()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('shows a claimed whole-run execution without offering a misleading cancel action', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] },
        executionIntent: { mode: 'local', status: 'running', waitingSegmentCount: 0, waitingForDeepSeek: false }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onCancelExecutionIntent={vi.fn()}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('正在执行本轮保存计划')
    expect(screen.queryByRole('button', { name: '取消等待执行' })).not.toBeInTheDocument()
  })

  it('queues whole-run actions without requiring every batch to be ready first', () => {
    const save = vi.fn()
    const sync = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 500, readiness: 'tagging', completedTagItemCount: 100, pendingTagItemCount: 400 }
        ], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
        classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1000, classifiedAidCount: 1, unclassifiedAidCount: 999 }, history: { cursor: 0, length: 0, entries: [] },
        overview: { available: true, completedSegmentCount: 1, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
          processedItemCount: 500, classifiedItemCount: 499, unmatchedItemCount: 1, waitingItemCount: 500,
          recommendationCounts: [], archiveTargets: [] }
      }}
      loading={false} onSaveLocally={save} onConfirmAndSync={sync} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('未匹配到合适分类 1 条')
    expect(screen.getByRole('alert')).toHaveTextContent('会存入 bilimi·暂存')
    expect(screen.getByRole('alert')).not.toHaveTextContent('999 条未分类')
    screen.getByRole('button', { name: '保存本轮到收藏库' }).click()
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))
    expect(save).toHaveBeenCalledOnce()
    expect(screen.getByRole('checkbox', { name: '同步 bilimi·暂存（1 条）' })).not.toBeChecked()
    screen.getByRole('button', { name: '确认同步' }).click()
    expect(sync).toHaveBeenCalledWith(false)
  })

  it('includes bilimi staging only when explicitly checked in the one-time sync confirmation', () => {
    const sync = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [{ id: 'segment-1', index: 0, status: 'previewing', itemCount: 2, readiness: 'ready' }],
        currentSegment: { id: 'segment-1', aids: [1, 2], items: [] },
        classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={sync} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '同步 bilimi·暂存（1 条）' }))
    fireEvent.click(screen.getByRole('button', { name: '确认同步' }))

    expect(sync).toHaveBeenCalledWith(true)
  })

  it('lets the user abandon a previewed organization round before any sync starts', () => {
    const abandon = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onAbandonCurrentWorkspace={abandon} onConfirmAndSync={vi.fn()}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    screen.getByRole('button', { name: '\u653e\u5f03\u672c\u8f6e\u6574\u7406' }).click()
    expect(abandon).toHaveBeenCalledOnce()
  })

  it('uses the batch-finish action after a saved batch instead of abandoning the whole round', () => {
    const finishBatch = vi.fn()
    const abandon = vi.fn()
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [{ id: 'segment-1', index: 0, status: 'frozen', itemCount: 1, readiness: 'saved', completedTagItemCount: 1, pendingTagItemCount: 0 }],
        currentSegment: { id: 'segment-1', aids: [1], items: [] }, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onAbandonCurrentWorkspace={abandon} onFinishCurrentSegment={finishBatch}
      onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    screen.getByRole('button', { name: '暂不同步结束本批整理' }).click()
    expect(finishBatch).toHaveBeenCalledOnce()
    expect(abandon).not.toHaveBeenCalled()
  })

  it('explains selection sync as replacing only bilimi-managed memberships', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        scope: { kind: 'selection', aids: [1] },
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByText(/会替换所选视频在 bilimi 管理收藏夹中的归属/)).toBeInTheDocument()
    expect(screen.getByText(/不会删除或取消用户自己的收藏夹关系/)).toBeInTheDocument()
  })

  it('keeps account-wide sync copy append-only', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        scope: { kind: 'account' },
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByText(/确认同步只会追加到 bilimi 收藏夹/)).toBeInTheDocument()
  })

  it('keeps local save and Bilibili sync available for the classified portion of an incomplete plan', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 }, history: { cursor: 0, length: 0, entries: [] }
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
    expect(screen.getByRole('alert')).toHaveTextContent('bilimi·暂存')
  })

  it('keeps local save available when every selected video is unclassified', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 2, classifiedAidCount: 0, unclassifiedAidCount: 2 }, history: { cursor: 0, length: 0, entries: [] }
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
        segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 }
        ], currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] }, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        overview: { available: true, completedSegmentCount: 2, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
          processedItemCount: 1000, classifiedItemCount: 1000, unmatchedItemCount: 0, waitingItemCount: 0,
          recommendationCounts: [], archiveTargets: [] },
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 3, totalOperationCount: 8 }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('group', { name: '确认执行视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '当前批次' }))
    expect(screen.getByText('当前批次：第 1/2 批 · 500 条')).toBeInTheDocument()
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
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 180, totalOperationCount: 2298 }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={reconcile}
    />)

    screen.getByRole('button', { name: '重新连接并检查同步结果' }).click()
    expect(reconcile).toHaveBeenCalledOnce()
    expect(screen.getByRole('progressbar', { name: '同步到 B 站进度' })).toHaveAttribute('value', '180')
    expect(screen.getByRole('progressbar', { name: '同步到 B 站进度' })).toHaveAttribute('max', '2298')
  })

  it('explains an embedded HTML response and disables retry during its cooldown', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'frozen', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: {
          completedOperationCount: 105, totalOperationCount: 1880,
          lastFailureReason: 'invalid-response; http-status=200; content-type=text/html; response-category=html',
          retryAvailableAt: '2099-07-19T00:00:30.000Z'
        }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 200')
    expect(screen.getByRole('alert')).toHaveTextContent('HTML')
    expect(screen.getByRole('alert')).toHaveTextContent('可能是嵌入页面临时验证或限制')
    expect(screen.getByRole('status')).toHaveTextContent('B 站同步已暂停')
    expect(screen.getByRole('status')).toHaveTextContent('已完成 105 / 1880 条')
    expect(screen.getByRole('button', { name: /等待 .* 后重试/ })).toBeDisabled()
  })

  it('keeps every guide page and batch selector browseable while execution locks mutations', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'executing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Saved item', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [{ id: 'author-up', displayName: 'Saved UP', kind: 'author' as const, count: 1, reason: 'Saved recommendation' }], adoptedCandidateIds: ['author-up'] },
      history: { cursor: 1, length: 1, entries: [] }, executionProgress: { completedOperationCount: 1, totalOperationCount: 2 }
    }
    const props = {
      snapshot, loading: false, mutationLocked: true, reconciling: false, preparationStatus: null, executionError: null,
      scanStarting: false, scanStartFailure: null, onStepChange: vi.fn(), onRetryScan: vi.fn(), onRetryScanDirect: vi.fn(),
      onRebuildWorkspace: vi.fn(), onSelectSourceFolders: vi.fn(), onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(),
      onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn(), onSetRecommendedCandidates: vi.fn(), ledgers: [{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }],
      deepSeekAvailable: true, deepSeekFeedback: null, onSelectSegment: vi.fn(), onAutoClassify: vi.fn(), onOrganizeWithDeepSeek: vi.fn(),
      onRetryFailedDeepSeekChunks: vi.fn(), onCancelDeepSeek: vi.fn(), deepSeekCancelRequested: false, onUndoClassification: vi.fn(),
      onRedoClassification: vi.fn(), onMoveHistoryCursor: vi.fn(), onApplyManualClassification: vi.fn(), onApplyManualClassifications: vi.fn(),
      onSaveLocally: vi.fn(), onConfirmAndSync: vi.fn(), onExecuteFrozenPlan: vi.fn(), onReconcile: vi.fn()
    }
    const { rerender } = render(<OldFavoriteGuide {...props} step="generated" />)

    for (const label of ['扫描概览', '推荐收藏夹', '归档预览', '确认执行']) {
      expect(screen.getByRole('button', { name: label })).toBeEnabled()
    }
    expect(screen.getByRole('combobox', { name: '整理批次' })).toBeEnabled()
    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-2' } })
    expect(props.onSelectSegment).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'Saved UP' })).toBeDisabled()

    rerender(<OldFavoriteGuide {...props} step="preview" />)
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '转移 Saved item' })).toBeDisabled()
  })

  it('loads the selected batch for read-only inspection without changing the working batch', async () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'executing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }], segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Working item', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }
    const viewed = {
      ...snapshot,
      currentSegment: { id: 'segment-2', aids: [2], items: [{ aid: 2, title: 'Viewed item', sourceFolderIds: ['source'] }] },
      classifications: { '2': { aid: 2, targetLedgerIds: ['music'], source: 'system-high' as const } }
    }
    const onViewSegment = vi.fn().mockResolvedValue(viewed)
    render(<OldFavoriteGuide
      snapshot={snapshot} loading={false} mutationLocked reconciling={false} scanStarting={false} scanStartFailure={null}
      step="preview" onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()}
      onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()}
      onAcceptCurrentTags={vi.fn()} onSetRecommendedCandidates={vi.fn()} ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      deepSeekAvailable deepSeekFeedback={{ status: 'running', message: 'Working' }} onSelectSegment={vi.fn()} onViewSegment={onViewSegment}
      onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()}
      deepSeekCancelRequested={false} onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()}
      onApplyManualClassification={vi.fn()} onApplyManualClassifications={vi.fn()} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '转移 Working item' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-2' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '转移 Viewed item' })).toBeInTheDocument())
    expect(onViewSegment).toHaveBeenCalledWith('segment-2')
  })

  it('replaces stale sync progress with reconciliation feedback as soon as checking starts', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'executing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 100, totalOperationCount: 244 }
      }}
      loading={true} reconciling
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('正在检查 B 站同步结果')
    expect(screen.getByRole('button', { name: '正在检查…' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: '同步到 B 站进度' })).toHaveAttribute('value', '100')
  })

  it('passes the immediate reconciliation state through the confirmation guide', () => {
    render(<OldFavoriteGuide
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'executing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 100, totalOperationCount: 244 }
      }}
      loading reconciling preparationStatus={null} executionError={null} scanStarting={false} scanStartFailure={null} step="confirm"
      onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()} onSelectSourceFolders={vi.fn()}
      onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
      onSetRecommendedCandidates={vi.fn()} ledgers={[]} deepSeekAvailable={false} deepSeekFeedback={null} onSelectSegment={vi.fn()}
      onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()}
      onApplyManualClassifications={vi.fn()} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('正在检查 B 站同步结果')
    expect(screen.getByRole('progressbar', { name: '同步到 B 站进度' })).toHaveAttribute('value', '100')
  })

  it.each([
    { label: 'frozen status', status: 'frozen' as const, readiness: 'ready' as const },
    { label: 'saved readiness', status: 'previewing' as const, readiness: 'saved' as const }
  ])('keeps $label batches editable while keeping the segment selector available', ({ status, readiness }) => {
    const onSelectSegment = vi.fn()
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 1, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status, readiness, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Saved item', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: {
        candidates: [{ id: 'author-up', displayName: 'Saved UP', kind: 'author' as const, count: 2, reason: 'Saved recommendation' }],
        adoptedCandidateIds: ['author-up']
      },
      history: { cursor: 1, length: 2, entries: [] }
    }
    const SavedGuide = ({ step }: { step: 'generated' | 'preview' }) => <OldFavoriteGuide
      snapshot={snapshot}
      loading={false} reconciling={false} preparationStatus={null} executionError={null} scanStarting={false} scanStartFailure={null} step={step}
      onStepChange={vi.fn()} onRetryScan={vi.fn()} onRetryScanDirect={vi.fn()} onRebuildWorkspace={vi.fn()} onSelectSourceFolders={vi.fn()}
      onPauseTagEnrichment={vi.fn()} onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
      onSetRecommendedCandidates={vi.fn()} ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      deepSeekAvailable deepSeekFeedback={null} onSelectSegment={onSelectSegment}
      onAutoClassify={vi.fn()} onOrganizeWithDeepSeek={vi.fn()} onRetryFailedDeepSeekChunks={vi.fn()} onCancelDeepSeek={vi.fn()} deepSeekCancelRequested={false}
      onUndoClassification={vi.fn()} onRedoClassification={vi.fn()} onMoveHistoryCursor={vi.fn()} onApplyManualClassification={vi.fn()}
      onApplyManualClassifications={vi.fn()} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()}
      onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />
    const { rerender } = render(<SavedGuide step="generated" />)

    const selector = screen.getByRole('combobox', { name: '整理批次' })
    expect(selector).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Saved UP' })).toBeEnabled()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    expect(onSelectSegment).toHaveBeenCalledWith('segment-2')

    rerender(<SavedGuide step="preview" />)
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '转移 Saved item' })).toBeEnabled()
    expect(within(screen.getByRole('group', { name: 'Music 1 条' })).getByRole('button', { name: '批量转移' })).toBeEnabled()
  })

  it('shows reconciliation progress and restores an actionable retry after a failed check', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling' as const, mode: 'incremental' as const,
      segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 180, totalOperationCount: 2298 }
    }
    const { rerender } = render(<OldFavoriteConfirmationStep snapshot={snapshot} loading={true}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在检查 B 站同步结果')
    expect(screen.getByRole('button', { name: '正在检查…' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: '同步到 B 站进度' })).toHaveAttribute('value', '180')

    rerender(<OldFavoriteConfirmationStep snapshot={snapshot} loading={false} executionError="B 站结果暂时无法确认，请检查页面后重试。"
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('B 站结果暂时无法确认')
    expect(screen.getByRole('button', { name: '重新连接并检查同步结果' })).toBeEnabled()
  })

  it('keeps a main-process confirmation failure visible beneath the actions', () => {
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} executionError="无法确认当前 B 站页面，请保持已登录的 B 站页面打开后重试。"
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('无法确认当前 B 站页面')
  })

  it('shows the exact failed DeepSeek count, blocks execution, and requires explicit fallback confirmation', () => {
    const fallback = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OldFavoriteConfirmationStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        deepSeekRun: { mode: 'all', scope: 'all', status: 'failed', completedSegmentCount: 0, waitingSegmentCount: 0,
          totalVideoCount: 12, successfulVideoCount: 9, pendingVideoCount: 0, failedVideoCount: 3 },
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        planReadiness: { selectedAidCount: 12, classifiedAidCount: 12, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onUseOriginalClassifications={fallback}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()}
    />)

    expect(screen.getByRole('alert')).toHaveTextContent('3 条视频的 DeepSeek 整理失败')
    expect(screen.getByRole('button', { name: '仅保存本轮到收藏库' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '沿用 3 条视频的原自动分类' }))
    expect(confirm).toHaveBeenCalledWith('确认让 3 条 DeepSeek 失败视频沿用整理前的自动分类吗？此选择会写入本轮改动记录。')
    expect(fallback).toHaveBeenCalledOnce()
    confirm.mockRestore()
  })
})
