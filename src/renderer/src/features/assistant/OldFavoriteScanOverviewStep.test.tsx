import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OldFavoriteScanOverviewStep } from './OldFavoriteScanOverviewStep'

describe('OldFavoriteScanOverviewStep', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers pause and end actions while inventory scanning, then offers manual resume after pause', () => {
    const pause = vi.fn()
    const finish = vi.fn()
    const { rerender } = render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0, totalItemCount: 40, scannedItemCount: 21 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
       onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
       onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
       onPauseScan={pause} onResumeScan={vi.fn()} onFinishScan={finish}
     />)

    expect(screen.getByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂停扫描' }))
    fireEvent.click(screen.getByRole('button', { name: '结束整理' }))
    expect(pause).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledOnce()

    rerender(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-1', status: 'scanning', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0, paused: true, totalItemCount: 40, scannedItemCount: 21 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
      onPauseScan={vi.fn()} onResumeScan={pause} onFinishScan={finish}
    />)

    fireEvent.click(screen.getByRole('button', { name: '继续扫描' }))
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('disables a Bilibili 412 rescan until the persisted ten-minute cooldown expires', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-19T00:00:00.000Z'))
    const retry = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: {
          phase: 'failed', failureCount: 1,
          reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
          retryAvailableAt: '2026-07-19T00:10:00.000Z'
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={retry} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const button = screen.getByRole('button', { name: '等待 10:00 后重试' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(retry).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('B站暂时限制了请求')
    now.mockRestore()
  })

  it('keeps an ordinary network scan failure immediately retryable', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'failed', failureCount: 1, reason: 'network-failure' },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '继续扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '本次直连后继续扫描' })).toBeEnabled()
  })

  it('offers an explicit from-scratch scan separately from continuing saved pages', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'failed', failureCount: 1, reason: 'target-unavailable', totalItemCount: 40, scannedItemCount: 21 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRestart={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '继续扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '从头重新扫描' })).toBeEnabled()
  })

  it('keeps persisted scan progress visible after a failed page read', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: {
          phase: 'failed', failureCount: 1, totalItemCount: 40, scannedItemCount: 21,
          taggedItemCount: 4, untaggedItemCount: 17, reason: 'network-failure'
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('progressbar', { name: '收藏扫描进度' })).toHaveValue(21)
    expect(screen.getByText('已读取 21 个去重视频 · 本轮共 40 条收藏关系')).toBeInTheDocument()
    expect(screen.queryByLabelText('标签识别进度')).not.toBeInTheDocument()
  })

  it('unlocks the rescan button after cooldown without starting a scan automatically', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-07-19T00:09:59.000Z')
    const retry = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: {
          phase: 'failed', failureCount: 1,
          reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
          retryAvailableAt: '2026-07-19T00:10:00.000Z'
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={retry} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '等待 0:01 后重试' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByRole('button', { name: '检测并继续扫描' })).toBeEnabled()
    expect(retry).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows that an expired 412 retry is checking favorite access before scanning', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-19T00:10:00.000Z'))
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: {
          phase: 'failed', failureCount: 1,
          reason: 'invalid-response [category=non-json http=412 content-type=text/html]',
          retryAvailableAt: '2026-07-19T00:10:00.000Z'
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      loading={true} scanStarting={true} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '正在检测收藏读取…' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('正在检查 B 站收藏读取是否已恢复')
  })

  it('keeps global compact inventory facts stable while current and whole-run organization scopes remain distinct', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const, mode: 'incremental' as const,
      segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 501, scannedItemCount: 501, taggedItemCount: 500, untaggedItemCount: 1 },
      inventoryMetrics: {
        authority: 'complete' as const, relationshipCount: 501, plannedAidCount: 500, protectedAidCount: 0, unavailableAidCount: 1,
        sourceFolders: [{ id: 'source', title: '默认收藏夹', relationshipCount: 501, plannedAidCount: 500, protectedAidCount: 0, unavailableAidCount: 1, selected: true, isBilimiWorkFolder: false, confirmed: true }]
      },
      currentSegmentMetrics: { plannedAidCount: 500, sourceFolders: [{ id: 'source', plannedAidCount: 1 }] },
      continuationCount: 0,
      sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 501, invalidItemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Current', sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
      tagEnrichment: {
        status: 'running' as const, totalItemCount: 3, completedItemCount: 0, pendingItemCount: 3, failedItemCount: 0,
        scopes: {
          currentSegment: { totalItemCount: 500, completedItemCount: 498, pendingItemCount: 2, failedItemCount: 0, reusedTagItemCount: 498, fetchedTagItemCount: 0, confirmedUntaggedItemCount: 0 },
          wholeRun: { totalItemCount: 501, completedItemCount: 498, pendingItemCount: 3, failedItemCount: 0, reusedTagItemCount: 498, fetchedTagItemCount: 0, confirmedUntaggedItemCount: 0 }
        }
      },
      overview: {
        available: true, completedSegmentCount: 1, totalSegmentCount: 2, unavailableItemCount: 1,
        sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 500, invalidItemCount: 1 }],
        recommendationCounts: [], archiveTargets: []
      }
    }
    const props = {
      loading: false, scanStarting: false, scanStartFailure: null, onRetry: vi.fn(), onRetryDirect: vi.fn(),
      onRebuild: vi.fn(), onSelectSourceFolders: vi.fn(), onPauseTagEnrichment: vi.fn(), onResumeTagEnrichment: vi.fn(),
      onRetryFailedTagEnrichment: vi.fn(), onAcceptCurrentTags: vi.fn()
    }
    const rendered = render(<OldFavoriteScanOverviewStep snapshot={snapshot} {...props} />)

    expect(screen.getByRole('group', { name: '扫描概览视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮总览' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('已汇总 1/2 批')).toBeInTheDocument()
    expect(screen.getByLabelText('本轮待整理')).toHaveTextContent('本轮待整理500')
    expect(screen.getByText('标签补取进行中：已处理 498 / 501 条。')).toBeInTheDocument()
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('沿用历史标签498')
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('默认收藏夹501500')

    fireEvent.click(screen.getByRole('button', { name: '当前批次' }))
    expect(screen.getByRole('button', { name: '当前批次' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('已汇总 1/2 批')).not.toBeInTheDocument()
    expect(screen.getByLabelText('本批待整理')).toHaveTextContent('本批待整理500')
    expect(screen.getByText('标签补取进行中：已处理 498 / 500 条。')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('本批来源关系')
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('默认收藏夹5011')

    rendered.rerender(<OldFavoriteScanOverviewStep snapshot={{ ...snapshot, hasMultipleSegments: false, segments: [snapshot.segments[0]] }} {...props} />)
    expect(screen.queryByRole('group', { name: '扫描概览视图' })).not.toBeInTheDocument()
  })

  it('shows unique current-batch video metrics while retaining duplicated source relationships', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 500, hasMultipleSegments: true,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 2_767, scannedItemCount: 2_767, taggedItemCount: 94, untaggedItemCount: 2_458 },
        inventoryMetrics: {
          authority: 'complete', relationshipCount: 2_866, plannedAidCount: 2_552, protectedAidCount: 0, unavailableAidCount: 215,
          sourceFolders: [
            { id: 'default', title: '默认收藏夹', relationshipCount: 1_273, plannedAidCount: 1_262, protectedAidCount: 0, unavailableAidCount: 11, selected: true, isBilimiWorkFolder: false, confirmed: true },
            { id: 'duplicate', title: '重复来源', relationshipCount: 1_593, plannedAidCount: 1_290, protectedAidCount: 0, unavailableAidCount: 204, selected: true, isBilimiWorkFolder: false, confirmed: true }
          ]
        },
        currentSegmentMetrics: {
          plannedAidCount: 500,
          sourceFolders: [
            { id: 'default', plannedAidCount: 500 },
            { id: 'duplicate', plannedAidCount: 5 }
          ]
        },
        continuationCount: 0,
        sourceFolders: [
          { id: 'default', title: '默认收藏夹', itemCount: 1_273, invalidItemCount: 11, isBilimiWorkFolder: false, selected: true },
          { id: 'duplicate', title: '重复来源', itemCount: 1_593, invalidItemCount: 204, isBilimiWorkFolder: false, selected: true }
        ],
        segments: [
          { id: 'segment-1', index: 0, status: 'previewing', itemCount: 500, readiness: 'ready', completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing', itemCount: 500, readiness: 'tagging', completedTagItemCount: 0, pendingTagItemCount: 500 }
        ],
        currentSegment: { id: 'segment-2', aids: [501], items: [{ aid: 501, title: 'Current', sourceFolderIds: ['default', 'duplicate'] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      viewScope="current"
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const metrics = screen.getByLabelText('本批整理统计')
    expect(metrics).toHaveTextContent('本批视频500')
    expect(metrics).toHaveTextContent('本批待整理500')
    expect(within(metrics).queryByText('已保护跳过')).not.toBeInTheDocument()
    expect(within(metrics).queryByText('失效视频')).not.toBeInTheDocument()
    const table = screen.getByRole('table', { name: '用户收藏夹' })
    expect(within(table).getByRole('columnheader', { name: '总数（2866）' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: '本批来源关系（505）' })).toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: '本批来源关系（505）' })).not.toBeInTheDocument()
  })

  it('keeps the scan view mounted when a scan reports a rebuild-required recovery state', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{ recovery: 'rebuild-required', preserveCompletedLocalResults: true, accountMid: '100', workspaceId: 'workspace-100' }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByRole('region', { name: '扫描概览' })).toHaveTextContent('工作镜像损坏')
    expect(screen.getByRole('button', { name: '重建工作镜像并重新扫描' })).toBeEnabled()
  })

  it('shows an unstarted state until the user starts old-favorite organization', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={null} loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('尚未开始扫描，请点击“整理收藏”后扫描。')).toBeInTheDocument()
    expect(screen.getByText('尚未开始')).toBeInTheDocument()
    expect(screen.queryByText('正在扫描')).not.toBeInTheDocument()
  })

  it('reports formally protected videos skipped by an incremental scan', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false, scan: { phase: 'complete', failureCount: 0 },
        protectedAidCount: 3, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('本轮扫描与标签补取已完成。请在「推荐收藏夹」选择或新建要参与分类的收藏夹；随后到「归档预览」检查并调整结果，最后确认保存或同步。')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '扫描概览' }).querySelector('.favorite-ledger-panel__scan-source-divider')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('增量扫描已跳过 3 条已保护视频')
  })

  it('renders the four canonical inventory metrics with their exact counting tooltips', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 999, scannedItemCount: 5 },
        inventoryMetrics: {
          authority: 'complete', relationshipCount: 7, plannedAidCount: 1, protectedAidCount: 2, unavailableAidCount: 1,
          sourceFolders: []
        },
        protectedAidCount: 88, continuationCount: 66, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByLabelText('本轮收藏关系')).toHaveTextContent('本轮收藏关系7')
    expect(screen.getByLabelText('本轮收藏关系')).toHaveAttribute('title', 'B站实际收藏关系总数；同一视频出现在多个收藏夹会重复计数，包含失效视频。')
    expect(screen.getByLabelText('本轮待整理')).toHaveTextContent('本轮待整理1')
    expect(screen.getByLabelText('本轮待整理')).toHaveAttribute('title', '已选来源中去重后，扣除失效视频和已保护视频的数量。')
    expect(screen.getByLabelText('已保护跳过')).toHaveTextContent('已保护跳过2')
    expect(screen.getByLabelText('已保护跳过')).toHaveAttribute('title', '有效视频中已在收藏库完成整理并受保护的去重数量，本轮不会重复整理。')
    expect(screen.getByLabelText('失效视频')).toHaveTextContent('失效视频1')
    expect(screen.getByLabelText('失效视频')).toHaveAttribute('title', '已确认失效或账号注销视频的去重数量，不参与整理和分类。')
    expect(screen.getByRole('status')).toHaveTextContent('增量扫描已跳过 2 条已保护视频')
    expect(screen.queryByText(/待续新增/)).not.toBeInTheDocument()
  })

  it('keeps all four metrics labeled as this round when the organization has only one batch', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'full',
        segmentSize: 2_000, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0, totalItemCount: 5_193, scannedItemCount: 40 },
        inventoryMetrics: {
          authority: 'incomplete', relationshipCount: 5_193, plannedAidCount: 0, protectedAidCount: 0, unavailableAidCount: 0,
          sourceFolders: []
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      viewScope="current"
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const metrics = screen.getByLabelText('本轮整理统计')
    expect(metrics).toHaveTextContent('本轮收藏关系5193')
    expect(metrics).toHaveTextContent('本轮待整理待确认')
    expect(metrics).toHaveTextContent('已保护跳过待确认')
    expect(metrics).toHaveTextContent('失效视频待确认')
    expect(within(metrics).queryByText('本批视频')).not.toBeInTheDocument()
  })

  it('keeps deduplicated reads separate from the collection-relationship total while scanning', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2_000, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0, totalItemCount: 4_949, scannedItemCount: 1_831 },
        inventoryMetrics: {
          authority: 'incomplete', relationshipCount: 4_949, plannedAidCount: 0, protectedAidCount: 0, unavailableAidCount: 0,
          sourceFolders: []
        },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      } as never}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('已读取 1831 个去重视频 · 本轮共 4949 条收藏关系')).toBeInTheDocument()
    expect(screen.queryByText('1831 / 4949 条')).not.toBeInTheDocument()
    expect(screen.getByLabelText('本轮收藏关系')).toHaveTextContent('本轮收藏关系4949')
  })

  it('separates source, pending, protected, and tag-read counts without calling empty cached items confirmed untagged', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 246, scannedItemCount: 25, taggedItemCount: 25, untaggedItemCount: 0 },
        protectedAidCount: 221, continuationCount: 0,
        sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 246, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }, planReadiness: { selectedAidCount: 25, classifiedAidCount: 0, unclassifiedAidCount: 25 },
        tagEnrichment: { status: 'complete', totalItemCount: 25, completedItemCount: 25, pendingItemCount: 0, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('本轮收藏关系246')
    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('本轮待整理25')
    expect(screen.getByLabelText('本轮整理统计')).toHaveTextContent('已保护跳过221')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('沿用历史标签0')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮获取标签25')
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮确认无标签0')
    expect(screen.getByText('先读取各收藏夹中的视频，确定本轮整理范围；只有待整理的视频会继续获取标签。')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '用户收藏夹' })).toHaveTextContent('全选·用户收藏夹（1）总数（246）本轮待整理⇄（246）默认收藏夹246246')
  })

  it('shows tag enrichment once and keeps its actions in one equal-width row', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 244, scannedItemCount: 244, taggedItemCount: 183, untaggedItemCount: 61 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        tagEnrichment: { status: 'running', totalItemCount: 244, completedItemCount: 184, pendingItemCount: 60, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByText('标签补取进行中：已处理 184 / 244 条。')).toBeInTheDocument()
    expect(screen.getByLabelText('标签补取结果')).toHaveTextContent('本轮获取标签183')
    expect(screen.getByText('标签是重要的分类依据，建议耐心等待获取完成。暂停会保留已取得标签；采用当前标签会用当前结果继续本轮整理，未读取项不自动加入。')).toBeInTheDocument()
    expect(screen.getByTestId('tag-enrichment-actions')).toHaveClass('favorite-ledger-panel__scan-enrichment-actions')
  })

  it('hides queued tag enrichment until the scan has completed', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: true,
        scan: { phase: 'inventory', failureCount: 0, totalItemCount: 500, scannedItemCount: 500, taggedItemCount: 1, untaggedItemCount: 499 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        tagEnrichment: { status: 'running', totalItemCount: 500, completedItemCount: 1, pendingItemCount: 499, failedItemCount: 0 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
      currentScopeLocked
    />)

    expect(screen.queryByText('标签补取进行中：已处理 1 / 500 条。')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('标签补取结果')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂停补取标签' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采用当前标签' })).not.toBeInTheDocument()
  })

  it('lets adopted current tags resume later and retries only failed tag reads', () => {
    const resume = vi.fn()
    const retryFailed = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 1, untaggedItemCount: 2 },
        continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] },
        tagEnrichment: { status: 'accepted', totalItemCount: 3, completedItemCount: 2, pendingItemCount: 1, failedItemCount: 1 }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={resume} onAcceptCurrentTags={vi.fn()} onRetryFailedTagEnrichment={retryFailed}
    />)

    expect(screen.getByRole('button', { name: '继续补取标签' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '采用当前标签' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新补取失败标签' })).toBeInTheDocument()
  })

  it('keeps classified source folders selectable and makes the header control select all only', () => {
    const selectSourceFolders = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 3, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: '收藏夹 A', itemCount: 2, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: '收藏夹 B', itemCount: 1, isBilimiWorkFolder: false, selected: false }
        ],
        segments: [], currentSegment: null,
        classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'system-high' } },
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={selectSourceFolders} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const sourceA = screen.getByRole('checkbox', { name: '选择来源 收藏夹 A' })
    expect(sourceA).toBeEnabled()
    fireEvent.click(sourceA)
    expect(selectSourceFolders).toHaveBeenLastCalledWith([])

    const selectAll = screen.getByRole('checkbox', { name: '全选来源' })
    expect(selectAll).not.toBeChecked()
    fireEvent.click(selectAll)
    expect(selectSourceFolders).toHaveBeenLastCalledWith(['source-a', 'source-b'])
  })

  it('deselects every user source when the checked header control is clicked', () => {
    const selectSourceFolders = vi.fn()
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 3, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: 'Source A', itemCount: 2, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: 'Source B', itemCount: 1, isBilimiWorkFolder: false, selected: true }
        ],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={selectSourceFolders} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('checkbox', { name: '全选来源' }))

    expect(selectSourceFolders).toHaveBeenCalledWith([])
  })

  it('keeps legacy source snapshots compatible with the three projected source metrics', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 5, scannedItemCount: 5, taggedItemCount: 2, untaggedItemCount: 0 },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: '收藏夹 A', itemCount: 3, invalidItemCount: 1, isBilimiWorkFolder: false, selected: true },
          { id: 'source-b', title: '收藏夹 B', itemCount: 2, invalidItemCount: 2, isBilimiWorkFolder: false, selected: false }
        ],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const rows = screen.getAllByRole('row').slice(-2)
    expect(screen.getByText('全选')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '总数（5）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮待整理（3）' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '本轮待整理（3）' })).toHaveTextContent('⇄')
    expect(rows[0]).toHaveTextContent('收藏夹 A33')
    expect(rows[1]).toHaveTextContent('收藏夹 B2—')

    fireEvent.click(screen.getByRole('button', { name: '本轮待整理（3）' }))

    expect(screen.getByRole('button', { name: '已保护（0）' })).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('收藏夹 A30')
    expect(rows[1]).toHaveTextContent('收藏夹 B20')

    fireEvent.click(screen.getByRole('button', { name: '已保护（0）' }))

    expect(screen.getByRole('button', { name: '失效视频（3）' })).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent('收藏夹 A31')
    expect(rows[1]).toHaveTextContent('收藏夹 B22')
  })

  it('uses compact ordinary and managed folder projections for the three source metrics', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete', failureCount: 0, totalItemCount: 999 },
        inventoryMetrics: {
          authority: 'complete', relationshipCount: 7, plannedAidCount: 1, protectedAidCount: 2, unavailableAidCount: 1,
          sourceFolders: [
            { id: 'source-a', title: '收藏夹 A', relationshipCount: 3, plannedAidCount: 1, protectedAidCount: 1, unavailableAidCount: 1, selected: true, isBilimiWorkFolder: false, confirmed: true },
            { id: 'source-b', title: '收藏夹 B', relationshipCount: 2, plannedAidCount: 0, protectedAidCount: 0, unavailableAidCount: 0, selected: false, isBilimiWorkFolder: false, confirmed: true },
            { id: 'managed', title: 'bilimi·知识学习', relationshipCount: 2, plannedAidCount: 0, protectedAidCount: 2, unavailableAidCount: 0, selected: false, isBilimiWorkFolder: true, confirmed: true }
          ]
        },
        continuationCount: 0,
        sourceFolders: [
          { id: 'source-a', title: '旧收藏夹 A', itemCount: 900, isBilimiWorkFolder: false, selected: true },
          { id: 'managed', title: '旧 bilimi', itemCount: 99, isBilimiWorkFolder: true, selected: false }
        ],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    const ordinaryTable = screen.getByRole('table', { name: '用户收藏夹' })
    const managedTable = screen.getByRole('table', { name: 'bilimi 工作夹' })
    expect(within(ordinaryTable).getByRole('columnheader', { name: '总数（5）' })).toBeInTheDocument()
    expect(within(managedTable).getByRole('columnheader', { name: 'bilimi 工作夹' })).toHaveClass('favorite-ledger-panel__source-heading')
    expect(within(managedTable).getByRole('columnheader', { name: '总数' })).toHaveClass('favorite-ledger-panel__source-metric-heading')
    expect(within(ordinaryTable).getByText('收藏夹 A').closest('[role="row"]')).toHaveTextContent('收藏夹 A31')
    expect(within(ordinaryTable).getByText('收藏夹 B').closest('[role="row"]')).toHaveTextContent('收藏夹 B2—')
    const managedRow = within(managedTable).getByText('bilimi·知识学习').closest('[role="row"]')
    expect(managedRow).toHaveClass('favorite-ledger-panel__source-row-content')
    expect(managedRow).toHaveTextContent('bilimi·知识学习20')

    fireEvent.click(screen.getByRole('button', { name: '本轮待整理（1）' }))
    expect(screen.getByRole('button', { name: '已保护（1）' })).toBeInTheDocument()
    expect(within(ordinaryTable).getByText('收藏夹 A').closest('[role="row"]')).toHaveTextContent('收藏夹 A31')
    expect(within(managedTable).getByText('bilimi·知识学习').closest('[role="row"]')).toHaveTextContent('bilimi·知识学习22')

    fireEvent.click(screen.getByRole('button', { name: '已保护（1）' }))
    expect(screen.getByRole('button', { name: '失效视频（1）' })).toBeInTheDocument()
    expect(within(ordinaryTable).getByText('收藏夹 A').closest('[role="row"]')).toHaveTextContent('收藏夹 A31')
    expect(within(managedTable).getByText('bilimi·知识学习').closest('[role="row"]')).toHaveTextContent('bilimi·知识学习20')
  })

  it('shows incomplete lifecycle projections as pending confirmation instead of zero', () => {
    render(<OldFavoriteScanOverviewStep
      snapshot={{
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', mode: 'incremental',
        segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0, totalItemCount: 332, scannedItemCount: 0 },
        inventoryMetrics: {
          authority: 'incomplete', relationshipCount: 332, plannedAidCount: 0, protectedAidCount: 0, unavailableAidCount: 0,
          sourceFolders: [
            { id: 'source', title: '待扫描收藏夹', relationshipCount: 332, plannedAidCount: null, protectedAidCount: null, unavailableAidCount: null, selected: true, isBilimiWorkFolder: false, confirmed: false }
          ]
        },
        continuationCount: 0,
        sourceFolders: [{ id: 'source', title: '待扫描收藏夹', itemCount: 332, isBilimiWorkFolder: false, selected: true }],
        segments: [], currentSegment: null, classifications: {},
        recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
      }}
      loading={false} scanStarting={false} scanStartFailure={null} onRetry={vi.fn()} onRetryDirect={vi.fn()}
      onRebuild={vi.fn()} onSelectSourceFolders={vi.fn()} onPauseTagEnrichment={vi.fn()}
      onResumeTagEnrichment={vi.fn()} onRetryFailedTagEnrichment={vi.fn()} onAcceptCurrentTags={vi.fn()}
    />)

    expect(screen.getByLabelText('本轮收藏关系')).toHaveTextContent('本轮收藏关系332')
    expect(screen.getByLabelText('本轮待整理')).toHaveTextContent('本轮待整理待确认')
    expect(screen.getByLabelText('已保护跳过')).toHaveTextContent('已保护跳过待确认')
    expect(screen.getByLabelText('失效视频')).toHaveTextContent('失效视频待确认')
    expect(screen.getByText('待扫描收藏夹').closest('[role="row"]')).toHaveTextContent('待扫描收藏夹332待确认')
    expect(screen.getByRole('button', { name: '本轮待整理（待确认）' })).toBeInTheDocument()
  })
})
