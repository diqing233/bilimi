import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { canConfirmFullReorganization, ControlledFavoriteLedgerPanel } from './ControlledFavoriteLedgerPanel'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('ControlledFavoriteLedgerPanel', () => {
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
    const summary = vi.fn().mockResolvedValue(null)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      getOldFavoriteWorkspaceRecoverySummaryV1: summary
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await Promise.resolve()
    expect(open).not.toHaveBeenCalled()
    expect(summary).not.toHaveBeenCalled()
  })

  it('opens a manifest-only recovery choice before loading any workspace segment', async () => {
    const open = vi.fn().mockResolvedValue(null)
    const summary = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
      recoveryChoices: ['view', 'continue-original']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      getOldFavoriteWorkspaceRecoverySummaryV1: summary,
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.assistant-action-button')[1]!)

    await waitFor(() => expect(summary).toHaveBeenCalledWith('100'))
    expect(open).not.toHaveBeenCalled()
  })

  it('rejects a full-reorganization confirmation once its account is no longer active', () => {
    expect(canConfirmFullReorganization('100', '100')).toBe(true)
    expect(canConfirmFullReorganization('100', '200')).toBe(false)
    expect(canConfirmFullReorganization('100', undefined)).toBe(false)
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
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(openFavoritePage).toHaveBeenCalledTimes(1))
  })

  it('coalesces repeated backup clicks while the first backup is still running', async () => {
    let resolveEnsure: ((result: { ok: boolean }) => void) | undefined
    const ensure = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveEnsure = resolve
    }))
    const openFavoritePage = vi.fn().mockResolvedValue({ ok: true })
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    const backup = screen.getByRole('button', { name: '备册' })
    fireEvent.click(backup)
    fireEvent.click(backup)

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(backup).toBeDisabled()

    resolveEnsure?.({ ok: true })
    await waitFor(() => expect(openFavoritePage).toHaveBeenCalledTimes(1))
  })

  it('does not open the Bilibili favorites page after a failed backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: false })
    const openFavoritePage = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
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
    expect(within(checklist as HTMLElement).getByRole('button', { name: '展开收藏夹' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '重置' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '全选' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '同步' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '知识学习' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '音乐' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()

    fireEvent.click(within(checklist as HTMLElement).getByRole('button', { name: '展开收藏夹' }))
    expect(within(checklist as HTMLElement).getByRole('button', { name: '收起收藏夹' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(checklist as HTMLElement).getByText('自定义收藏夹：点击收藏夹名称可以编辑。')).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByText('同步到 B 站：修改完成后点击“同步”。')).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByText('停止同步：取消勾选不会删除已有收藏夹。')).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByText(/分类依据：关键词、UP 名称和标签用于本地识别/)).toBeInTheDocument()
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
    const help = within(guide).getByRole('button', { name: '展开整理收藏' })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help).toHaveClass('favorite-ledger-panel__guide-title-toggle')
    expect(help.querySelector('.favorite-ledger-panel__chevron')).not.toBeNull()
    fireEvent.click(help)
    expect(within(guide).getByRole('button', { name: '收起整理收藏' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(guide).getByText('① 扫描概览：选择来源并等待标签补取；标签是分类的重要依据')).toBeInTheDocument()
    expect(within(guide).getByText('④ 确认执行：选择保存到收藏库或同步到 B 站，完成后点“好的”')).toBeInTheDocument()
  })

  it('keeps the legacy folder help arrow in the checklist title row', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const help = screen.getByRole('button', { name: /^(展开|收起)收藏夹$/ })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help.querySelector('.favorite-ledger-panel__chevron')).not.toBeNull()
    expect(help).toHaveTextContent('收藏夹')
  })

  it('remembers each explanation row after it is expanded', async () => {
    window.localStorage.clear()
    const ledgers = [{ id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], ruleType: 'keyword' as const, enabled: true, priority: 0, isDefault: true }]
    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={ledgers} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '展开收藏夹' }))
    expect(screen.getByRole('button', { name: '收起收藏夹' })).toHaveAttribute('aria-expanded', 'true')
    first.unmount()

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={ledgers} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    expect(screen.getByRole('button', { name: '收起收藏夹' })).toHaveAttribute('aria-expanded', 'true')

    window.localStorage.clear()
  })

  it('keeps full reorganization in the legacy resume dialog instead of the guide header', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await screen.findByRole('region', { name: '整理收藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))

    const resumeDialog = await screen.findByRole('dialog', { name: '整理收藏' })
    expect(within(resumeDialog).getByRole('button', { name: '继续上次整理' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '全部重新整理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '整理收藏向导' }).querySelector('.favorite-ledger-panel__guide-entry-actions')).toBeNull()
  })

  it('closes the guide when the user dismisses a resume decision', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))

    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
  })

  it('closes the guide when the user cancels a full reorganization reset', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '全部重新整理' }))
    const dialog = await screen.findByRole('alertdialog', { name: '确认全部重新整理？' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
  })

  it('closes the guide after abandoning the current preview round', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃本轮整理' }))

    await waitFor(() => expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument())
  })

  it('offers full reorganization for an interrupted remote execution after explaining its local-only reset', async () => {
    const executing = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'executing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }, executionProgress: { completedOperationCount: 1, totalOperationCount: 3 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(executing),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    const resumeDialog = await screen.findByRole('dialog', { name: '整理收藏' })
    expect(within(resumeDialog).getByRole('button', { name: '继续上次整理' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '全部重新整理' })).toBeInTheDocument()
    fireEvent.click(within(resumeDialog).getByRole('button', { name: '继续上次整理' }))
    expect(await screen.findByRole('progressbar', { name: '正在同步到 B 站' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '对账 B 站结果' })).not.toBeInTheDocument()
  })

  it('starts a clean full reorganization without a separate mirror checkbox', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({ ...preview, status: 'scanning' as const })
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: command } as unknown as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '全部重新整理' }))
    const dialog = await screen.findByRole('alertdialog', { name: '确认全部重新整理？' })
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '确认重置' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'full' }))
  })

  it('keeps editable rule types and safe reset synchronization in the legacy checklist', async () => {
    const save = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('combobox', { name: '收藏夹种类' }), { target: { value: 'author' } })
    expect(screen.getByLabelText('UP 名字')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    expect(save).toHaveBeenLastCalledWith(expect.any(Array), { deleteDisabled: false })

    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(screen.getByRole('dialog', { name: '重置收藏夹规则？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    expect(save).toHaveBeenLastCalledWith(expect.any(Array), { deleteDisabled: false })
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
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
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

  it('analyzes a normal ledger rule in the active workspace before saving the account configuration', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await waitFor(() => expect(window.bilimiDesktop?.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '旋律 节奏' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', expect.objectContaining({
      type: 'save-draft-ledger-rule', ledgerId: 'custom-music', title: '音乐', keywords: ['旋律', '节奏'], ruleType: 'keyword'
    })))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toHaveAttribute('aria-current', 'step')
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    await act(async () => analyzed.resolve(preview))
    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'custom-music', keywords: ['旋律', '节奏'] })
    ], { deleteDisabled: false }))
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

  it('persists deletion of a custom ledger through the normal local save path', () => {
    const save = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: false }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={save} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))

    expect(save).toHaveBeenCalledWith([], { deleteDisabled: false })
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

  it('waits for the initial authoritative workspace before choosing an organization action', async () => {
    let resolveOpen: ((value: typeof reconciling) => void) | undefined
    const reconciling = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'reconciling' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const open = vi.fn(() => new Promise<typeof reconciling>((resolve) => { resolveOpen = resolve }))
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))

    expect(await screen.findByText('尚未开始扫描，请点击“整理收藏”后扫描。')).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
    await act(async () => { resolveOpen?.(reconciling) })
    const resumeDialog = await screen.findByRole('dialog', { name: '整理收藏' })
    expect(within(resumeDialog).getByRole('button', { name: '全部重新整理' })).toBeEnabled()
    expect(command).not.toHaveBeenCalled()
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
    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()

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

    await screen.findByRole('region', { name: '整理收藏向导' })
    expect(screen.getByRole('navigation', { name: '整理收藏步骤' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('progressbar', { name: '收藏扫描进度' })).toHaveValue(0)
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
  })

  it('explicitly resumes the durable main-process scan lease for a persisted scanning workspace', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning),
      getOldFavoriteWorkspaceRecoverySummaryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'scanning', currentStep: 'scanning',
        plannedCount: 1, classifiedCount: 0, unclassifiedCount: 1,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: [], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
        recoveryChoices: ['view', 'continue-original', 'rescan']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '按原草稿继续' }))

    await waitFor(() => expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'resume-scan' }))
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

    fireEvent.click(await screen.findByRole('button', { name: '重建工作镜像并重新扫描' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'rebuild-corrupt-workspace' }))
    expect(command).toHaveBeenCalledTimes(1)
  })

  it('does not render a recovery acknowledgement as a scan snapshot before rescanning', async () => {
    const reportSnapshot = vi.fn()
    let resolveScan: (() => void) | undefined
    const command = vi.fn()
      .mockResolvedValueOnce({
        accountMid: '100', workspaceId: 'workspace-100', choice: 'rescan',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: false, requiresExplicitScan: true
      })
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveScan = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      getOldFavoriteWorkspaceRecoverySummaryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'draft', currentStep: 'draft',
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['view', 'rescan']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} onOrganizationSnapshotChange={reportSnapshot} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '重新扫描' }))

    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
    expect(command).toHaveBeenNthCalledWith(1, '100', expect.objectContaining({ type: 'select-recovery-decision', choice: 'rescan' }))
    expect(command).toHaveBeenNthCalledWith(2, '100', { type: 'start-scan', mode: 'incremental' })
    await waitFor(() => expect(reportSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({ choice: 'rescan' })))
    resolveScan?.()
  })

  it('shows an explicit recovery choice before loading an unfinished persisted workspace', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const recoverySummary = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 26, classifiedCount: 3, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
      recoveryChoices: ['view', 'continue-original', 'merge-latest', 'rescan', 'abandon']
    })
    const command = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      getOldFavoriteWorkspaceRecoverySummaryV1: recoverySummary,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    expect(await screen.findByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByText('本轮计划 26，已分类 3，未匹配 23。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放弃本轮整理' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '按原草稿继续' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'select-recovery-decision', workspaceId: 'workspace-100', choice: 'continue-original', expectedBaselineRevision: 1, expectedRepositoryRevision: 2
    }))
  })

  it.each([
    ['continue-original', '按原草稿继续'],
    ['merge-latest', '合并最新变化']
  ] as const)('keeps the recovery dialog open until %s loads the workspace without clearing the visible draft', async (choice, label) => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [], segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const loaded = deferred<typeof preview>()
    const open = vi.fn().mockResolvedValueOnce(preview).mockImplementationOnce(() => loaded.promise)
    const recoverySummary = {
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account' as const, workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced' as const, manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
      recoveryChoices: ['view', 'continue-original', 'merge-latest', 'rescan'] as const
    }
    const getRecoverySummary = vi.fn().mockResolvedValue(recoverySummary)
    const command = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', choice,
      manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled())

    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      getOldFavoriteWorkspaceRecoverySummaryV1: getRecoverySummary,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await screen.findByText('检测到未完成的整理草稿')
    fireEvent.click(await screen.findByRole('button', { name: label }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(screen.getByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在恢复整理草稿…')
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.queryByText('尚未开始扫描，请点击“整理收藏”后扫描。')).not.toBeInTheDocument()

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
    const open = vi.fn().mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error('reload failed'))
    const getRecoverySummary = vi.fn().mockResolvedValue({
      accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
      plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
      baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 2, changed: true, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: ['aid-revisions'] },
      recoveryChoices: ['view', 'continue-original']
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled())
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      getOldFavoriteWorkspaceRecoverySummaryV1: getRecoverySummary,
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', choice: 'continue-original',
        manualClassificationsRemainAuthoritative: true, requiresFullWorkspaceLoad: true, requiresExplicitScan: false
      })
    } as unknown as typeof window.bilimiDesktop

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '按原草稿继续' }))

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2))
    expect(screen.getByText('检测到未完成的整理草稿')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeEnabled()
    expect(screen.queryByText('尚未开始扫描，请点击“整理收藏”后扫描。')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按原草稿继续' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('恢复整理草稿失败，请重试。')
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
      recoveryChoices: readonly ['view', 'continue-original']
    }>()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      getOldFavoriteWorkspaceRecoverySummaryV1: vi.fn().mockReturnValue(summary.promise)
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
      recoveryChoices: ['view', 'continue-original']
    }))

    await waitFor(() => expect(screen.queryByText('检测到未完成的整理草稿')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '按原草稿继续' })).not.toBeInTheDocument()
  })

  it('does not apply a completed recovery decision after the active account changes', async () => {
    const decision = deferred<{
      accountMid: string
      workspaceId: string
      choice: 'continue-original'
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
      getOldFavoriteWorkspaceRecoverySummaryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        plannedCount: 25, classifiedCount: 2, unclassifiedCount: 23,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'unchanged', manualClassificationsRemainAuthoritative: true, changedDimensions: [] },
        recoveryChoices: ['view', 'continue-original']
      }),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '按原草稿继续' }))

    rerender(<ControlledFavoriteLedgerPanel currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    await act(async () => decision.resolve({
      accountMid: '100', workspaceId: 'workspace-100', choice: 'continue-original',
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
      getOldFavoriteWorkspaceRecoverySummaryV1: vi.fn().mockResolvedValue({
        accountMid: '100', workspaceId: 'workspace-100', status: 'previewing', currentStep: 'previewing',
        plannedCount: 1, classifiedCount: 0, unclassifiedCount: 1,
        baselineChangeEvidence: { scope: 'account', workspaceBaselineRevision: 1, repositoryRevision: 1, changed: false, direction: 'advanced', manualClassificationsRemainAuthoritative: true, changedDimensions: [], unavailableDimensions: ['rules', 'keywords', 'default-settings'] },
        recoveryChoices: ['view', 'abandon']
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

  it('locks the old favorite guide while a new scan replaces an existing preview', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 },
      sourceFolders: [{ id: 'source', title: 'Source', itemCount: 1, isBilimiWorkFolder: false, selected: true }], continuationCount: 0,
      segments: [{ id: 'segment-1', index: 0, status: 'previewing' as const, itemCount: 1 }],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: ['source'] }] }, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    let resolveScan: ((value: typeof preview) => void) | undefined
    const command = vi.fn(() => new Promise<typeof preview>((resolve) => { resolveScan = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await waitFor(() => expect(window.bilimiDesktop.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    await screen.findByRole('region', { name: '整理收藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    fireEvent.click(screen.getByRole('button', { name: '全部重新整理' }))
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }))

    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()

    await act(async () => { resolveScan?.(preview) })
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
    expect(await screen.findByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'bilimi 工作夹' })).getByText('Bilimi Inbox')).toBeInTheDocument()
  })

  it('shows normal source selection but keeps Bilimi work folders read-only', async () => {
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
    expect(within(screen.getByRole('table', { name: 'bilimi 工作夹' })).getByText('Bilimi Inbox')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '选择来源 Bilimi Inbox' })).not.toBeInTheDocument()
  })

  it('keeps the legacy scan source tables for user folders and read-only Bilimi work folders', async () => {
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

    const userTable = await screen.findByRole('table', { name: '用户收藏夹' })
    expect(within(userTable).getByRole('button', { name: '已选来源（2）' })).toBeInTheDocument()
    expect(within(userTable).getByRole('checkbox', { name: '选择来源 My source' })).toBeChecked()
    const bilimiTable = screen.getByRole('table', { name: 'bilimi 工作夹' })
    expect(within(bilimiTable).getByText('Bilimi Inbox')).toBeInTheDocument()
    expect(within(bilimiTable).getByText('7')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: '重建工作镜像并重新扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'rebuild-corrupt-workspace' }))
    first.unmount()

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    expect(await screen.findByText('扫描概览：扫描中')).toBeInTheDocument()
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
    const command = vi.fn()
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: open,
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    expect(command).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: '整理收藏' })).toBeInTheDocument()
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
      window.bilimiDesktop = {
        openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
        commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
      } as unknown as typeof window.bilimiDesktop

      render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
        onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

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

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '继续同步到 B 站' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(command).not.toHaveBeenCalled()
  })

  it('uses the controlled full-scan command only after the user explicitly requests full reorganization', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, history: { cursor: 0, length: 0 }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await screen.findByRole('region', { name: '整理收藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '全部重新整理' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认重置' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'full'
    }))
  })

  it('closes a full-reorganization confirmation when the active account changes', async () => {
    const command = vi.fn()
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '全部重新整理' }))
    expect(screen.getByRole('alertdialog', { name: '确认全部重新整理？' })).toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(screen.queryByRole('alertdialog', { name: '确认全部重新整理？' })).not.toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
  })

  it('collapses an expanded ledger list when the active account changes', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '展开' }))

    rerender(<ControlledFavoriteLedgerPanel {...props} currentAccountMid="200" />)

    expect(screen.getByRole('button', { name: '展开' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '收藏夹16' })).not.toBeInTheDocument()
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
    expect(screen.queryByText('扫描概览：扫描中')).not.toBeInTheDocument()
    expect(onTransientFeedback).toHaveBeenCalledWith('current Bilibili account is unavailable')

    fireEvent.click(screen.getByRole('button', { name: '重新扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
  })

  it('restarts a persisted failed incremental scan from the organize entry', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'incremental'
    }))
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

    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认当前 B站页面，请保持已登录的 B站页面打开后重新扫描')
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

    expect(await screen.findByRole('alert')).toHaveTextContent('B 站网络连接中断')
    expect(screen.queryByText('network-failure')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '本次直连后重新扫描' }))

    await waitFor(() => expect(retryDirect).toHaveBeenCalledOnce())
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' }))
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
    expect(screen.getByText('已获取标签 31 / 40 条')).toBeInTheDocument()
    expect(screen.getByText('9 条尚未取得标签')).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '扫描概览' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/标签补取\s*已暂停/)
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
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

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '继续上次整理' }))
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

    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取当前 B站页面，请保持已登录的 B站页面打开并等待页面加载完成后重新扫描')
    expect(screen.queryByText('page-execution-failed')).not.toBeInTheDocument()
  })

  it('keeps a failed Bilibili confirmation visible instead of making the action appear inert', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('本轮目标收藏夹尚未同步到 B 站')
  })

  it('backs up an unbound confirmation target before asking the main process to execute it', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    expect(await screen.findByRole('status')).toHaveTextContent('正在同步目标收藏夹')
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

    expect(await screen.findByText('扫描概览：扫描中')).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step'))
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeInTheDocument()
  })

  it('opens and locks the guide while a full scan replaces a stale preview', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    let resolveScan: ((value: typeof preview) => void) | undefined
    const command = vi.fn(() => new Promise<typeof preview>((resolve) => { resolveScan = resolve }))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    const fullReorganize = await screen.findByRole('button', { name: '全部重新整理' })
    fireEvent.click(fullReorganize)
    fireEvent.click(await screen.findByRole('button', { name: '确认重置' }))

    expect(screen.getByRole('region', { name: '整理收藏向导' })).toBeInTheDocument()
    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'full' }))

    await act(async () => { resolveScan?.(preview) })
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

    fireEvent.click(await screen.findByRole('button', { name: '整理收藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    expect(await screen.findByRole('region', { name: '归档预览' })).toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(await screen.findByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()
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
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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

    await screen.findByRole('button', { name: '归档预览' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    await screen.findByRole('region', { name: '归档预览' })
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '只整理【未匹配到合适分类】' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100', 'unclassified-only', 'current'))
    expect(screen.getByRole('status')).toHaveTextContent('DeepSeek 正在整理当前批次…')
    resolveDeepSeek?.({ snapshot: preview, referencedConstraintLedgerNames: ['bilimi·动画'], progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: [] })
    await screen.findByText('DeepSeek 整理完成，已更新当前批次。本次整理参考了 DeepSeek 约束收藏夹：bilimi·动画。')
    deepSeek.mockRejectedValueOnce(new Error('DeepSeek 服务暂时不可用'))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('DeepSeek 服务暂时不可用')
    deepSeek.mockRejectedValueOnce(new Error(
      "Error invoking remote method 'old-favorite-workspace-v1:deepseek-current-segment': DeepSeekServiceError: DeepSeek returned invalid JSON."
    ))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
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

  it('keeps the DeepSeek batch scope choices inside the organize-scope menu', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    expect(screen.getByRole('menuitemradio', { name: '当前批次' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: '本轮所有批次' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitemradio', { name: '当前批次' }))
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '本轮所有批次' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100', 'low-confidence-and-unclassified', 'all'))
    expect(onDeepSeekTaskStart).toHaveBeenCalledWith('收藏整理：本轮所有批次')
    expect(screen.getByRole('combobox', { name: '整理批次' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '扫描概览' })).toBeDisabled()
    resolveDeepSeek({
      snapshot: preview, referencedConstraintLedgerNames: [],
      progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: []
    })
    await waitFor(() => expect(finishDeepSeekTask).toHaveBeenCalledOnce())
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
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'C' }))

    expect(screen.getByRole('checkbox', { name: 'A' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'B' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'C' })).toBeChecked()
  })

  it('projects selected recommendation drafts into the visible folder list without waiting for preferences', async () => {
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

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }))

    expect(await screen.findByRole('button', { name: 'A' })).toBeInTheDocument()
  })

  it('removes a deselected recommendation draft from the visible folder list without waiting for preferences', async () => {
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
      priority: 10_000, syncState: 'local-draft', isDefault: false
    }]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    const checkbox = await screen.findByRole('checkbox', { name: 'A', checked: true })
    fireEvent.click(checkbox)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument())
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

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
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
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const, readiness: 'tagging' as const, completedTagItemCount: 0, pendingTagItemCount: 1 }
      ],
      currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-low' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

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
    expect(screen.getByRole('option', { name: '第 1/2 批 · 51 条 · 可整理' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '第 2/2 批 · 1 条 · 补取中' })).toBeInTheDocument()
    fireEvent.change(selector, { target: { value: 'segment-2' } })
    await waitFor(() => expect(window.bilimiDesktop?.commandOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100', {
      type: 'select-segment', segmentId: 'segment-2'
    }))
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
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

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))

    expect(screen.queryByRole('combobox', { name: '整理批次' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '转移 One' })).toBeInTheDocument()
  })

  it('uses the snapshot-wide readiness to block confirmation until every segment is classified', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const }
      ],
      currentSegment: { id: 'segment-1', aids: [1], items: [{ aid: 1, sourceFolderIds: [] }] },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'manual' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] },
      planReadiness: { selectedAidCount: 2, classifiedAidCount: 1, unclassifiedAidCount: 1 },
      history: { cursor: 1, length: 1 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as unknown as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByText('整体准备度：1 / 2 条已分类')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 条未分类视频会仅本地暂存')
    expect(screen.getByRole('button', { name: '保存当前批到收藏库' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
  })

  it('freezes a saved batch action and enables Bilibili sync only after every batch is saved', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByRole('button', { name: '当前批已保存' })).toBeDisabled()
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
    fireEvent.click(await screen.findByRole('button', { name: '对账 B 站结果' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'reconcile-frozen-bilibili-plan' }))
    expect(await screen.findByRole('status')).toHaveTextContent('本轮已完成同步到 B 站')
    expect(screen.queryByRole('button', { name: '确认并同步到 B 站' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '好的' }))
    expect(acknowledgeCompletion).toHaveBeenCalledWith('100', 'workspace-100')
    expect(screen.queryByRole('region', { name: '整理收藏向导' })).not.toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '对账 B 站结果' }))
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

      await screen.findByRole('region', { name: '整理收藏向导' })
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
      segments: [{ id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const }],
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

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
  })
})
