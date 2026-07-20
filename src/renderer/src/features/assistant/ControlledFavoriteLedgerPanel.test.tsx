import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ControlledFavoriteLedgerPanel } from './ControlledFavoriteLedgerPanel'

describe('ControlledFavoriteLedgerPanel', () => {
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

  it('adds a local ledger before the workspace reclassifies the current segment', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null) } as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={save}
    />)

    fireEvent.change(screen.getByRole('textbox', { name: '新增收藏夹名称' }), { target: { value: '音乐' } })
    fireEvent.click(screen.getByRole('button', { name: '新增并重新归类' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'local-音乐', displayName: 'bilimi·音乐', enabled: true })
    ]))
  })
})
