import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlledFavoriteLedgerPanel, createRecommendationProjection, resolveRecommendationOpenLedgerId } from './ControlledFavoriteLedgerPanel'
import { OldFavoriteWholeRunOverview } from './OldFavoriteOverviewControls'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

async function openPersistedWorkspaceGuide() {
  fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
  await waitFor(() => expect(
    screen.queryByRole('dialog', { name: '整理收藏' }) ??
    screen.queryByRole('region', { name: '整理收藏向导' })
  ).toBeTruthy())
  const resumeDialog = screen.queryByRole('dialog', { name: '整理收藏' })
  const resume = resumeDialog
    ? within(resumeDialog).queryByRole('button', { name: '恢复草稿' })
    : null
  if (resume) fireEvent.click(resume)
  await screen.findByRole('region', { name: '整理收藏向导' })
}

describe('ControlledFavoriteLedgerPanel', () => {
  it('disables the toolbar backup when no saved and enabled ledger is available', () => {
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'draft', displayName: 'bilimi·草稿', keywords: [], enabled: true, priority: 10, syncState: 'local-draft', isDefault: false }]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSyncLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '备册' })).toBeDisabled()
  })

  it('uses one backup flow for the toolbar and the收藏夹 backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    const sync = vi.fn().mockResolvedValue({ ok: true })
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]}
      missingLedgerIds={[]}
      onEnsureLedgers={ensure}
      onSyncLedgers={sync}
      onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1))
    expect(ensure).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
  })

  it('opens the same rebinding flow from the toolbar backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    const sync = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        unboundCandidates: [{
          ledgerId: 'music',
          candidates: [{ id: 'remote-music', title: 'bilimi·音乐', memberCount: 4 }]
        }]
      })
      .mockResolvedValueOnce({ ok: true })
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]}
      missingLedgerIds={[]}
      onEnsureLedgers={ensure}
      onSyncLedgers={sync}
      onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))
    const dialog = await screen.findByRole('dialog', { name: '确认绑定 bilimi 收藏夹' })
    expect(within(dialog).getByRole('button', { name: '确认绑定' })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认绑定' }))

    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    expect(sync).toHaveBeenLastCalledWith(
      [expect.objectContaining({ id: 'music' })],
      {
        deleteDisabled: false,
        rediscoverDeletedRemoteDrafts: true,
        rebindRemoteFolderIds: { music: 'remote-music' },
        rebindRemoteFolders: { music: [{ id: 'remote-music', title: 'bilimi·音乐', memberCount: 4 }] }
      }
    )
    expect(ensure).not.toHaveBeenCalled()
  })

  it('keeps the independent deletion mode open after its temporary selection reaches the parent', async () => {
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[
        { id: 'game', displayName: 'bilimi·游戏专区', keywords: [], enabled: true, priority: 10, isDefault: false, bilibiliFolderId: 'remote-game' }
      ]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: /展开删除模式/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: /取消删除模式/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /加入删除 bilimi·游戏专区/ })).toBeInTheDocument()
  })

  it('cancels the real saved recommendation instead of locally deleting its mapped ledger', async () => {
    const workspace = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2_000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
      classifications: {},
      recommendations: {
        candidates: [{ id: 'custom-author-honker233', displayName: 'bilimi·honker233', kind: 'author' as const, keywords: ['honker233'], count: 1, reason: '推荐 UP' }],
        adoptedCandidateIds: ['custom-author-honker233']
      },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(workspace),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({ ...workspace, recommendations: { ...workspace.recommendations, adoptedCandidateIds: [] } }),
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      deleteFavoriteLedgersLocal: vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['custom-author-honker233-9.2d'] })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} openLedgerId="custom-author-honker233" openLedgerRequestVersion={1}
      ledgers={[
        { id: 'custom-author-honker233-9.2d', displayName: 'bilimi·honker233', keywords: ['honker233'], ruleType: 'author', enabled: true, priority: 10, bindingState: 'unbacked', isDefault: false },
        { id: 'custom-author-honker233', displayName: 'bilimi·honker233', keywords: [], enabled: true, priority: 10_000, syncState: 'local-draft', isDefault: false }
      ]} />)

    await waitFor(() => expect(screen.getByRole('region', { name: '当前收藏夹' }))
      .toHaveAttribute('data-ledger-id', 'custom-author-honker233-9.2d'))
    expect(screen.queryByTestId('favorite-ledger-chip-custom-author-honker233')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(window.bilimiDesktop?.commandOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
    expect(window.bilimiDesktop?.deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'honker233' })).not.toBeInTheDocument())
  })

  it('does not project a candidate-only local draft as a saved recommendation', () => {
    const projection = createRecommendationProjection([
      { id: 'candidate-only', displayName: 'bilimi·候选草稿', keywords: [], enabled: true, priority: 10,
        syncState: 'local-draft', isDefault: false }
    ], [{ id: 'candidate-only', displayName: 'bilimi·候选草稿', kind: 'author', keywords: ['候选草稿'], count: 1, reason: '推荐 UP' }])

    expect(projection.candidateToLedgerId.has('candidate-only')).toBe(false)
    expect(projection.ledgerToCandidateId.has('candidate-only')).toBe(false)
  })

  it('does not fall back to a candidate id when opening a temporary draft', () => {
    expect(resolveRecommendationOpenLedgerId('candidate-only', [{
      id: 'candidate-only', displayName: 'bilimi·候选草稿', keywords: [], enabled: true, priority: 10,
      syncState: 'local-draft', isDefault: false
    }], [{ id: 'candidate-only', displayName: 'bilimi·候选草稿', kind: 'author', keywords: ['候选草稿'], count: 1, reason: '推荐 UP' }])).toBeUndefined()
  })

  it('keeps enabled archive targets and bilimi temporary storage visible at zero', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [{ id: 'segment-1', index: 0, itemCount: 2, status: 'previewing' as const }],
      currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      overview: {
        completedSegmentCount: 1, totalSegmentCount: 1, available: true, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 2, classifiedItemCount: 1, unmatchedItemCount: 1, waitingItemCount: 0,
        recommendationCounts: [], archiveTargets: [
          { ledgerId: 'inbox', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] },
          { ledgerId: 'knowledge', itemCount: 1, segmentCounts: [{ segmentId: 'segment-1', count: 1 }] }
        ]
      },
      history: { cursor: 0, length: 0 }
    }

    render(<OldFavoriteWholeRunOverview snapshot={snapshot} showArchiveTargets ledgerNames={new Map([
      ['inbox', 'bilimi·暂存'], ['knowledge', '知识学习'], ['empty', '空收藏夹']
    ])} />)

    const targets = screen.getByLabelText('本轮归档目标总览')
    expect(targets).toHaveTextContent('知识学习预计归档 1 条')
    expect(targets).toHaveTextContent('bilimi·暂存（未分类）预计归档 1 条')
    expect(targets).toHaveTextContent('空收藏夹预计归档 0 条')
  })

  it('closes the whole-run progress across completed, tagging, and waiting batches', () => {
    const snapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 2_552, scannedItemCount: 2_552 },
      tagEnrichment: {
        status: 'paused' as const,
        totalItemCount: 2_552,
        completedItemCount: 1_370,
        pendingItemCount: 1_182,
        failedItemCount: 0,
        scopes: {
          currentSegment: {
            totalItemCount: 500, completedItemCount: 370, pendingItemCount: 130,
            failedItemCount: 0, reusedTagItemCount: 0, fetchedTagItemCount: 370, confirmedUntaggedItemCount: 0
          },
          wholeRun: {
            totalItemCount: 2_552, completedItemCount: 1_370, pendingItemCount: 1_182,
            failedItemCount: 0, reusedTagItemCount: 0, fetchedTagItemCount: 1_370, confirmedUntaggedItemCount: 0
          }
        }
      },
      continuationCount: 0, sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 500, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 500, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-3', index: 2, itemCount: 500, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 370, pendingTagItemCount: 130 },
        { id: 'segment-4', index: 3, itemCount: 500, status: 'previewing' as const, readiness: 'waiting' as const, completedTagItemCount: 0, pendingTagItemCount: 500 },
        { id: 'segment-5', index: 4, itemCount: 500, status: 'previewing' as const, readiness: 'waiting' as const, completedTagItemCount: 0, pendingTagItemCount: 500 },
        { id: 'segment-6', index: 5, itemCount: 52, status: 'previewing' as const, readiness: 'waiting' as const, completedTagItemCount: 0, pendingTagItemCount: 52 }
      ],
      currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      overview: {
        completedSegmentCount: 2, totalSegmentCount: 6, available: true, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 1_000, classifiedItemCount: 892, unmatchedItemCount: 108,
        deepSeekPendingItemCount: 360, waitingTagItemCount: 130, waitingItemCount: 1_052,
        recommendationCounts: [], archiveTargets: []
      },
      history: { cursor: 0, length: 0 }
    }

    const rendered = render(<OldFavoriteWholeRunOverview snapshot={snapshot} />)

    expect(screen.getByText('已处理 1000 条 · 已分类 892 条 · 暂存 108 条')).toBeInTheDocument()
    expect(screen.getByText('其中 DeepSeek 待整理 360 条')).toBeInTheDocument()
    expect(screen.getByText('标签补取中 2552 条 · 已补取 1370 条 · 待补取 1182 条')).toBeInTheDocument()
    expect(screen.queryByText('标签补取中 500 条 · 已补取 370 条 · 待补取 130 条')).not.toBeInTheDocument()
    expect(screen.queryByText('等待扫描 1052 条')).not.toBeInTheDocument()

    rendered.rerender(<OldFavoriteWholeRunOverview snapshot={{
      ...snapshot,
      status: 'scanning',
      scan: { ...snapshot.scan, phase: 'inventory' }
    }} />)

    expect(screen.queryByText('标签补取中 2552 条 · 已补取 1370 条 · 待补取 1182 条')).not.toBeInTheDocument()
  })

  it('opens the old-favorite guide for an external navigation request without starting a scan', async () => {
    const command = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    const props = {
      currentAccountMid: '100', ledgers: [], missingLedgerIds: [],
      onEnsureLedgers: vi.fn(), onSaveLedgers: vi.fn()
    }
    const { rerender } = render(<ControlledFavoriteLedgerPanel {...props} openOrganizationRequestVersion={0} />)

    expect(screen.queryByLabelText('整理收藏向导')).not.toBeInTheDocument()
    rerender(<ControlledFavoriteLedgerPanel {...props} openOrganizationRequestVersion={1} />)

    expect(await screen.findByLabelText('整理收藏向导')).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
  })

  it('starts the requested Favorite Library selection and opens its existing archive preview', async () => {
    const selected = {
      version: 1 as const,
      accountMid: '100',
      workspaceId: 'selection-workspace',
      status: 'previewing' as const,
      mode: 'full' as const,
      scope: { kind: 'selection' as const, aids: [1, 3] },
      segmentSize: 2_000,
      hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 2, scannedItemCount: 2 },
      sourceFolders: [{ id: 'selection', title: '收藏库所选视频', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
      continuationCount: 0,
      protectedAidCount: 0,
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 2 }],
      currentSegment: { id: 'segment-1', aids: [1, 3], items: [] },
      classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const command = vi.fn().mockResolvedValue(selected)
    window.bilimiDesktop = {
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
      openOrganizationRequestVersion={1}
      openOrganizationSelectionAids={[3, 1, 3]}
    />)

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-selected-reorganization', aids: [1, 3]
    }))
    expect(await screen.findByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
  })

  it('does not load workspace segments while the library panel merely mounts', async () => {
    const open = vi.fn().mockResolvedValue(null)
    const prepareRecovery = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
    expect(prepareRecovery).not.toHaveBeenCalled()
  })

  it('prepares recovery before loading any workspace segment', async () => {
    const open = vi.fn().mockResolvedValue(null)
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.assistant-action-button')[1]!)

    await waitFor(() => expect(prepareRecovery).toHaveBeenCalledWith('100'))
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps the legacy ledger shell order and puts the library beside the original toolbar actions', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const panel = screen.getByRole('dialog', { name: '掌库' })
    const toolbar = panel.querySelector('.favorite-ledger-panel__topbar .favorite-ledger-panel__toolbar')
    expect(toolbar).not.toBeNull()
    expect(within(toolbar as HTMLElement).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['备册', '整理收藏', '收藏库'])
    expect(screen.getByRole('region', { name: '收藏夹' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '全部重新整理' })).not.toBeInTheDocument()
  })

  it('opens the Bilibili favorites page after a successful legacy backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    const openFavoritePage = vi.fn().mockResolvedValue({ ok: true })
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(openFavoritePage).toHaveBeenCalledTimes(1))
  })

  it('paints the busy backup state before starting the remote backup operation', async () => {
    const paintCallbacks: FrameRequestCallback[] = []
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      paintCallbacks.push(callback)
      return paintCallbacks.length
    })
    try {
      const ensure = vi.fn().mockResolvedValue({ ok: true })
      render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]} missingLedgerIds={[]}
        onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

      const backup = screen.getByRole('button', { name: '备册' })
      fireEvent.click(backup)

      expect(backup).toHaveAttribute('aria-busy', 'true')
      expect(backup).toHaveTextContent('备册中')
      expect(ensure).not.toHaveBeenCalled()

      act(() => { paintCallbacks.shift()?.(0) })
      expect(ensure).not.toHaveBeenCalled()

      await act(async () => {
        paintCallbacks.shift()?.(16)
        await Promise.resolve()
      })
      expect(ensure).toHaveBeenCalledTimes(1)
    } finally {
      requestFrame.mockRestore()
    }
  })

  it('starts backup after a short fallback when a hidden window stops producing frames', async () => {
    vi.useFakeTimers()
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    try {
      const ensure = vi.fn().mockResolvedValue({ ok: true })
      render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]} missingLedgerIds={[]}
        onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

      fireEvent.click(screen.getByRole('button', { name: '备册' }))
      expect(ensure).not.toHaveBeenCalled()

      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      expect(ensure).toHaveBeenCalledTimes(1)
    } finally {
      requestFrame.mockRestore()
      vi.useRealTimers()
    }
  })

  it('coalesces repeated backup clicks while the first backup is still running', async () => {
    let resolveEnsure: ((result: { ok: boolean }) => void) | undefined
    const ensure = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveEnsure = resolve
    }))
    const openFavoritePage = vi.fn().mockResolvedValue({ ok: true })
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    const backup = screen.getByRole('button', { name: '备册' })
    fireEvent.click(backup)
    fireEvent.click(backup)

    expect(backup).toBeDisabled()
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))

    resolveEnsure?.({ ok: true })
    await waitFor(() => expect(openFavoritePage).toHaveBeenCalledTimes(1))
  })

  it('does not open the Bilibili favorites page after a failed backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: false })
    const openFavoritePage = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    expect(openFavoritePage).not.toHaveBeenCalled()
  })

  it('disables backup when the default favorite system is turned off', () => {
    const ensure = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" defaultFavoriteSystemEnabled={false}
      ledgers={[]} missingLedgerIds={[]} onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    const backup = screen.getByRole('button', { name: '备册' })
    expect(backup).toBeDisabled()
    fireEvent.click(backup)
    expect(ensure).not.toHaveBeenCalled()
  })

  it('keeps the special inbox available for backup when the default system is turned off', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" defaultFavoriteSystemEnabled={false}
      ledgers={[{ id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 10, isDefault: true }]}
      missingLedgerIds={[]} onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    const backup = screen.getByRole('button', { name: '备册' })
    expect(backup).toBeEnabled()
    fireEvent.click(backup)
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
  })

  it('keeps default targets locked while an organization scan is active', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning',
        mode: 'incremental', segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0 }, sourceFolders: [], continuationCount: 0,
        segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('button', { name: '移出同步 bilimi·知识' })).toBeDisabled()
  })

  it('keeps the default ledger closed behind separate Chinese organize and library entries', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'knowledge', displayName: 'bilimi:知识学习', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    expect(await screen.findByRole('button', { name: '整理收藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收藏库' })).toBeInTheDocument()
    expect(screen.queryByText('bilimi:知识学习')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
  })

  it('keeps the ledger overview, organize entry, and library entry in a stable order', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn(),
      openFavoriteLibrary: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('region', { name: '收藏夹' })).toBeInTheDocument()
    expect(screen.queryByText(/管理本地收藏夹规则，并在整理完成后保存。/)).not.toBeInTheDocument()
  })

  it('keeps the legacy 收藏夹 checklist header, help disclosure, chips, and actions', () => {
    const ledgers = [
      { id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true },
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], ruleType: 'keyword' as const, enabled: false, priority: 1, isDefault: false }
    ]
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={ledgers} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const checklist = screen.getByRole('region', { name: '收藏夹' }).querySelector('.favorite-ledger-panel__checklist')
    expect(checklist).not.toBeNull()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '固定显示收藏夹说明' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '重置' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '全选' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '备册收藏夹' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '知识学习' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '音乐' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()

    fireEvent.click(within(checklist as HTMLElement).getByRole('button', { name: '固定显示收藏夹说明' }))
    expect(within(checklist as HTMLElement).getByRole('button', { name: '收起收藏夹说明' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('favorite-ledger-help-tooltip')).toHaveTextContent('自定义收藏夹：点击收藏夹名称可以编辑；按住并拖动可调整顺序。')
    expect(document.getElementById('favorite-ledger-help-tooltip')).toHaveTextContent('备册到 B 站：备册会将已勾选的 bilimi 收藏夹创建或更新到 B 站，为将批阅和整理结果同步到 B 站做好准备。')
  })

  it('keeps the legacy organize-guide help arrow in the title row and expands its explanation', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        version: 1, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning',
        mode: 'incremental', segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'inventory', failureCount: 0 }, sourceFolders: [], continuationCount: 0,
        segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0 }
      })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    const guide = await screen.findByRole('region', { name: '整理收藏向导' })
    const help = within(guide).getByRole('button', { name: '固定显示整理收藏说明' })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help).toHaveClass('favorite-ledger-panel__guide-title-toggle')
    expect(help.querySelector('.favorite-ledger-panel__chevron')).not.toBeNull()
    fireEvent.click(help)
    expect(within(guide).getByRole('button', { name: '收起整理收藏说明' })).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('favorite-organization-help-tooltip')).toHaveTextContent('① 扫描概览：扫描所有视频收藏的基本信息。扫描完成后会补取标签，标签是分类的重要依据')
    expect(document.getElementById('favorite-organization-help-tooltip')).toHaveTextContent('④ 确认执行：前面三步都是打草稿，最后一步来执行')
  })

  it('keeps the legacy folder help arrow in the checklist title row', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const help = screen.getByRole('button', { name: /^(固定显示|收起)收藏夹说明$/ })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help.querySelector('.favorite-ledger-panel__chevron')).not.toBeNull()
    expect(help).toHaveTextContent('收藏夹')
  })

  it('does not use the explanation arrow to control the favorite card list', async () => {
    window.localStorage.clear()
    const ledgers = Array.from({ length: 16 }, (_, index) => ({ id: `knowledge-${index}`, displayName: `bilimi·知识学习${index + 1}`, keywords: [], ruleType: 'keyword' as const, enabled: true, priority: index, isDefault: index === 0 }))
    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={ledgers} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '固定显示收藏夹说明' }))
    expect(screen.getByRole('button', { name: '收起收藏夹说明' })).toHaveAttribute('aria-expanded', 'true')
    first.unmount()

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={ledgers} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()

    window.localStorage.clear()
  })

  it('keeps a recovered draft hidden until the user opens organize favorites and selects recovery', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10,
      bindingState: 'bound', bilibiliFolderId: '9001', isDefault: false
    }]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByTestId('favorite-ledger-chip-music')).toHaveTextContent('已备册')
    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))

    await screen.findByRole('button', { name: '恢复草稿' })
    const resumeDialog = screen.getByRole('dialog', { name: '整理收藏' })
    expect(within(resumeDialog).getByRole('button', { name: '恢复草稿' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '重新扫描' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '放弃本轮整理' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
    fireEvent.click(within(resumeDialog).getByRole('button', { name: '恢复草稿' }))
    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(command).toHaveBeenCalledWith('100', expect.objectContaining({ choice: 'merge-latest' }))
  })

  it('closes the guide when the user dismisses a recovery decision', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    await screen.findByRole('button', { name: '恢复草稿' })
    fireEvent.click(await screen.findByRole('button', { name: '关闭弹窗' }))

    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
  })

  it('returns to the recovery choices when the user cancels a recovery rescan', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    await screen.findByRole('button', { name: '恢复草稿' })
    fireEvent.click(await screen.findByRole('button', { name: '重新扫描' }))
    const dialog = await screen.findByRole('alertdialog', { name: '确认重新扫描？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭弹窗' }))

    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '恢复草稿' })).toBeInTheDocument()
  })

  it('closes the guide after ending the current preview round without syncing', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '暂不同步，结束本轮整理' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭整理' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument())
  })

  it('opens paused remote execution in its dedicated confirmation flow', async () => {
    const executing = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'executing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }, executionProgress: { completedOperationCount: 1, totalOperationCount: 3 }
    }
    const command = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(executing),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'executing', currentStep: 'sync-paused',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['view']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    await screen.findByRole('region', { name: '整理收藏向导' })
    expect(screen.queryByRole('button', { name: '恢复草稿' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '放弃本轮整理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(command).not.toHaveBeenCalled()
  })

  it('requires a changed non-default ledger to be saved and reselected before backup', async () => {
    const save = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('combobox', { name: '收藏夹种类' }), { target: { value: 'author' } })
    expect(screen.getByLabelText('UP 名字')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeDisabled()
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'music', ruleType: 'author', enabled: false })
    ], { deleteDisabled: false }))
    fireEvent.click(screen.getByRole('button', { name: '加入同步 bilimi·音乐' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '移出同步 bilimi·音乐' })).toBeEnabled())
    expect(screen.getByRole('button', { name: '备册收藏夹' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.any(Array), { deleteDisabled: false, rediscoverDeletedRemoteDrafts: true }))

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByRole('dialog', { name: '重置收藏夹规则？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    expect(screen.getAllByTestId('favorite-ledger-chip-music')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '备册收藏夹' }))
    expect(save).toHaveBeenLastCalledWith(expect.any(Array), { deleteDisabled: false, rediscoverDeletedRemoteDrafts: true })
  })

  it('keeps the local ledger editor closed until the legacy new-ledger entry is chosen', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi:音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByText(/管理本地收藏夹规则/)).not.toBeInTheDocument()
    expect(screen.queryByText(/当前有.*个收藏夹规则/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()
  })

  it('marks a changed legacy ledger editor as unsaved before it is synchronized', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    expect(screen.queryByText(/未保存/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '旋律 节奏' } })
    expect(screen.getAllByText(/未保存/).length).toBeGreaterThan(0)
  })

  it('opens the full legacy editor only from new ledger, validates names, and saves a normal local draft without reclassifying', () => {
    const save = vi.fn()
    const command = vi.fn()
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi:音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '收藏夹种类' })).toHaveTextContent('关键词收藏夹')
    expect(screen.getByLabelText('册名')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '关键词' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '收藏夹种类' }), { target: { value: 'deepseek' } })
    expect(screen.getByRole('textbox', { name: 'DeepSeek约束' })).toBeInTheDocument()
    expect(screen.getByText(/此类型不参与本地自动分类/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '收藏夹种类' }), { target: { value: 'keyword' } })

    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '音乐' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '一二三四五六七八九十一二三四五六七八九十一' } })
    expect(screen.getByRole('alert')).toHaveTextContent('最多20个字')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '舞蹈' } })
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '舞蹈 编舞' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'DeepSeek约束' }), { target: { value: '仅保留舞台演出与练习视频' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(save).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        displayName: 'bilimi·舞蹈',
        keywords: ['舞蹈', '编舞', '【DeepSeek约束】', '仅保留舞台演出与练习视频']
      })
    ]), { deleteDisabled: false })
    expect(command).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '舞蹈' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
  })

  it('saves a normal ledger rule immediately while its active-workspace analysis continues in the background', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'completed' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const analyzed = deferred<typeof preview>()
    const command = vi.fn((_: string, request: { type: string }) => request.type === 'save-draft-ledger-rule'
      ? analyzed.promise
      : Promise.resolve(preview))
    const save = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'custom-music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    await openPersistedWorkspaceGuide()
    await waitFor(() => expect(window.bilimiDesktop?.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '旋律 节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'save-draft-ledger-rule', ledgerId: 'custom-music', title: '音乐', keywords: ['旋律', '节奏'], ruleType: 'keyword'
    })))
    expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'custom-music', keywords: ['旋律', '节奏'] })
    ], { deleteDisabled: false })
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    await act(async () => analyzed.resolve(preview))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1))
  })

  it('saves a normal ledger rule locally during scanning without altering the active scan', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn()
    const save = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'custom-music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await waitFor(() => expect(window.bilimiDesktop?.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '旋律 节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'custom-music', keywords: ['旋律', '节奏'] })
    ], { deleteDisabled: false }))
    expect(command).not.toHaveBeenCalled()
  })

  it('updates a previewing recommendation through its round selection when its top card is disabled', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'completed' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [{ id: 'custom-music', title: '音乐', keywords: ['旋律'], ruleType: 'keyword' as const }], adoptedCandidateIds: ['custom-music'] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'custom-music', displayName: 'bilimi·音乐', keywords: ['旋律'], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={vi.fn()} />)

    await screen.findByRole('button', { name: '移出同步 bilimi·音乐' })
    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·音乐' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
  })

  it('keeps DeepSeek-only ledger rules on the account configuration path during an active workspace', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'completed' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn()
    const save = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'deepseek-music', displayName: 'bilimi·精选音乐', keywords: ['保留现场'], ruleType: 'deepseek', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await waitFor(() => expect(window.bilimiDesktop?.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '精选音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'DeepSeek约束' }), { target: { value: '只保留现场演出' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'deepseek-music', keywords: ['只保留现场演出'], ruleType: 'deepseek' })
    ], { deleteDisabled: false }))
    expect(command).not.toHaveBeenCalledWith('100', expect.objectContaining({ type: 'save-draft-ledger-rule' }))
  })

  it('cancels a new local ledger editor without leaving a chip behind', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByLabelText('册名'), { target: { value: '舞蹈' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '舞蹈' })).not.toBeInTheDocument()
  })

  it('deletes a right-side custom rule without touching its favorite-library work folder', async () => {
    const save = vi.fn()
    const deleteFavoriteLedgersLocal = vi.fn().mockResolvedValue({ status: 'succeeded', ledgerIds: ['music'] })
    window.bilimiDesktop = {
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      deleteFavoriteLedgersLocal
    } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', ['music']))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '音乐' })).not.toBeInTheDocument()
  })

  it('places the organize and library entries as peers in the shared toolbar', async () => {
    const openFavoriteLibrary = vi.fn().mockResolvedValue(undefined)
    const command = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command,
      openFavoriteLibrary
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    const organizeEntry = await screen.findByRole('button', { name: '整理收藏' })
    const libraryEntry = screen.getByRole('button', { name: '收藏库' })
    expect(organizeEntry.closest('.favorite-ledger-panel__toolbar')).toBeTruthy()
    expect(libraryEntry.closest('.favorite-ledger-panel__toolbar')).toBe(organizeEntry.closest('.favorite-ledger-panel__toolbar'))

    fireEvent.click(screen.getByRole('button', { name: '收藏库' }))
    expect(openFavoriteLibrary).toHaveBeenCalledTimes(1)
    expect(command).not.toHaveBeenCalled()
  })

  it('announces the local favorite library only after its open request succeeds', async () => {
    const openFavoriteLibrary = vi.fn().mockResolvedValue(undefined)
    const onFavoriteLibraryOpened = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn(),
      openFavoriteLibrary
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
      onFavoriteLibraryOpened={onFavoriteLibraryOpened}
    />)

    fireEvent.click(screen.getByRole('button', { name: '收藏库' }))

    await waitFor(() => expect(openFavoriteLibrary).toHaveBeenCalledTimes(1))
    expect(onFavoriteLibraryOpened).toHaveBeenCalledTimes(1)
  })

  it('does not announce the local favorite library when its open request fails', async () => {
    const onFavoriteLibraryOpened = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn(),
      openFavoriteLibrary: vi.fn().mockRejectedValue(new Error('open failed'))
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
      onFavoriteLibraryOpened={onFavoriteLibraryOpened}
    />)

    fireEvent.click(screen.getByRole('button', { name: '收藏库' }))

    await waitFor(() => expect(window.bilimiDesktop?.openFavoriteLibrary).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(onFavoriteLibraryOpened).not.toHaveBeenCalled()
  })

  it('describes the library entry as waking bilimi and opening the library', () => {
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByText('唤醒 bilimi 并打开收藏库')).toBeInTheDocument()
  })

  it('uses a distinct XiaoMi portrait for the library toolbar entry', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn(),
      openFavoriteLibrary: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    const backupIcon = screen.getByRole('button', { name: '备册' }).querySelector('img')
    const libraryEntry = screen.getByRole('button', { name: '收藏库' })
    const libraryIcon = libraryEntry.querySelector('img')
    expect(backupIcon).toBeInTheDocument()
    expect(libraryIcon).toBeInTheDocument()
    expect(libraryIcon?.getAttribute('src')).not.toBe(backupIcon?.getAttribute('src'))
    expect(libraryIcon).toHaveAttribute('alt', '小咪收藏库')
  })

  it('opens the organize guide without changing the independent library entry', async () => {
    const command = vi.fn()
    const openFavoriteLibrary = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command,
      openFavoriteLibrary
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收藏库' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '收藏库' }))

    expect(openFavoriteLibrary).toHaveBeenCalledTimes(1)
    expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' })
  })

  it('opens all four guide steps immediately and locks later steps while scanning', async () => {
    const scanningSnapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    let resolveScan: ((value: typeof scanningSnapshot) => void) | undefined
    const command = vi.fn(() => new Promise<typeof scanningSnapshot>((resolve) => { resolveScan = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('button', { name: '扫描概览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    expect(screen.getByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()

    await act(async () => { resolveScan?.(scanningSnapshot) })
  })

  it('exposes the scanning guide state through named navigation, current step, progress, and disabled controls', async () => {
    const scanningSnapshot = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanningSnapshot),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    await screen.findByRole('region', { name: '整理收藏向导' })
    expect(screen.getByRole('navigation', { name: '整理收藏步骤' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('progressbar', { name: '收藏扫描进度' })).toHaveValue(0)
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
  })

  it('keeps a restored scanning workspace paused until the user explicitly continues it', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0, paused: true }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', currentStep: 'scanning',
        plannedCount: 1, classifiedCount: 0, unclassifiedCount: 1,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: [], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    await waitFor(() => expect(command).toHaveBeenCalledOnce())
    expect(command).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'select-recovery-decision',
      choice: 'merge-latest'
    }))
    expect(screen.getByRole('button', { name: '继续扫描' })).toBeInTheDocument()
  })

  it('rebuilds a corrupt workspace before starting the recovery rescan', async () => {
    const rebuildRequired = {
      recovery: 'rebuild-required' as const, preserveCompletedLocalResults: true,
      accountMid: '100', workspaceId: 'workspace-100'
    }
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-101', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(rebuildRequired),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()

    fireEvent.click(await screen.findByRole('button', { name: '重建工作镜像并重新扫描' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'rebuild-corrupt-workspace' }))
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('does not render a recovery acknowledgement as a scan snapshot before rescanning', async () => {
    const reportSnapshot = vi.fn()
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-101', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2_000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    let resolveScan: ((value: typeof scanning) => void) | undefined
    const command = vi.fn()
      .mockResolvedValueOnce({
        accountMid: '100', workspaceId: 'workspace-100', choice: 'rescan',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: false, requiresExplicitScan: true
      })
      .mockImplementationOnce(() => new Promise<typeof scanning>((resolve) => { resolveScan = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'draft', currentStep: 'draft',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onOrganizationSnapshotChange={reportSnapshot} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '重新扫描' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认重新扫描' }))

    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(command).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ type: 'select-recovery-decision', choice: 'rescan' }))
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'start-scan', mode: 'incremental' })
    await waitFor(() => expect(reportSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({ choice: 'rescan' })))
    await act(async () => { resolveScan?.(scanning) })
  })

  it('shows an explicit recovery choice before loading an unfinished persisted workspace', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByText('本轮计划 26，已分类 3；其余 23 条包含未匹配和等待扫描，恢复后按批次继续。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃本轮整理' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复草稿' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-recovery-decision', workspaceId: 'workspace-100', choice: 'merge-latest', expectedBaselineRevision: 1, expectedRepositoryRevision: 2
    }))
  })

  it('prepares every recoverable task before showing the fixed three recovery actions', async () => {
    const prepared = deferred<{
      accountMid: string
      workspaceId: string
      status: 'previewing'
      currentStep: 'previewing'
      plannedCount: number
      classifiedCount: number
      unclassifiedCount: number
      baselineChangeEvidence: {
        scope: 'account'
        workspaceBaselineRevision: number
        repositoryRevision: number
        changed: boolean
        direction: 'advanced'
        manualClassificationsRemainAuthoritative: true
        changedDimensions: ['aid-revisions']
      }
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    }>()
    const prepareRecovery = vi.fn().mockImplementation(() => prepared.promise)
    window.bilimiDesktop = {
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('status')).toHaveTextContent('正在暂停并保存进度…')
    expect(prepareRecovery).toHaveBeenCalledWith('100')
    prepared.resolve({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
      baselineChangeEvidence: {
        scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true,
        direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions']
      },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })

    await screen.findByRole('button', { name: '恢复草稿' })
    const dialog = screen.getByRole('dialog', { name: '整理收藏' })
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent))
      .toEqual(expect.arrayContaining(['恢复草稿', '重新扫描', '放弃本轮整理']))
    expect(within(dialog).queryByRole('button', { name: '按原草稿继续' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '合并最新变化' })).not.toBeInTheDocument()
  })

  it('uses the current-facts recovery decision for the single visible recovery action', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'select-recovery-decision', choice: 'merge-latest'
    })))
  })

  it('requires a second confirmation before rescanning a recoverable draft', async () => {
    const command = vi.fn()
    window.bilimiDesktop = {
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '重新扫描' }))

    expect(await screen.findByRole('alertdialog', { name: '确认重新扫描？' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
  })

  it('loads the result-unknown draft before opening its reconciliation step', async () => {
    const reconciling = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn().mockResolvedValue(reconciling)
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling', currentStep: 'result-unknown',
      plannedCount: 2298, classifiedCount: 2298, unclassifiedCount: 0,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 3042, repositoryRevision: 3042, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
      recoveryChoices: ['view', 'reconcile-result-unknown']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看并检查同步结果' }))

    await waitFor(() => expect(open).toHaveBeenCalledWith('100'))
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '重新连接并检查同步结果' })).toBeInTheDocument()
    expect(screen.queryByText('尚未开始扫描，请点击“整理收藏”后扫描。')).not.toBeInTheDocument()
  })

  it('reloads the authoritative result-unknown draft instead of reusing a stale visible snapshot', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const reconciling = { ...preview, status: 'reconciling' as const }
    const open = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce(reconciling)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: open } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling', currentStep: 'result-unknown',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['view', 'reconcile-result-unknown']
      }),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看并检查同步结果' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '重新连接并检查同步结果' })).toBeInTheDocument()
  })

  it('keeps the recovery dialog open until the restored workspace loads without clearing the visible draft', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const loaded = deferred<typeof preview>()
    const open = vi.fn().mockImplementation(() => loaded.promise)
    const recoverySummary = {
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account' as const, workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced' as const, manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon'] as const
    }
    const prepareRecovery = vi.fn().mockResolvedValue(recoverySummary)
    const command = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await screen.findByText('检测到未完成的整理草稿')
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(screen.getByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在恢复整理草稿…')
    expect(screen.getByRole('button', { name: '恢复草稿' })).toBeDisabled()
    expect(screen.getByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByText('尚未开始扫描，请点击“整理收藏”后扫描。')).toBeInTheDocument()

    loaded.resolve(preview)
    await waitFor(() => expect(screen.queryByText('检测到未完成的整理草稿')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
  })

  it('keeps the visible draft and recovery dialog when reloading the chosen draft fails', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn().mockRejectedValue(new Error('reload failed'))
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
      })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(screen.getByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByText('尚未开始扫描，请点击“整理收藏”后扫描。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复草稿' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('恢复草稿失败，草稿不会丢失。请重试。')
  })

  it('does not restore deprecated recovery alternatives after a draft reload fails', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn().mockRejectedValue(new Error('reload failed'))
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
      })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('alert')).toHaveTextContent('恢复草稿失败，草稿不会丢失。请重试。')
    expect(screen.queryByRole('button', { name: '按原草稿继续' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '合并最新变化' })).not.toBeInTheDocument()
  })

  it('restores the persisted recommendation selection instead of re-adopting a globally enabled ledger', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [{ id: 'segment-1', index: 0, itemCount: 2, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1, 2], items: [] }, classifications: {},
      recommendations: {
        candidates: [{ id: 'custom-author-up', displayName: 'bilimi·UP', kind: 'author' as const, count: 2, reason: 'saved' }],
        adoptedCandidateIds: []
      },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={[]}
      ledgers={[{ id: 'custom-author-up', displayName: 'bilimi·UP', keywords: ['UP'], ruleType: 'author', enabled: true, priority: 10_000, isDefault: false }]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(await screen.findByRole('checkbox', { name: 'UP' })).not.toBeChecked()
    expect(command).not.toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: ['custom-author-up']
    })
  })

  it('does not show a recovery summary after the active account changes', async () => {
    const summary = deferred<{
      accountMid: string
      workspaceId: string
      status: 'previewing'
      currentStep: 'previewing'
      plannedCount: number
      classifiedCount: number
      unclassifiedCount: number
      baselineChangeEvidence: {
        scope: 'account'
        workspaceBaselineRevision: number
        repositoryRevision: number
        changed: false
        direction: 'unchanged'
        manualClassificationsRemainAuthoritative: true
        changedDimensions: []
      }
      recoveryChoices: readonly ['recover-draft']
    }>()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockReturnValue(summary.promise)
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    rerender(<ControlledFavoriteLedgerPanel currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await act(async () => summary.resolve({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
      recoveryChoices: ['recover-draft']
    }))

    await waitFor(() => expect(screen.queryByText('检测到未完成的整理草稿')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '按原草稿继续' })).not.toBeInTheDocument()
  })

  it('does not apply a completed recovery decision after the active account changes', async () => {
    const decision = deferred<{
      accountMid: string
      workspaceId: string
      choice: 'merge-latest'
      manualClassificationsRemainAuthoritative: true
      requiresFullWorkspaceLoad: true
      requiresExplicitScan: false
    }>()
    const command = vi.fn().mockReturnValue(decision.promise)
    const open = vi.fn().mockResolvedValue({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复草稿' }))

    rerender(<ControlledFavoriteLedgerPanel currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await act(async () => decision.resolve({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    }))

    await waitFor(() => expect(screen.queryByRole('navigation', { name: '整理收藏步骤' })).not.toBeInTheDocument())
    expect(open).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('abandons and dismisses a recoverable draft from the recovery choices', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        plannedCount: 1, classifiedCount: 0, unclassifiedCount: 1,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: [], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '放弃本轮整理' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'abandon-current-workspace' }))
    expect(screen.queryByRole('dialog', { name: '整理收藏' })).not.toBeInTheDocument()
  })

  it('starts the durable workspace scan without calling a legacy scan callback', async () => {
    const command = vi.fn().mockResolvedValue({
      version: 1 as const,
      accountMid: '100',
      workspaceId: 'workspace-100',
      status: 'scanning' as const,
      mode: 'incremental' as const,
      segmentSize: 2000,
      hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 },
      sourceFolders: [{ id: 'bilimi-empty', title: 'Bilimi Inbox', itemCount: 0, isBilimiWorkFolder: true, selected: false }],
      continuationCount: 0,
      segments: [],
      currentSegment: null,
      classifications: {},
      history: { cursor: 0, length: 0 }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    const organize = screen.getByRole('button', { name: '整理收藏' })
    await waitFor(() => expect(organize).toBeEnabled())
    fireEvent.click(organize)

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'incremental'
    }))
    expect(await screen.findByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()
    const userTable = screen.getByRole('table', { name: 'B站收藏夹' })
    const remoteRow = within(userTable).getByText('Bilimi Inbox').closest('[role="row"]')
    expect(remoteRow).toHaveTextContent('Bilimi Inbox')
    expect(remoteRow).not.toHaveTextContent('已备册')
    expect(within(userTable).getByRole('checkbox', { name: '选择来源 Bilimi Inbox' })).toBeEnabled()
  })

  it('shows every observed remote source as selectable during an incomplete scan', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [
        { id: 'source', title: 'My source', itemCount: 2, isBilimiWorkFolder: false, selected: true },
        { id: 'bilimi', title: 'Bilimi Inbox', itemCount: 0, isBilimiWorkFolder: true, selected: false }
      ],
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择来源 My source' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-source-folders', folderIds: []
    }))
    const userTable = screen.getByRole('table', { name: 'B站收藏夹' })
    const remoteRow = within(userTable).getByText('Bilimi Inbox').closest('[role="row"]')
    expect(remoteRow).toHaveTextContent('Bilimi Inbox')
    expect(remoteRow).not.toHaveTextContent('已备册')
    expect(within(userTable).getByRole('checkbox', { name: '选择来源 Bilimi Inbox' })).toBeEnabled()
  })

  it('keeps incomplete Bilibili fact tables selectable regardless of a local work-folder marker', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [
        { id: 'source', title: 'My source', itemCount: 2, isBilimiWorkFolder: false, selected: true },
        { id: 'bilimi', title: 'Bilimi Inbox', itemCount: 7, isBilimiWorkFolder: true, selected: false }
      ],
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()

    const userTable = await screen.findByRole('table', { name: 'B站收藏夹' })
    expect(within(userTable).getByRole('checkbox', { name: '选择来源 My source' })).toBeChecked()
    const remoteRow = within(userTable).getByText('Bilimi Inbox').closest('[role="row"]')
    expect(remoteRow).toHaveTextContent('Bilimi Inbox7')
    expect(remoteRow).not.toHaveTextContent('已备册')
    expect(within(userTable).getByRole('checkbox', { name: '选择来源 Bilimi Inbox' })).toBeEnabled()
  })

  it('rebuilds a corrupt workspace and restores the persisted snapshot after remount', async () => {
    const recovery = {
      recovery: 'rebuild-required' as const, preserveCompletedLocalResults: true as const,
      accountMid: '100', workspaceId: 'workspace-100'
    }
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn().mockResolvedValueOnce(recovery).mockResolvedValueOnce(scanning)
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '重建工作镜像并重新扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'rebuild-corrupt-workspace' }))
    first.unmount()

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('restores a persisted preview on the scan overview without starting another scan', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'My source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1 }],
      currentSegment: {
        id: 'segment-1', index: 0, status: 'previewing' as const,
        items: [{ aid: 1, title: 'Alpha', author: 'UP', sourceFolderIds: ['source'] }]
      },
      classifications: { '1': { targetLedgerIds: [] } }, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn().mockResolvedValue(preview)
    const prepareRecovery = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
      recoveryChoices: ['recover-draft', 'rescan', 'abandon']
    })
    const command = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    expect(command).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'select-recovery-decision', choice: 'merge-latest'
    }))
    expect(command).not.toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' })

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    expect(command).toHaveBeenCalledTimes(2)
    expect(command).not.toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' })
    expect(open).toHaveBeenCalledTimes(2)

  })

  it.each(['running', 'paused'] as const)(
    'restores persisted %s tag enrichment on the scan overview',
    async (status) => {
      const preview = {
        version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
        mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 1, untaggedItemCount: 2 },
        tagEnrichment: { status, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1 },
        sourceFolders: [], continuationCount: 0,
        segments: [{ id: 'segment-1', index: 0, itemCount: 3, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1, 2, 3], items: [{ aid: 1, tags: ['已有标签'], sourceFolderIds: [] }, { aid: 2, sourceFolderIds: [] }, { aid: 3, sourceFolderIds: [] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
      }
      const prepareRecovery = vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      })
      window.bilimiDesktop = {
        openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
        prepareOldFavoriteWorkspaceRecoveryV1: prepareRecovery,
        commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
          accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
          manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
        })
      } as unknown as typeof window.bilimiDesktop

      render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

      await openPersistedWorkspaceGuide()
      expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    }
  )

  it('restores a persisted frozen snapshot at confirmation on remount', async () => {
    const frozen = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'frozen' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(frozen),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '继续同步到 B 站' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(command).not.toHaveBeenCalled()
  })

  it('keeps the default-expanded ledger list when the active account changes', () => {
    const ledgers = Array.from({ length: 16 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      displayName: `bilimi:收藏夹${index + 1}`,
      keywords: [],
      ruleType: 'keyword' as const,
      enabled: true,
      priority: (index + 1) * 10,
      isDefault: false
    }))
    const props = {
      ledgers,
      missingLedgerIds: [],
      onEnsureLedgers: vi.fn(),
      onSaveLedgers: vi.fn()
    }
    const { rerender } = render(<ControlledFavoriteLedgerPanel {...props} currentAccountMid="100" />)
    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '折叠' }))

    rerender(<ControlledFavoriteLedgerPanel {...props} currentAccountMid="200" />)

    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收藏夹16' })).toBeInTheDocument()
  })

  it('resets live ledger enablement when the active account changes', async () => {
    const ledger = {
      id: 'custom-a', displayName: 'bilimi·A', keywords: [], ruleType: 'keyword' as const,
      enabled: true, priority: 10, isDefault: false
    }
    const props = {
      ledgers: [ledger], missingLedgerIds: [], onEnsureLedgers: vi.fn(), onSaveLedgers: vi.fn(),
      onSaveLedgerEnabled: vi.fn()
    }
    const { rerender } = render(<ControlledFavoriteLedgerPanel {...props} currentAccountMid="100" />)
    fireEvent.click(screen.getByRole('button', { name: '移出同步 bilimi·A' }))
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'false')

    rerender(<ControlledFavoriteLedgerPanel {...props} currentAccountMid="200" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true'))
  })

  it('shows a retryable scan-start failure when the controlled start command is rejected', async () => {
    const command = vi.fn().mockRejectedValue(new Error('current Bilibili account is unavailable'))
    const onTransientFeedback = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
      onTransientFeedback={onTransientFeedback}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('扫描启动失败')
    expect(screen.getByRole('alert')).toHaveTextContent('current Bilibili account is unavailable')
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    expect(screen.queryByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).not.toBeInTheDocument()
    expect(onTransientFeedback).toHaveBeenCalledWith('current Bilibili account is unavailable')

    fireEvent.click(screen.getByRole('button', { name: '重新扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
  })

  it('waits for an explicit continue action before resuming a persisted failed incremental scan', async () => {
    const failed = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'failed' as const, failureCount: 1, reason: 'network unavailable' }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({ ...failed, scan: { phase: 'inventory' as const, failureCount: 1 } })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(failed),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()

    expect(command).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '继续扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'resume-scan' }))
  })

  it('maps page-target diagnostics to a recoverable scan message without exposing the internal reason', async () => {
    const failed = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'failed' as const, failureCount: 1, reason: 'target-unavailable' }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(failed)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认当前 B站页面，请保持已登录的 B站页面打开后继续扫描')
    expect(screen.queryByText('target-unavailable')).not.toBeInTheDocument()
  })

  it('offers an explicit direct-session retry for an API network failure before restarting the read-only scan', async () => {
    const failed = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'failed' as const, failureCount: 1, reason: 'network-failure' }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const retryDirect = vi.fn().mockResolvedValue({ mode: 'direct' as const })
    const command = vi.fn().mockResolvedValue({ ...failed, scan: { phase: 'inventory' as const, failureCount: 1 } })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(failed),
      commandOldFavoriteWorkspaceV1: command,
      retryBilibiliSessionDirect: retryDirect
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()

    expect(await screen.findByRole('alert')).toHaveTextContent('B 站网络连接中断')
    expect(screen.queryByText('network-failure')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本次直连后继续扫描' }))

    await waitFor(() => expect(retryDirect).toHaveBeenCalledOnce())
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'resume-scan' }))
    expect(retryDirect.mock.invocationCallOrder[0]).toBeLessThan(command.mock.invocationCallOrder[0])
  })

  it('shows live item scan progress instead of an empty progress bar', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: {
        phase: 'inventory' as const, failureCount: 0, totalItemCount: 243, scannedItemCount: 40,
        taggedItemCount: 31, untaggedItemCount: 9
      },
      sourceFolders: [{ id: 'source', title: '默认收藏夹', itemCount: 243, isBilimiWorkFolder: false, selected: true }],
      continuationCount: 0, segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect((await screen.findAllByLabelText('收藏扫描进度')).find((element) => element.tagName === 'PROGRESS')).toHaveAttribute('value', '40')
    expect(screen.getByText('40 / 243 条')).toBeInTheDocument()
    expect(screen.queryByLabelText('标签识别进度')).not.toBeInTheDocument()
    expect(screen.queryByText('已扫描 40 条视频，待获取标签')).not.toBeInTheDocument()
  })

  it('keeps paused tag enrichment visible and lets the user resume or adopt the current tags', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 1, untaggedItemCount: 2 },
      tagEnrichment: { status: 'paused' as const, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1 },
      sourceFolders: [], continuationCount: 0,
      segments: [{ id: 'segment-1', index: 0, itemCount: 3, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1, 2, 3], items: [{ aid: 1, tags: ['已有标签'], sourceFolderIds: [] }, { aid: 2, sourceFolderIds: [] }, { aid: 3, sourceFolderIds: [] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '扫描概览' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/标签补取\s*已暂停/)
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '继续补取标签' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '采用当前标签' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '继续补取标签' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'resume-tag-enrichment' }))
    fireEvent.click(screen.getByRole('button', { name: '采用当前标签' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'accept-current-tags' }))
  })

  it('separates tag retrieval failures from videos confirmed without tags', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 3, scannedItemCount: 3, taggedItemCount: 1, untaggedItemCount: 2 },
      tagEnrichment: { status: 'complete' as const, totalItemCount: 2, completedItemCount: 2, pendingItemCount: 0, failedItemCount: 1 },
      sourceFolders: [], continuationCount: 0, segments: [], currentSegment: null,
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview) } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '扫描概览' }))
    expect(await screen.findByText('标签补取已完成：已处理 2 / 2 条。')).toBeInTheDocument()
    const tagResults = screen.getByLabelText('标签补取结果')
    expect(tagResults).toHaveTextContent('本轮获取标签1')
    expect(tagResults).toHaveTextContent('本轮确认无标签0')
    expect(tagResults).toHaveTextContent('读取失败1')
  })

  it('maps page execution failures to a recoverable scan message without exposing the internal reason', async () => {
    const failed = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'failed' as const, failureCount: 1, reason: 'page-execution-failed' }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(failed)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后继续扫描')
    expect(screen.queryByText('page-execution-failed')).not.toBeInTheDocument()
  })

  it('keeps a failed Bilibili confirmation visible instead of making the action appear inert', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockRejectedValue(new Error('remote-target-unbound'))
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('本轮目标收藏夹尚未同步到 B 站')
  })

  it('syncs enabled ledgers without querying or deleting disabled managed folders', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    const save = vi.fn().mockResolvedValue(undefined)
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
        { logicalLedgerId: 'custom-tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 1 }
      ]),
      deleteManagedFavoriteFolders: vi.fn().mockResolvedValue([
        { id: 'remote-tech', title: 'bilimi·科技', memberCount: 1 }
      ])
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true, bilibiliFolderId: 'remote-knowledge' },
      { id: 'custom-tech', displayName: 'bilimi·科技', keywords: [], enabled: false, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'confirm-and-execute-bilibili-plan' }))
    expect(window.bilimiDesktop.previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(window.bilimiDesktop.deleteManagedFavoriteFolders).not.toHaveBeenCalled()
  })

  it('does not let an unknown deletion preview block normal Bilibili sync', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    const save = vi.fn()
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      previewManagedFavoriteFolderDeletion: vi.fn().mockResolvedValue([
        { logicalLedgerId: 'custom-tech', remoteFolderId: 'remote-tech', title: 'bilimi·科技', memberCount: 1 }
      ]),
      deleteManagedFavoriteFolders: vi.fn().mockResolvedValue({ status: 'result-unknown' })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
      { id: 'custom-tech', displayName: 'bilimi·科技', keywords: [], enabled: false, priority: 20, isDefault: false, bilibiliFolderId: 'remote-tech' }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'confirm-and-execute-bilibili-plan' }))
    expect(window.bilimiDesktop.previewManagedFavoriteFolderDeletion).not.toHaveBeenCalled()
    expect(window.bilimiDesktop.deleteManagedFavoriteFolders).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('backs up an unbound confirmation target before asking the main process to execute it', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={['music']}
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'confirm-and-execute-bilibili-plan' }))
    expect(ensure.mock.invocationCallOrder[0]).toBeLessThan(command.mock.invocationCallOrder[0])
  })

  it('keeps confirmation actionable when automatic backup fails instead of sending an unbound plan', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    const ensure = vi.fn().mockResolvedValue({ ok: false, message: 'B 站收藏夹同步失败。' })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={['music']}
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    await waitFor(() => expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent('B 站收藏夹同步失败。'))
    expect(command).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeEnabled()
  })

  it('shows that an unbound target is being backed up before remote execution starts', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    let completeBackup: ((value: { ok: true }) => void) | undefined
    const ensure = vi.fn(() => new Promise<{ ok: true }>((resolve) => { completeBackup = resolve }))
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={['music']}
      ledgers={[{ id: 'music', displayName: 'bilimi·音乐舞台', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    expect((await screen.findAllByRole('status')).find((element) => element.textContent?.includes('正在同步目标收藏夹'))).toHaveTextContent('正在同步目标收藏夹')
    await act(async () => { completeBackup?.({ ok: true }) })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'confirm-and-execute-bilibili-plan' }))
  })

  it('does not show scan-start failure from the previous account after switching accounts', async () => {
    const scanning = {
      version: 1 as const, accountMid: '200', workspaceId: 'workspace-200', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    let rejectScan: ((reason?: unknown) => void) | undefined
    const command = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectScan = reject }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn((accountMid: string) => Promise.resolve(accountMid === '200' ? scanning : null)),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' }))

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()
    await act(async () => { rejectScan?.(new Error('unavailable')) })

    expect(screen.queryByText('扫描启动失败，请重新扫描。')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新扫描' })).not.toBeInTheDocument()
  })

  it('moves an open preview guide to confirmation only after the explicit step click', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 },
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }], continuationCount: 0,
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1 }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: {
        candidates: [{ id: 'author-up', displayName: 'bilimi·UP', kind: 'author' as const, count: 2, reason: 'UP appeared.' }],
        adoptedCandidateIds: []
      }, history: { cursor: 0, length: 0 }
    }
    const frozen = { ...preview, status: 'frozen' as const }
    const command = vi.fn((_accountMid: string, input: { type: string }) => Promise.resolve(
      input.type === 'set-recommended-candidates'
        ? { ...preview, recommendations: { ...preview.recommendations, adoptedCandidateIds: ['author-up'] } }
        : frozen
    ))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step'))
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeInTheDocument()
  })

  it('returns an open preview guide to the scan step after the account changes to a scanning workspace', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const scanning = {
      ...preview, accountMid: '200', workspaceId: 'workspace-200', status: 'scanning' as const,
      scan: { phase: 'inventory' as const, failureCount: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn((accountMid: string) => Promise.resolve(accountMid === '100' ? preview : scanning)),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    expect(await screen.findByRole('region', { name: '归档预览' })).toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.getByText('正在扫描收藏夹基本信息。扫描完成后会补取标签；标签补取完成前，建议先等待，不要提前进入后续整理。')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
  })

  it('routes the preview-stage recommendation, classification, and confirmation controls through controlled commands', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [
        { id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true },
        { id: 'bilimi-empty', title: 'Bilimi Inbox', itemCount: 0, isBilimiWorkFolder: true, selected: false }
      ],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Alpha', author: 'UP', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: {
        candidates: [{ id: 'custom-author-up', displayName: 'bilimi·UP', kind: 'author' as const, count: 1, reason: 'UP appeared.' }],
        adoptedCandidateIds: []
      },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    const command = vi.fn(async (_accountMid: string, input: { type: string }) => input.type === 'confirm-and-execute-bilibili-plan'
      ? { ...preview, status: 'executing' as const }
      : preview)
    let resolveDeepSeek: ((value: { snapshot: typeof preview; referencedConstraintLedgerNames: string[]; progress: { totalChunks: number; completedChunks: number; successfulVideoCount: number; failedVideoCount: number }; failures: [] }) => void) | undefined
    const deepSeek = vi.fn(() => new Promise<{ snapshot: typeof preview; referencedConstraintLedgerNames: string[]; progress: { totalChunks: number; completedChunks: number; successfulVideoCount: number; failedVideoCount: number }; failures: [] }>((resolve) => { resolveDeepSeek = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      organizeOldFavoriteWorkspaceDeepSeekV1: deepSeek
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[
        { id: 'music', displayName: 'bilimi·Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true },
        { id: 'knowledge', displayName: 'bilimi·Knowledge', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: true }
      ]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
      deepSeekArchiveAvailable
    />)

    await openPersistedWorkspaceGuide()
    await screen.findByRole('button', { name: '归档预览' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    await screen.findByRole('region', { name: '归档预览' })
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    const firstDeepSeekDialog = await screen.findByRole('dialog', { name: 'DeepSeek 整理' })
    fireEvent.click(within(firstDeepSeekDialog).getByLabelText('只整理【未匹配到合适分类】'))
    fireEvent.click(within(firstDeepSeekDialog).getByRole('button', { name: '开始 DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100', 'unclassified-only', 'current'))
    expect(screen.getByRole('status')).toHaveTextContent('DeepSeek 正在整理当前批次…')
    resolveDeepSeek?.({ snapshot: preview, referencedConstraintLedgerNames: ['bilimi·动画'], progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: [] })
    await screen.findByText('DeepSeek 整理完成，已更新当前批次。本次整理参考了 DeepSeek 约束收藏夹：bilimi·动画。')
    deepSeek.mockRejectedValueOnce(new Error('DeepSeek 服务暂时不可用'))
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始 DeepSeek 整理' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('DeepSeek 服务暂时不可用')
    deepSeek.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'old-favorite-workspace-v1:deepseek-current-segment': DeepSeekServiceError: DeepSeek returned invalid JSON."
    ))
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始 DeepSeek 整理' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('DeepSeek 整理失败，请检查服务设置后重试。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking remote method')
    fireEvent.click(screen.getByRole('button', { name: '转移 Alpha' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'bilimi·Knowledge' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'confirm-and-execute-bilibili-plan'
    }))
    expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] })
    expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })
    expect(deepSeek).toHaveBeenCalledWith('100', 'unclassified-only', 'current')
  })

  it('keeps the DeepSeek batch scope choices inside the DeepSeek dialog', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Alpha', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 1 }
    }
    let resolveDeepSeek!: (value: { snapshot: typeof preview; referencedConstraintLedgerNames: string[]; progress: { totalChunks: number; completedChunks: number; successfulVideoCount: number; failedVideoCount: number }; failures: [] }) => void
    const deepSeek = vi.fn(() => new Promise<{ snapshot: typeof preview; referencedConstraintLedgerNames: string[]; progress: { totalChunks: number; completedChunks: number; successfulVideoCount: number; failedVideoCount: number }; failures: [] }>((resolve) => { resolveDeepSeek = resolve }))
    const finishDeepSeekTask = vi.fn()
    const onDeepSeekTaskStart = vi.fn(() => finishDeepSeekTask)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      organizeOldFavoriteWorkspaceDeepSeekV1: deepSeek
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} deepSeekArchiveAvailable
    onDeepSeekTaskStart={onDeepSeekTaskStart} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    const dialog = await screen.findByRole('dialog', { name: 'DeepSeek 整理' })
    expect(within(dialog).getByLabelText('当前批次')).toBeChecked()
    expect(within(dialog).getByLabelText('本轮所有批次')).not.toBeChecked()
    fireEvent.click(within(dialog).getByLabelText('本轮所有批次'))
    fireEvent.click(within(dialog).getByRole('button', { name: '开始 DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100', 'low-confidence-and-unclassified', 'all'))
    expect(onDeepSeekTaskStart).toHaveBeenCalledWith('收藏整理：本轮所有批次')
    expect(screen.getByRole('combobox', { name: '整理批次' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '扫描概览' })).toBeEnabled()
    resolveDeepSeek({
      snapshot: preview, referencedConstraintLedgerNames: [],
      progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: []
    })
    await waitFor(() => expect(finishDeepSeekTask).toHaveBeenCalledOnce())
  })

  it('keeps the batch selector separate from page-level whole-run switches and returns to the batch after selection', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 500, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [{ id: 'current-only', displayName: '当前批候选', kind: 'author' as const, count: 1, currentSegmentCount: 1, reason: 'current batch only' }], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 501, classifiedAidCount: 500, unclassifiedAidCount: 1 },
      history: { cursor: 0, length: 0, entries: [] },
      overview: { available: true, completedSegmentCount: 2, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 501, classifiedItemCount: 500, unmatchedItemCount: 1, waitingItemCount: 0,
        recommendationCounts: [], archiveTargets: [] }
    }
    let persisted = preview
    const command = vi.fn(async (_accountMid: string, input: { type: string; segmentId?: string }) => {
      if (input.type === 'select-segment' && input.segmentId === 'segment-2') {
        persisted = { ...persisted, currentSegment: { id: 'segment-2', aids: [501], items: [{ aid: 501, title: 'Last', sourceFolderIds: ['source'] }] } }
      }
      return persisted
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'Music', keywords: [], enabled: true, priority: 0, isDefault: true }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    await screen.findByRole('button', { name: '推荐收藏夹' })
    const stepNavigation = screen.getByRole('navigation', { name: '整理收藏步骤' })
    expect(within(stepNavigation).queryByRole('button', { name: '本轮总览' })).not.toBeInTheDocument()
    fireEvent.click(within(stepNavigation).getByRole('button', { name: '确认执行' }))
    fireEvent.click(within(screen.getByRole('group', { name: '确认执行视图' })).getByRole('button', { name: '本轮总览' }))
    expect(screen.getByRole('group', { name: '本轮操作' })).toBeInTheDocument()
    for (const [stepName, groupName] of [
      ['推荐收藏夹', '推荐收藏夹视图'], ['归档预览', '归档预览视图']
    ] as const) {
      fireEvent.click(within(stepNavigation).getByRole('button', { name: stepName }))
      expect(within(screen.getByRole('group', { name: groupName })).getByRole('button', { name: '本轮总览' }))
        .toHaveAttribute('aria-pressed', 'true')
      if (stepName === '推荐收藏夹') {
        expect(screen.queryByRole('checkbox', { name: '当前批候选' })).not.toBeInTheDocument()
      }
      if (stepName === '归档预览') {
        expect(screen.getByTestId('whole-run-archive-view')).not.toHaveAttribute('hidden')
        expect(screen.getByTestId('current-archive-view')).toHaveAttribute('hidden', '')
      }
    }

    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-2' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'select-segment', segmentId: 'segment-2' }))
    for (const [stepName, groupName] of [
      ['扫描概览', '扫描概览视图'], ['推荐收藏夹', '推荐收藏夹视图'], ['归档预览', '归档预览视图']
    ] as const) {
      fireEvent.click(within(stepNavigation).getByRole('button', { name: stepName }))
      expect(within(screen.getByRole('group', { name: groupName })).getByRole('button', { name: '当前批次' }))
        .toHaveAttribute('aria-pressed', 'true')
    }
    fireEvent.click(within(stepNavigation).getByRole('button', { name: '确认执行' }))
    expect(screen.getByRole('group', { name: '本批操作' })).toBeInTheDocument()
  })

  it('lets the global overview browse later steps while the selected batch is still fetching tags', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 501, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 500, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-2', aids: [501], items: [{ aid: 501, title: 'Waiting', sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 501, classifiedAidCount: 500, unclassifiedAidCount: 1 },
      overview: { available: true, completedSegmentCount: 1, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 500, classifiedItemCount: 500, unmatchedItemCount: 0, waitingItemCount: 1,
        recommendationCounts: [], archiveTargets: [] },
      history: { cursor: 0, length: 0, entries: [] }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    expect(await screen.findByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    const stepNavigation = screen.getByRole('navigation', { name: '整理收藏步骤' })
    const confirmation = within(stepNavigation).getByRole('button', { name: '确认执行' })
    expect(confirmation).toBeEnabled()
    fireEvent.click(confirmation)
    expect(confirmation).toHaveAttribute('aria-current', 'step')
    expect(within(screen.getByRole('group', { name: '确认执行视图' }))
      .getByRole('button', { name: '当前批次' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('group', { name: '本批操作' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂不同步，结束本轮整理' })).toBeEnabled()
  })

  it('opens a persisted whole-run wait on confirmation and keeps cancellation available while edits stay locked', async () => {
    const waiting = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 500, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] },
      executionIntent: { mode: 'local' as const, status: 'waiting' as const, waitingSegmentCount: 1, waitingForDeepSeek: false }
    }
    const cleared = { ...waiting, executionIntent: undefined }
    const command = vi.fn(async (_accountMid: string, input: { type: string }) => {
      if (input.type === 'select-recovery-decision') return {
        accountMid: '100', workspaceId: 'workspace-100', choice: 'merge-latest',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
      }
      return input.type === 'cancel-whole-run-execution-intent' ? cleared : waiting
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(waiting),
      prepareOldFavoriteWorkspaceRecoveryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['recover-draft', 'rescan', 'abandon']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    expect(await screen.findByRole('status')).toHaveTextContent('等待 1 个批次完成预处理')
    expect(screen.getByRole('combobox', { name: '整理批次' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '取消等待执行' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '取消等待执行' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'cancel-whole-run-execution-intent' }))
  })

  it('renders UP and tag recommendation cards and restores whole-round choices across segments and remounts', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: {},
      recommendations: {
        candidates: [
          { id: 'author-up', displayName: '阿婆主', kind: 'author' as const, count: 8, reason: '常看 UP' },
          { id: 'series-tech', displayName: 'bilimi·科技', kind: 'tag' as const, count: 5, reason: 'appeared 5 times' }
        ],
        adoptedCandidateIds: ['author-up']
      },
      history: { cursor: 0, length: 0 }
    }
    let persisted = preview
    const command = vi.fn(async (_accountMid: string, input: { type: string, candidateIds?: string[], segmentId?: string }) => {
      if (input.type === 'set-recommended-candidates') {
        persisted = { ...persisted, recommendations: { ...persisted.recommendations, adoptedCandidateIds: input.candidateIds ?? [] } }
      }
      if (input.type === 'select-segment') {
        persisted = { ...persisted, currentSegment: { id: input.segmentId ?? 'segment-1', aids: [2], items: [{ aid: 2, sourceFolderIds: [] }] } }
      }
      return persisted
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn(() => Promise.resolve(persisted)),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const props = {
      currentAccountMid: '100', ledgers: [], missingLedgerIds: [],
      onEnsureLedgers: vi.fn(), onSaveLedgers: vi.fn()
    }
    const { unmount } = render(<ControlledFavoriteLedgerPanel {...props} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('heading', { name: '专属 UP 追更' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '高频标签收藏夹' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '全选 专属 UP 追更' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '全选 高频标签收藏夹' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: '阿婆主' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '科技' })).not.toBeChecked()
    expect(screen.getByText('8 条适合')).toBeInTheDocument()
    expect(screen.queryByText(/常看 UP/)).not.toBeInTheDocument()
    expect(screen.getByText('5 条适合')).toBeInTheDocument()
    expect(screen.queryByText(/appeared 5 times/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '科技' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: ['author-up', 'series-tech']
    }))

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    await screen.findByRole('region', { name: '归档预览' })
    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-2' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'select-segment', segmentId: 'segment-2' }))
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('checkbox', { name: '阿婆主' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '科技' })).toBeChecked()

    unmount()
    render(<ControlledFavoriteLedgerPanel {...props} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('checkbox', { name: '阿婆主' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '科技' })).toBeChecked()
  })

  it('opens archive preview immediately while the latest recommendation save finishes in the background', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'tag-c', displayName: 'C', kind: 'tag' as const, count: 2, reason: 'C' }],
        adoptedCandidateIds: [] as string[]
      },
      history: { cursor: 0, length: 0 }
    }
    let resolveSave!: (value: typeof preview) => void
    const save = new Promise<typeof preview>((resolve) => { resolveSave = resolve })
    const command = vi.fn((_accountMid: string, input: { type: string }) =>
      input.type === 'set-recommended-candidates' ? save : Promise.resolve(preview))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    const navigation = await screen.findByRole('navigation')
    const stepButtons = within(navigation).getAllByRole('button')
    fireEvent.click(stepButtons[1]!)
    const candidate = screen.getByRole('checkbox', { name: 'C' })
    fireEvent.click(candidate)

    expect(candidate).toBeChecked()
    expect(candidate).toBeEnabled()
    expect(screen.queryByText('正在更新推荐收藏夹，仍可继续调整选择。')).not.toBeInTheDocument()
    expect(stepButtons[2]).toBeEnabled()
    expect(stepButtons[3]).toBeDisabled()
    fireEvent.click(stepButtons[2]!)
    expect(await screen.findByRole('region', { name: '归档预览' })).toBeInTheDocument()
    expect(stepButtons[3]).toBeDisabled()

    await act(async () => {
      resolveSave({
        ...preview,
        recommendations: { ...preview.recommendations, adoptedCandidateIds: ['tag-c'] }
      })
      await save
    })

    expect(command).not.toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'prepare-recommendation-preview'
    }))
    await waitFor(() => expect(stepButtons[3]).toBeEnabled())
  })

  it('keeps every candidate selected when several boxes are clicked before the first save returns', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [
          { id: 'author-a', displayName: 'A', kind: 'author' as const, count: 2, reason: 'A' },
          { id: 'author-b', displayName: 'B', kind: 'author' as const, count: 2, reason: 'B' },
          { id: 'tag-c', displayName: 'C', kind: 'tag' as const, count: 2, reason: 'C' }
        ],
        adoptedCandidateIds: [] as string[]
      },
      history: { cursor: 0, length: 0 }
    }
    const save = new Promise<typeof preview>(() => undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockReturnValue(save)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }))

    expect(screen.getByRole('checkbox', { name: 'A' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'B' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'C' })).toBeChecked()
  })

  it('immediately saves a selected recommendation as an enabled unbacked ledger', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-a', displayName: 'bilimi·A', kind: 'author' as const, count: 2, reason: 'A' }],
        adoptedCandidateIds: [] as string[]
      },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        ...preview,
        recommendations: { ...preview.recommendations, adoptedCandidateIds: ['author-a'] }
      })
    } as unknown as typeof window.bilimiDesktop

    const save = vi.fn().mockResolvedValue(undefined)
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))

    expect(await screen.findByRole('button', { name: 'A' })).toBeInTheDocument()
    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'author-a', displayName: 'bilimi·A', enabled: true, bindingState: 'unbacked', isDefault: false
      })
    ], { deleteDisabled: false }))
    expect(save.mock.calls[0]?.[0][0]).not.toHaveProperty('syncState')
  })

  it('waits for a promoted recommendation save before cancelling it', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [{ id: 'author-pending', displayName: 'bilimi·待保存', kind: 'author' as const, count: 2, reason: '待保存' }], adoptedCandidateIds: [] as string[] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn((_accountMid: string, input: { type: string; candidateIds?: string[] }) => Promise.resolve({
      ...preview,
      recommendations: { ...preview.recommendations, adoptedCandidateIds: input.type === 'set-recommended-candidates' ? (input.candidateIds ?? []) : [] }
    }))
    const save = deferred<unknown>()
    const onSaveLedgers = vi.fn(() => save.promise)
    const deleteFavoriteLedgersLocal = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      deleteFavoriteLedgersLocal
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={onSaveLedgers} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '待保存' }))
    fireEvent.click(await screen.findByRole('button', { name: '待保存' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await act(async () => save.resolve(undefined))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: '待保存' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '待保存', checked: true })).not.toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel currentAccountMid="100" missingLedgerIds={[]}
      ledgers={[{ id: 'unrelated', displayName: 'bilimi·其他收藏', keywords: [], enabled: true, priority: 1, isDefault: false }]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={onSaveLedgers} />)

    expect(screen.getByRole('button', { name: '其他收藏' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '待保存' })).not.toBeInTheDocument()
  })

  it('keeps a promoted recommendation and its selection when recommendation cancellation fails', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [{ id: 'author-failed-delete', displayName: 'bilimi·删除失败', kind: 'author' as const, count: 2, reason: '删除失败' }], adoptedCandidateIds: [] as string[] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn((_accountMid: string, input: { type: string; candidateIds?: string[] }) => input.type === 'set-recommended-candidates' && input.candidateIds?.length === 0
      ? Promise.reject(new Error('recommendation cancellation failed'))
      : Promise.resolve({
          ...preview,
          recommendations: { ...preview.recommendations, adoptedCandidateIds: input.type === 'set-recommended-candidates' ? (input.candidateIds ?? []) : [] }
        }))
    const deleteFavoriteLedgersLocal = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
      deleteFavoriteLedgersLocal
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn().mockResolvedValue(undefined)} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '删除失败' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除失败' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
    expect(await screen.findByText('删除未成功，请稍后重试。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除失败' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '删除失败' })).toBeChecked()
    expect(deleteFavoriteLedgersLocal).not.toHaveBeenCalled()
  })

  it('projects a recommendation onto the existing logical ledger and preserves its real binding details', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-alice', displayName: 'bilimi·Alice', keywords: ['Alice'], kind: 'author' as const, count: 2, reason: 'Alice' }],
        adoptedCandidateIds: ['author-alice']
      },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'saved-alice', displayName: 'bilimi·Alice精选', keywords: ['Alice'], ruleType: 'author', enabled: true,
      priority: 42, bindingState: 'bound', bilibiliFolderId: 'remote-alice', bilibiliFolderIds: ['remote-alice', 'remote-alice-2'],
      bilibiliFolderTitle: 'bilimi·Alice精选', bilibiliFolderVideoCount: 7, isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))

    expect(screen.queryByTestId('favorite-ledger-chip-author-alice')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Alice精选' }))
    expect(screen.getByLabelText('册名')).toHaveValue('Alice精选')
    expect(screen.getByText('已备册')).toBeInTheDocument()
    expect(screen.getByText('B站绑定：2 个收藏夹，共 7 个视频')).toBeInTheDocument()
  })

  it('maps the top-card participation toggle back to a recommendation candidate with a different local id', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-alice', displayName: 'bilimi·Alice', keywords: ['Alice'], kind: 'author' as const, count: 2, reason: 'Alice' }],
        adoptedCandidateIds: [] as string[]
      },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({
      ...preview,
      recommendations: { ...preview.recommendations, adoptedCandidateIds: ['author-alice'] }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'saved-alice', displayName: 'bilimi·Alice精选', keywords: ['Alice'], ruleType: 'author', enabled: true,
      priority: 42, bindingState: 'bound', bilibiliFolderId: 'remote-alice', isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alice', checked: false }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: ['author-alice']
    }))

    fireEvent.click(await screen.findByRole('button', { name: '移出同步 bilimi·Alice精选' }))
    await waitFor(() => expect(command).toHaveBeenLastCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
  })

  it('projects the normalized author name and complete UP rule into the legacy editor', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{
          id: 'custom-author-honker233-小王爱马枪', displayName: 'bilimi·honker233',
          keywords: ['honker233-小王爱马枪'], kind: 'author' as const, count: 2, reason: '常看 UP'
        }],
        adoptedCandidateIds: ['custom-author-honker233-小王爱马枪']
      },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('button', { name: '固定显示收藏夹说明' }))
    fireEvent.click(await screen.findByRole('button', { name: 'honker233' }))

    expect(screen.getByLabelText('册名')).toHaveValue('honker233')
    expect(screen.getByLabelText('UP 名字')).toHaveValue('honker233-小王爱马枪')
    expect(screen.queryByText(/不能超过 20/)).not.toBeInTheDocument()
  })

  it('uses a selected recommendation name and backup state throughout the organization guide', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 20, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 20, status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, itemCount: 10, status: 'previewing' as const, readiness: 'ready' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [] },
      classifications: {
        '1': { aid: 1, targetLedgerIds: ['custom-author-honker233'], source: 'system-high' as const }
      },
      recommendations: {
        candidates: [{
          id: 'custom-author-honker233', displayName: 'bilimi·Honker', kind: 'author' as const,
          count: 30, reason: 'Honker appeared.'
        }],
        adoptedCandidateIds: ['custom-author-honker233']
      },
      overview: {
        completedSegmentCount: 2, totalSegmentCount: 2, available: true,
        sourceFolders: [], unavailableItemCount: 0, processedItemCount: 30,
        classifiedItemCount: 30, unmatchedItemCount: 0, waitingItemCount: 0,
        recommendationCounts: [{ id: 'custom-author-honker233', count: 30 }],
        archiveTargets: [{
          ledgerId: 'custom-author-honker233', itemCount: 30,
          segmentCounts: [{ segmentId: 'segment-1', count: 20 }, { segmentId: 'segment-2', count: 10 }]
        }]
      },
      planReadiness: { selectedAidCount: 30, classifiedAidCount: 30, unclassifiedAidCount: 0 },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    const ensure = vi.fn().mockResolvedValue({ ok: true })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(within(screen.getByRole('group', { name: '确认执行视图' })).getByRole('button', { name: '本轮总览' }))
    expect(screen.getByText('bilimi·Honker')).toBeInTheDocument()
    expect(screen.queryByText('custom-author-honker233')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-whole-run-execution-intent', mode: 'bilibili'
    }))
  })

  it('removes a saved unbacked recommendation from the local folder list when it is deselected', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-a', displayName: 'bilimi·A', kind: 'author' as const, count: 2, reason: 'A' }],
        adoptedCandidateIds: ['author-a']
      },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        ...preview,
        recommendations: { ...preview.recommendations, adoptedCandidateIds: [] }
      })
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'author-a', displayName: 'bilimi·A', keywords: [], ruleType: 'author', enabled: true,
      priority: 10_000, bindingState: 'unbacked', isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    const checkbox = await screen.findByRole('checkbox', { name: 'A', checked: true })
    fireEvent.click(checkbox)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'A', checked: false })).toBeInTheDocument()
  })

  it('keeps an unbound recommendation with an actual Bilibili folder when it is deselected', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-unbound', displayName: 'bilimi·Unbound', kind: 'author' as const, count: 2, reason: 'unbound' }],
        adoptedCandidateIds: ['author-unbound']
      },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({
      ...preview,
      recommendations: { ...preview.recommendations, adoptedCandidateIds: [] }
    })
    const save = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'author-unbound', displayName: 'bilimi·Unbound', keywords: [], ruleType: 'author', enabled: true,
      priority: 10_000, syncState: 'local-draft', bindingState: 'unbound', bilibiliFolderId: 'remote-unbound', isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Unbound', checked: true }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: []
    }))
    expect(screen.getByRole('button', { name: 'Unbound' })).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })

  it('treats the workspace recommendation selection as the top-card participation state without persisting a bound folder toggle', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: {
        candidates: [{ id: 'author-bound', displayName: 'bilimi·Bound', kind: 'author' as const, count: 2, reason: 'bound' }],
        adoptedCandidateIds: []
      },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const command = vi.fn().mockResolvedValue(preview)
    const saveEnabled = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[{
      id: 'author-bound', displayName: 'bilimi·Bound', keywords: ['Bound'], ruleType: 'author', enabled: true,
      priority: 10_000, bilibiliFolderId: 'remote-bound', bindingState: 'bound', isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onSaveLedgerEnabled={saveEnabled} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(await screen.findByRole('checkbox', { name: 'Bound' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '加入同步 bilimi·Bound' })).toBeInTheDocument()
    expect(saveEnabled).not.toHaveBeenCalled()
    expect(command).not.toHaveBeenCalledWith('100', {
      type: 'set-recommended-candidates', candidateIds: ['author-bound']
    })
  })

  it('shows archive preview without starting background preparation', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] as string[] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(await screen.findByRole('region', { name: '归档预览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled()
    expect(command).not.toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'prepare-recommendation-preview'
    }))
  })

  it('explains why no recommendations are available', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByText('本轮没有足够重复的 UP 或标签，暂不生成推荐收藏夹。')).toBeInTheDocument()
  })

  it('shows only the first six tag recommendations until the legacy expand action is chosen', async () => {
    const authorCandidates = Array.from({ length: 7 }, (_, index) => ({
      id: `author-${index + 1}`, displayName: `bilimi·UP${index + 1}`, kind: 'author' as const,
      count: 7 - index, reason: `UP ${index + 1}`
    }))
    const tagCandidates = Array.from({ length: 7 }, (_, index) => ({
      id: `tag-${index + 1}`, displayName: `bilimi·标签${index + 1}`, kind: 'tag' as const,
      count: 7 - index, reason: `高频标签 ${index + 1}`
    }))
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: [...authorCandidates, ...tagCandidates], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('checkbox', { name: 'UP6' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'UP7' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '标签6' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '标签7' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开更多专属 UP 追更' }))
    expect(screen.getByRole('checkbox', { name: 'UP7' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起专属 UP 追更' }))
    expect(screen.queryByRole('checkbox', { name: 'UP7' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开更多高频标签' }))
    expect(screen.getByRole('checkbox', { name: '标签7' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '收起高频标签' }))
    expect(screen.queryByRole('checkbox', { name: '标签7' })).not.toBeInTheDocument()
  })

  it('shows newest-first history details and routes a selected history record to the main process', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Watch later', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['knowledge'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: {
        cursor: 2, length: 2,
        entries: [
          { cursor: 2, source: 'manual' as const, changeCount: 1, targetLedgerIds: ['knowledge'] },
          { cursor: 1, source: 'system-high' as const, changeCount: 3, targetLedgerIds: ['music'] }
        ]
      }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'knowledge', displayName: '知识学习', keywords: [], enabled: true, priority: 0, isDefault: true },
      { id: 'music', displayName: '音乐', keywords: [], enabled: true, priority: 1, isDefault: true }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '查看改动记录' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '查看改动记录' }))
    expect(screen.getByRole('menu', { name: '改动记录' })).toHaveTextContent('人工调整：1 条 → 知识学习')
    expect(screen.getByRole('menu', { name: '改动记录' })).toHaveTextContent('高置信度自动分类：3 条 → 音乐')
    fireEvent.click(screen.getByRole('menuitem', { name: '高置信度自动分类：3 条 → 音乐' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'move-history-cursor', cursor: 1 }))
  })

  it('stages every unclassified preview item locally and expands a grouped preview on demand', async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      aid: index + 1, title: `Pending ${index + 1}`, sourceFolderIds: ['source']
    }))
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Watch later', itemCount: items.length, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, itemCount: items.length, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    expect(screen.getByText('Pending 6')).toBeInTheDocument()
    expect(screen.queryByText('Pending 7')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '显示全部 9 条' }))
    expect(screen.getByText('Pending 9')).toBeInTheDocument()
    const group = screen.getByRole('group', { name: '未匹配到合适分类 9 条' })
    fireEvent.click(within(group).getByRole('button', { name: '批量转移' }))
    fireEvent.click(within(group).getByRole('button', { name: '全选' }))
    fireEvent.click(within(group).getByRole('button', { name: '转移所选' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '暂存' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: items.map((item) => ({ aid: item.aid, targetLedgerIds: ['inbox'] }))
    }))
  })

  it('shows a returned DeepSeek partial failure and retries only failed chunks', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Watch later', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0, entries: [] }
    }
    const partial = {
      snapshot: preview,
      progress: { totalChunks: 2, completedChunks: 2, successfulVideoCount: 20, failedVideoCount: 1 },
      failures: [{ chunkIndex: 2, aids: [1], affectedVideoCount: 1, message: 'DeepSeek returned unavailable favorite targets.' }]
    }
    const organize = vi.fn().mockResolvedValue(partial)
    const retry = vi.fn().mockResolvedValue({ ...partial, progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: [] })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      organizeOldFavoriteWorkspaceDeepSeekV1: organize,
      retryOldFavoriteWorkspaceDeepSeekV1: retry
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} deepSeekArchiveAvailable />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '开始整理' }))
    fireEvent.click(await screen.findByRole('button', { name: '开始 DeepSeek 整理' }))
    expect(await screen.findByText(/已处理 20 条；1 条未应用/)).toBeInTheDocument()
    expect(screen.getByText('第 2 批：返回了已不可用的收藏夹目标，1 条未应用，可重试。')).toBeInTheDocument()
    expect(screen.queryByText(/unavailable favorite targets/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试失败批次' }))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('100'))
  })
  it('renders source, confidence, and a virtualized multi-segment archive preview', async () => {
    const items = Array.from({ length: 51 }, (_, index) => ({
      aid: index + 1,
      title: index === 0 ? 'First archive' : `Archive ${index + 1}`,
      author: index === 0 ? 'Uploader' : undefined,
      sourceFolderIds: ['source']
    }))
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 51, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Watch later', itemCount: 51, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 51, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 51, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 },
        { id: 'segment-3', index: 2, itemCount: 1, status: 'previewing' as const, readiness: 'waiting' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-low' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockImplementation(async (_accountMid: string, input: { type: string; segmentId?: string }) => input.type === 'select-segment' && input.segmentId === 'segment-3'
      ? { ...preview, currentSegment: { id: 'segment-3', aids: [], items: [] } }
      : preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))

    expect(screen.getByRole('group', { name: '归档预览辅助工具' })).toHaveClass('favorite-ledger-panel__archive-tool-card')
    expect(screen.queryByRole('group', { name: '归档工具' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '未匹配到合适分类 50 条' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Music 1 条' })).toBeInTheDocument()
    expect(screen.getAllByText('来源：Watch later')).not.toHaveLength(0)
    expect(screen.getAllByText('分类把握：不太稳')).not.toHaveLength(0)
    expect(screen.queryByText(/^分类来源：/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^目标收藏夹：/)).not.toBeInTheDocument()
    const selector = screen.getByRole('combobox', { name: '整理批次' })
    expect(screen.getByText('整理批次')).toBeInTheDocument()
    expect(selector.closest('.favorite-ledger-panel__guide-title-row')).toBeNull()
    expect(selector).toHaveValue('segment-1')
    expect(screen.getByRole('option', { name: '第 1/3 批 · 51 条 · 可整理' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '第 2/3 批 · 1 条 · 补取中' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '第 3/3 批 · 1 条 · 等待扫描' })).toBeEnabled()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-segment', segmentId: 'segment-2'
    }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(within(screen.getByRole('navigation', { name: '整理收藏步骤' })).getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.change(selector, { target: { value: 'segment-3' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-segment', segmentId: 'segment-3'
    }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled()
  })

  it('does not introduce segment controls for a single-segment archive preview', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Watch later', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'One', sourceFolderIds: ['source'] }] },
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))

    expect(screen.queryByRole('combobox', { name: '整理批次' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转移 One' })).toBeInTheDocument()
  })

  it('keeps only the no-sync exit available for the whole run while a later batch is still tagging', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 },
      overview: { available: true, completedSegmentCount: 1, totalSegmentCount: 2, sourceFolders: [], unavailableItemCount: 0,
        processedItemCount: 1, classifiedItemCount: 1, unmatchedItemCount: 0, waitingItemCount: 1,
        recommendationCounts: [], archiveTargets: [] },
      history: { cursor: 1, length: 1 }
    }
    const command = vi.fn().mockResolvedValue({
      ...preview, executionIntent: { mode: 'bilibili', status: 'waiting', waitingSegmentCount: 1, waitingForDeepSeek: false }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(within(await screen.findByRole('navigation', { name: '整理收藏步骤' })).getByRole('button', { name: '确认执行' }))
    fireEvent.click(within(screen.getByRole('group', { name: '确认执行视图' })).getByRole('button', { name: '本轮总览' }))

    expect(screen.getByText('整体准备度：1 / 2 条已分类')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存本轮到收藏库' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
    const abandon = screen.getByRole('button', { name: '暂不同步，结束本轮整理' })
    expect(abandon).toBeEnabled()
    fireEvent.click(abandon)
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'abandon-current-workspace'
    }))
  })

  it('keeps whole-run actions available after each batch has already been saved', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'frozen' as const, readiness: 'saved' as const, completedTagItemCount: 1, pendingTagItemCount: 0 },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'frozen' as const, readiness: 'saved' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 2, classifiedAidCount: 2, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(within(await screen.findByRole('navigation', { name: '整理收藏步骤' })).getByRole('button', { name: '确认执行' }))
    fireEvent.click(within(screen.getByRole('group', { name: '确认执行视图' })).getByRole('button', { name: '本轮总览' }))

    expect(screen.getByRole('button', { name: '重新保存本轮到收藏库' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeEnabled()
  })

  it('renders execution states from snapshots and routes only their controlled actions', async () => {
    const frozen = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'frozen' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const reconciling = { ...frozen, status: 'reconciling' as const }
    const completed = { ...frozen, status: 'completed' as const, completionMode: 'bilibili' as const }
    let persisted: typeof frozen | typeof reconciling | typeof completed = frozen
    const command = vi.fn(async (_accountMid: string, input: { type: string }) => {
      if (input.type === 'execute-frozen-bilibili-plan') persisted = { ...frozen, status: 'executing' as const } as never
      if (input.type === 'reconcile-frozen-bilibili-plan') persisted = completed
      return persisted
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockImplementation(() => Promise.resolve(persisted)),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const rendered = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '继续同步到 B 站' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'execute-frozen-bilibili-plan' }))
    expect(screen.getByRole('progressbar', { name: '正在同步到 B 站' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '对账 B 站结果' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续同步到 B 站' })).not.toBeInTheDocument()

    rendered.unmount()
    persisted = reconciling
    const acknowledgeCompletion = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onAcknowledgeOrganizationCompletion={acknowledgeCompletion} />)
    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '重新连接并检查同步结果' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'reconcile-frozen-bilibili-plan' }))
    expect(await screen.findByRole('status')).toHaveTextContent('本轮已完成同步到 B 站')
    expect(screen.queryByRole('button', { name: '确认并同步到 B 站' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(acknowledgeCompletion).toHaveBeenCalledWith('100', 'workspace-100')
    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
  })

  it('keeps executing multi-batch workspaces browseable while locking every mutation', async () => {
    const executing = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'executing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 2, isBilimiWorkFolder: false, selected: true }],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'First', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: {
        candidates: [{ id: 'author-up', displayName: 'Saved UP', kind: 'author' as const, count: 1, reason: 'Saved recommendation' }],
        adoptedCandidateIds: ['author-up']
      },
      history: { cursor: 1, length: 1 }, executionProgress: { completedOperationCount: 1, totalOperationCount: 2 }
    }
    const viewed = {
      ...executing,
      currentSegment: { id: 'segment-2', aids: [2], items: [{ aid: 2, title: 'Second', sourceFolderIds: ['source'] }] },
      classifications: { '2': { aid: 2, targetLedgerIds: ['music'], source: 'manual' as const } }
    }
    const command = vi.fn(async (_accountMid: string, input: { type: string }) => input.type === 'view-segment' ? viewed : executing)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(executing),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    for (const label of ['扫描概览', '推荐收藏夹', '归档预览', '确认执行']) {
      expect(await screen.findByRole('button', { name: label })).toBeEnabled()
    }
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('checkbox', { name: 'Saved UP' })).toBeDisabled()

    fireEvent.change(screen.getByRole('combobox', { name: '整理批次' }), { target: { value: 'segment-2' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'view-segment', segmentId: 'segment-2' }))
    expect(command).not.toHaveBeenCalledWith('100', { type: 'select-segment', segmentId: 'segment-2' })

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(await screen.findByRole('button', { name: '转移 Second' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '开始整理' })).toBeDisabled()
  })

  it('keeps navigation open but hides an incomplete batch recommendation and archive details', async () => {
    const tagging = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, title: 'Unfinished', sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-high' as const } },
      recommendations: { candidates: [{ id: 'author-up', displayName: 'Unfinished UP', kind: 'author' as const, count: 1, reason: 'Unfinished recommendation' }], adoptedCandidateIds: [] },
      tagEnrichment: { status: 'running' as const, totalItemCount: 1, completedItemCount: 0, pendingItemCount: 1, failedItemCount: 0 },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 0, length: 0, entries: [] }
    }
    const command = vi.fn().mockResolvedValue(tagging)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(tagging),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    for (const label of ['扫描概览', '推荐收藏夹', '归档预览', '确认执行']) {
      expect(await screen.findByRole('button', { name: label })).toBeEnabled()
    }

    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('status')).toHaveTextContent('当前批次标签补取中，完成后将生成推荐收藏夹。')
    expect(screen.queryByRole('checkbox', { name: 'Unfinished UP' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('status')).toHaveTextContent('当前批次标签补取中，完成后可查看归档预览。')
    expect(screen.queryByRole('button', { name: 'DeepSeek 整理' })).not.toBeInTheDocument()
    expect(screen.queryByText('Unfinished')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    expect(screen.getByRole('button', { name: '暂不同步，结束本轮整理' })).toBeEnabled()
  })

  it('refreshes the surrounding repository projection after reconciliation settles', async () => {
    const reconciling = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const completed = { ...reconciling, status: 'completed' as const, completionMode: 'bilibili' as const }
    const refreshProjection = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(reconciling),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(completed)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onRefreshOrganizationState={refreshProjection} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '重新连接并检查同步结果' }))
    await waitFor(() => expect(refreshProjection).toHaveBeenCalledOnce())
  })

  it('reports the authoritative workspace snapshot for the shared organization status light', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const reportSnapshot = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onOrganizationSnapshotChange={reportSnapshot} />)

    await waitFor(() => expect(reportSnapshot).toHaveBeenCalledWith(preview))
  })

  it('starts a protected incremental round when organizing again after completion', async () => {
    const completed = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'completed' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [], segments: [], currentSegment: null,
      classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 },
      completionMode: 'bilibili' as const
    }
    const command = vi.fn().mockResolvedValue({
      ...completed,
      status: 'scanning' as const,
      scan: { phase: 'inventory' as const, failureCount: 0 }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(completed),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'incremental'
    }))
  })

  it('keeps scan overview selected when a background refresh reports scan completion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
    const scanning = {
        version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
        mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
        scan: { phase: 'inventory' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
        segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0 }
      }
      const previewing = {
        ...scanning,
        status: 'previewing' as const,
        scan: { phase: 'complete' as const, failureCount: 0 }
      }
    let persisted: typeof scanning | typeof previewing = scanning
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockImplementation(() => Promise.resolve(persisted)),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    await screen.findByRole('region', { name: '整理收藏向导' })
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    persisted = previewing
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    await waitFor(() => expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled())

    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('region', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an already-ready batch open while another batch continues tag enrichment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const base = {
        version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
        mode: 'incremental' as const, segmentSize: 500, hasMultipleSegments: true,
        scan: { phase: 'complete' as const, failureCount: 0, totalItemCount: 501, scannedItemCount: 501 },
        tagEnrichment: { status: 'running' as const, totalItemCount: 2, completedItemCount: 1, pendingItemCount: 1, failedItemCount: 0 },
        continuationCount: 0, sourceFolders: [],
        segments: [
          { id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 500, readiness: 'ready' as const, completedTagItemCount: 500, pendingTagItemCount: 0 },
          { id: 'segment-2', index: 1, status: 'previewing' as const, itemCount: 1, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
        ],
        currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
        classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
        history: { cursor: 0, length: 0, entries: [] }
      }
      let persisted = base
      window.bilimiDesktop = {
        openOldFavoriteWorkspaceV1: vi.fn().mockImplementation(() => Promise.resolve(persisted)),
        commandOldFavoriteWorkspaceV1: vi.fn()
      } as unknown as typeof window.bilimiDesktop

      render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

      await openPersistedWorkspaceGuide()
      await screen.findByRole('region', { name: '整理收藏向导' })
      fireEvent.click(screen.getByRole('button', { name: '扫描概览' }))
      expect(screen.getByLabelText('当前批次标签进度')).toHaveAttribute('value', '500')
      expect(screen.getByText('当前批 500 / 500 条')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
      expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
      expect(await screen.findByRole('region', { name: '归档预览' })).toBeInTheDocument()

      persisted = {
        ...base,
        tagEnrichment: { ...base.tagEnrichment, completedItemCount: 2, pendingItemCount: 0 },
        segments: [base.segments[0], { ...base.segments[1], readiness: 'ready' as const, completedTagItemCount: 1, pendingTagItemCount: 0 }]
      }
      await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })

      expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('region', { name: '归档预览' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps source selection available after classifications have been persisted', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }],
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1 }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: ['source'] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 1 }
    }
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '扫描概览' }))
    const source = screen.getByRole('checkbox', { name: '选择来源 Source' })
    expect(source).toBeEnabled()
    fireEvent.click(source)
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-source-folders', folderIds: []
    }))
  })

  it('does not submit the same Bilibili confirmation twice while the controlled command is pending', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const, readiness: 'ready' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 1, classifiedAidCount: 1, unclassifiedAidCount: 0 },
      history: { cursor: 1, length: 1 }
    }
    let resolveCommand: ((value: typeof preview) => void) | undefined
    const command = vi.fn(() => new Promise<typeof preview>((resolve) => { resolveCommand = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    const confirm = screen.getByRole('button', { name: '确认并同步到 B 站' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(command).toHaveBeenCalledTimes(1)
    await act(async () => { resolveCommand?.(preview) })
  })

  it('requires authoritative plan readiness instead of inferring readiness from a rendered segment', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 1, length: 1 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await openPersistedWorkspaceGuide()
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
  })
})
