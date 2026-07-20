import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlledFavoriteLedgerPanel } from './ControlledFavoriteLedgerPanel'

describe('ControlledFavoriteLedgerPanel', () => {
  it('keeps the default ledger closed behind separate Chinese organize and library entries', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[{ id: 'knowledge', displayName: 'bilimi:知识学习', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    expect(await screen.findByRole('button', { name: '整理旧藏' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收藏库' })).toBeInTheDocument()
    expect(screen.queryByText('bilimi:知识学习')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '整理旧藏向导' })).not.toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('button', { name: '扫描概览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()

    await act(async () => { resolveScan?.(scanningSnapshot) })
  })

  it('locks the old favorite guide while a new scan replaces an existing preview', async () => {
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await waitFor(() => expect(window.bilimiDesktop.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100"
      ledgers={[]}
      missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()}
      onSaveLedgers={vi.fn()}
    />)

    const organize = screen.getByRole('button', { name: '整理旧藏' })
    await waitFor(() => expect(organize).toBeEnabled())
    fireEvent.click(organize)

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'incremental'
    }))
    expect(await screen.findByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(screen.getByText('Bilimi Inbox · 0 条 · Bilimi 工作夹')).toBeInTheDocument()
  })

  it('uses the controlled full-scan command only after the user explicitly requests full reorganization', async () => {
    const command = vi.fn().mockResolvedValue({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'full' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, history: { cursor: 0, length: 0 }
    })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await waitFor(() => expect(screen.getByRole('button', { name: '全部重新整理' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '全部重新整理' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'full'
    }))
  })

  it('shows a retryable scan-start failure when the controlled start command is rejected', async () => {
    const command = vi.fn().mockRejectedValue(new Error('unavailable'))
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('扫描启动失败')
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    expect(screen.queryByText('扫描概览：扫描中')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新扫描' }))
    await waitFor(() => expect(command).toHaveBeenCalledTimes(2))
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
    } as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    const fullReorganize = await screen.findByRole('button', { name: '全部重新整理' })
    await waitFor(() => expect(fullReorganize).toBeEnabled())
    fireEvent.click(fullReorganize)

    expect(screen.getByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    expect(screen.getByRole('region', { name: '归档预览' })).toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(await screen.findByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.getByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
  })

  it('creates a local workspace ledger through the controlled command instead of saving Bilibili rules', async () => {
    const command = vi.fn().mockResolvedValue({
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    })
    const save = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command
    } as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={save}
    />)

    fireEvent.change(screen.getByRole('textbox', { name: '新增收藏夹名称' }), { target: { value: '音乐' } })
    fireEvent.click(screen.getByRole('button', { name: '新增并重新归类' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'create-local-ledger-and-reclassify', title: '音乐'
    }))
    expect(save).not.toHaveBeenCalled()
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
    const deepSeek = vi.fn().mockResolvedValue(preview)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command,
      organizeOldFavoriteWorkspaceDeepSeekV1: deepSeek
    } as typeof window.bilimiDesktop

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

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
    expect(await screen.findByText('扫描概览已完成，正在准备归档预览。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'bilimi·UP' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '自动分类' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'auto-classify-current-segment' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100'))
    fireEvent.change(screen.getByRole('combobox', { name: '归类 Alpha' }), { target: { value: 'knowledge' } })
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    }))
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'confirm-and-execute-bilibili-plan'
    }))
    expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] })
    expect(command).toHaveBeenCalledWith('100', { type: 'auto-classify-current-segment' })
    expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })
    expect(deepSeek).toHaveBeenCalledWith('100')
  })
})
