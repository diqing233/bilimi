import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteConfirmationStep } from './OldFavoriteConfirmationStep'
import { OldFavoriteGuide } from './OldFavoriteGuide'

describe('OldFavoriteConfirmationStep', () => {
  it('defaults multi-batch confirmation to a compact whole-run summary while single batches keep the existing page', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [
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
    expect(screen.getByText('已处理 500 条 · 已分类 499 条 · 未匹配 1 条')).toBeInTheDocument()
    expect(screen.getByText('等待预处理 1 条')).toBeInTheDocument()
    expect(screen.getByText('预计归档 499 条')).toBeInTheDocument()
    expect(screen.getByText('暂存')).toBeInTheDocument()
    expect(screen.getByText('预计归档 1 条')).toBeInTheDocument()
    expect(screen.getByText('知识学习')).toBeInTheDocument()
    expect(screen.queryByText('knowledge')).not.toBeInTheDocument()

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

    expect(screen.getByRole('alert')).toHaveTextContent('1 条未匹配视频会保存到本地暂存')
    expect(screen.getByRole('alert')).not.toHaveTextContent('999 条未分类')
    screen.getByRole('button', { name: '保存本轮到收藏库' }).click()
    screen.getByRole('button', { name: '确认并同步到 B 站' }).click()
    expect(save).toHaveBeenCalledOnce()
    expect(sync).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('alert')).toHaveTextContent('\u672c\u5730\u6682\u5b58')
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
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 }, continuationCount: 0,
        sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, executionProgress: { completedOperationCount: 3, totalOperationCount: 8 }
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
        history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={reconcile}
    />)

    screen.getByRole('button', { name: '对账 B 站结果' }).click()
    expect(reconcile).toHaveBeenCalledOnce()
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

    expect(screen.getByRole('status')).toHaveTextContent('正在对账 B 站结果')
    expect(screen.queryByRole('progressbar', { name: '正在同步到 B 站' })).not.toBeInTheDocument()
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

    expect(screen.getByRole('status')).toHaveTextContent('正在对账 B 站结果')
    expect(screen.queryByRole('progressbar', { name: '正在同步到 B 站' })).not.toBeInTheDocument()
  })

  it.each([
    { label: 'frozen status', status: 'frozen' as const, readiness: 'ready' as const },
    { label: 'saved readiness', status: 'previewing' as const, readiness: 'saved' as const }
  ])('locks $label mutations while keeping the segment selector available', ({ status, readiness }) => {
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
    expect(screen.getByRole('checkbox', { name: 'Saved UP' })).toBeDisabled()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    expect(onSelectSegment).toHaveBeenCalledWith('segment-2')

    rerender(<SavedGuide step="preview" />)
    expect(screen.getByRole('button', { name: 'DeepSeek 整理' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '撤销本次改动' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复本次改动' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '转移 Saved item' })).toBeDisabled()
    expect(within(screen.getByRole('group', { name: 'Music 1 条' })).getByRole('button', { name: '批量转移' })).toBeDisabled()
  })

  it('shows reconciliation progress and restores an actionable retry after a failed check', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling' as const, mode: 'incremental' as const,
      segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const { rerender } = render(<OldFavoriteConfirmationStep snapshot={snapshot} loading={true}
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)

    expect(screen.getByRole('status')).toHaveTextContent('正在对账 B 站结果')
    expect(screen.getByRole('button', { name: '对账 B 站结果' })).toBeDisabled()

    rerender(<OldFavoriteConfirmationStep snapshot={snapshot} loading={false} executionError="B 站结果暂时无法确认，请检查页面后重试。"
      onSaveLocally={vi.fn()} onConfirmAndSync={vi.fn()} onExecuteFrozenPlan={vi.fn()} onReconcile={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('B 站结果暂时无法确认')
    expect(screen.getByRole('button', { name: '对账 B 站结果' })).toBeEnabled()
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
})
