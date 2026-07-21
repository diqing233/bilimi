import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { canConfirmFullReorganization, ControlledFavoriteLedgerPanel } from './ControlledFavoriteLedgerPanel'

describe('ControlledFavoriteLedgerPanel', () => {
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
      .toEqual(['备册', '整理旧藏', '收藏库'])
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

  it('does not open the Bilibili favorites page after a failed backup action', async () => {
    const ensure = vi.fn().mockResolvedValue({ ok: false })
    const openFavoritePage = vi.fn()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={ensure} onSaveLedgers={vi.fn()} onOpenFavoritePage={openFavoritePage} />)

    fireEvent.click(screen.getByRole('button', { name: '备册' }))

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1))
    expect(openFavoritePage).not.toHaveBeenCalled()
  })
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

  it('keeps the ledger overview, organize entry, and library entry in a stable order', async () => {
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: vi.fn(),
      openFavoriteLibrary: vi.fn()
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('heading', { name: '收藏夹' }).closest('.favorite-ledger-panel__ledger-list')).not.toBeNull()
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
    expect(within(checklist as HTMLElement).getByRole('button', { name: '展开收藏夹说明' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '重置' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '全选' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '同步' })).toBeInTheDocument()
    expect(within(checklist as HTMLElement).getByRole('button', { name: '知识学习' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '音乐' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(checklist as HTMLElement).getByRole('button', { name: '新建收藏夹' })).toBeInTheDocument()

    fireEvent.click(within(checklist as HTMLElement).getByRole('button', { name: '展开收藏夹说明' }))
    expect(within(checklist as HTMLElement).getByRole('button', { name: '收起收藏夹说明' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(checklist as HTMLElement).getByText(/自定义你的 bilimi 收藏夹/)).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    const guide = await screen.findByRole('region', { name: '整理旧藏向导' })
    const help = within(guide).getByRole('button', { name: '展开整理旧藏说明' })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help.querySelector('.favorite-ledger-panel__help-arrows')).not.toBeNull()
    fireEvent.click(help)
    expect(within(guide).getByRole('button', { name: '收起整理旧藏说明' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the legacy folder help arrow in the checklist title row', () => {
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const help = screen.getByRole('button', { name: '展开收藏夹说明' })
    expect(help).toHaveClass('favorite-ledger-panel__help-toggle')
    expect(help.querySelector('.favorite-ledger-panel__help-arrows')).not.toBeNull()
    expect(help).toHaveTextContent('')
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    const resumeDialog = await screen.findByRole('dialog', { name: '整理旧藏' })
    expect(within(resumeDialog).getByRole('button', { name: '继续上次整理' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '全部重新整理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '整理旧藏向导' }).querySelector('.favorite-ledger-panel__guide-entry-actions')).toBeNull()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    const resumeDialog = await screen.findByRole('dialog', { name: '整理旧藏' })
    expect(within(resumeDialog).getByRole('button', { name: '继续上次整理' })).toBeInTheDocument()
    expect(within(resumeDialog).getByRole('button', { name: '全部重新整理' })).toBeInTheDocument()
    fireEvent.click(within(resumeDialog).getByRole('button', { name: '继续上次整理' }))
    expect(await screen.findByRole('button', { name: '对账 B 站结果' })).toBeEnabled()
  })

  it('starts a clean full reorganization without a separate mirror checkbox', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue({ ...preview, status: 'scanning' as const })
    window.bilimiDesktop = { openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
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
    expect(screen.getByText(/未保存/)).toBeInTheDocument()
  })

  it('opens the full legacy editor only from new ledger, validates names, and saves a normal local draft without reclassifying', () => {
    const save = vi.fn()
    const command = vi.fn()
    window.bilimiDesktop = { commandOldFavoriteWorkspaceV1: command } as typeof window.bilimiDesktop
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    const organizeEntry = await screen.findByRole('button', { name: '整理旧藏' })
    const libraryEntry = screen.getByRole('button', { name: '收藏库' })
    expect(organizeEntry.closest('.favorite-ledger-panel__toolbar')).toBeTruthy()
    expect(libraryEntry.closest('.favorite-ledger-panel__toolbar')).toBe(organizeEntry.closest('.favorite-ledger-panel__toolbar'))

    fireEvent.click(screen.getByRole('button', { name: '收藏库' }))
    expect(openFavoriteLibrary).toHaveBeenCalledTimes(1)
    expect(command).not.toHaveBeenCalled()
  })

  it('opens the organize guide without changing the independent library entry', async () => {
    const command = vi.fn()
    const openFavoriteLibrary = vi.fn().mockResolvedValue(undefined)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(null),
      commandOldFavoriteWorkspaceV1: command,
      openFavoriteLibrary
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))

    expect(await screen.findByText('扫描概览：扫描中')).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
    await act(async () => { resolveOpen?.(reconciling) })
    const resumeDialog = await screen.findByRole('dialog', { name: '整理旧藏' })
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(screen.getByRole('navigation', { name: '整理旧藏步骤' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('progressbar', { name: '旧藏扫描进度' })).toHaveValue(0)
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
  })

  it('re-engages the main-process scan service for a persisted scanning workspace', async () => {
    const scanning = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'scanning' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'inventory' as const, failureCount: 0 }, sourceFolders: [], continuationCount: 0,
      segments: [], currentSegment: null, classifications: {}, recommendations: { candidates: [], adoptedCandidateIds: [] },
      history: { cursor: 0, length: 0 }
    }
    const command = vi.fn().mockResolvedValue(scanning)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(scanning), commandOldFavoriteWorkspaceV1: command
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'start-scan', mode: 'incremental' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await waitFor(() => expect(window.bilimiDesktop.openOldFavoriteWorkspaceV1).toHaveBeenCalledWith('100'))
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    const userTable = await screen.findByRole('table', { name: '用户收藏夹' })
    expect(within(userTable).getByRole('columnheader', { name: '本轮待整理' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

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

  it('restores a persisted preview on remount without starting another scan', async () => {
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
    } as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '归档预览' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '归档预览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('heading', { name: '归档预览' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
    expect(command).not.toHaveBeenCalled()
    expect(await screen.findByRole('dialog', { name: '整理旧藏' })).toBeInTheDocument()
  })

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
    } as typeof window.bilimiDesktop

    const first = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '继续同步到 B 站' })).toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()

    first.unmount()
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    expect(await screen.findByRole('region', { name: '整理旧藏向导' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    await screen.findByRole('region', { name: '整理旧藏向导' })
    fireEvent.click(screen.getByRole('button', { name: '整理旧藏' }))
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
    } as typeof window.bilimiDesktop

    const { rerender } = render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
    fireEvent.click(await screen.findByRole('button', { name: '全部重新整理' }))
    expect(screen.getByRole('alertdialog', { name: '确认全部重新整理？' })).toBeInTheDocument()

    rerender(<ControlledFavoriteLedgerPanel
      currentAccountMid="200" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    expect(screen.queryByRole('alertdialog', { name: '确认全部重新整理？' })).not.toBeInTheDocument()
    expect(command).not.toHaveBeenCalled()
  })

  it('shows a retryable scan-start failure when the controlled start command is rejected', async () => {
    const command = vi.fn().mockRejectedValue(new Error('current Bilibili account is unavailable'))
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
    expect(screen.getByRole('alert')).toHaveTextContent('current Bilibili account is unavailable')
    expect(screen.getByRole('button', { name: '重新扫描' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '推荐收藏夹' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '归档预览' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '确认执行' })).toBeDisabled()
    expect(screen.queryByText('扫描概览：扫描中')).not.toBeInTheDocument()

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

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
    } as typeof window.bilimiDesktop

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    expect((await screen.findAllByLabelText('旧藏扫描进度')).find((element) => element.tagName === 'PROGRESS')).toHaveAttribute('value', '40')
    expect(screen.getByText('40 / 243 条')).toBeInTheDocument()
    expect(screen.getByText('标签识别 31 / 40 条')).toBeInTheDocument()
    expect(screen.getByText('9 条未识别标签')).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))
    fireEvent.click(screen.getByRole('button', { name: '确认并同步到 B 站' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认当前 B 站页面')
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

  it('moves an open preview guide to confirmation when the persisted workspace freezes', async () => {
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
    const command = vi.fn().mockResolvedValue(frozen)
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: command
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '确认执行' })).toHaveAttribute('aria-current', 'step'))
    expect(screen.getByRole('button', { name: '继续同步到 B 站' })).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))
    const fullReorganize = await screen.findByRole('button', { name: '全部重新整理' })
    fireEvent.click(fullReorganize)
    fireEvent.click(await screen.findByRole('button', { name: '确认重置' }))

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

    await screen.findByRole('button', { name: '归档预览' })
    fireEvent.click(screen.getByRole('button', { name: '推荐收藏夹' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'UP' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'set-recommended-candidates', candidateIds: ['custom-author-up'] }))
    fireEvent.click(screen.getByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: '整理范围' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '只整理【未匹配到合适分类】' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    await waitFor(() => expect(deepSeek).toHaveBeenCalledWith('100', 'unclassified-only'))
    expect(screen.getByRole('status')).toHaveTextContent('DeepSeek 正在整理当前分段…')
    resolveDeepSeek?.({ snapshot: preview, referencedConstraintLedgerNames: ['bilimi·动画'], progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: [] })
    await screen.findByText('DeepSeek 整理完成，已更新当前分段。本次整理参考了 DeepSeek 约束收藏夹：bilimi·动画。')
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
    expect(command).toHaveBeenCalledWith('100', {
      type: 'apply-classifications', source: 'manual', assignments: [{ aid: 1, targetLedgerIds: ['knowledge'] }]
    })
    expect(deepSeek).toHaveBeenCalledWith('100', 'unclassified-only')
  })

  it('renders UP and tag recommendation cards and restores whole-round choices across segments and remounts', async () => {
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 1, hasMultipleSegments: true,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0,
      sourceFolders: [],
      segments: [
        { id: 'segment-1', index: 0, itemCount: 1, status: 'previewing' as const },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const }
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
    } as typeof window.bilimiDesktop

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
    fireEvent.click(screen.getByRole('button', { name: '第 2 组' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel
      currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()}
    />)

    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByText('本轮没有足够重复的 UP 或标签，暂不生成推荐收藏夹。')).toBeInTheDocument()
  })

  it('shows only the first six tag recommendations until the legacy expand action is chosen', async () => {
    const tagCandidates = Array.from({ length: 7 }, (_, index) => ({
      id: `tag-${index + 1}`, displayName: `bilimi·标签${index + 1}`, kind: 'tag' as const,
      count: 7 - index, reason: `高频标签 ${index + 1}`
    }))
    const preview = {
      version: 1 as const, accountMid: '100', workspaceId: 'workspace-100', status: 'previewing' as const,
      mode: 'incremental' as const, segmentSize: 2000, hasMultipleSegments: false,
      scan: { phase: 'complete' as const, failureCount: 0 }, continuationCount: 0, sourceFolders: [],
      segments: [], currentSegment: null, classifications: {},
      recommendations: { candidates: tagCandidates, adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview), commandOldFavoriteWorkspaceV1: vi.fn()
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '推荐收藏夹' }))
    expect(screen.getByRole('checkbox', { name: '标签6' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '标签7' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开更多高频标签' }))
    expect(screen.getByRole('checkbox', { name: '标签7' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[
      { id: 'knowledge', displayName: '知识学习', keywords: [], enabled: true, priority: 0, isDefault: true },
      { id: 'music', displayName: '音乐', keywords: [], enabled: true, priority: 1, isDefault: true }
    ]} missingLedgerIds={[]} onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    expect(screen.getByText('Pending 6')).toBeInTheDocument()
    expect(screen.queryByText('Pending 7')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '显示全部 9 条' }))
    expect(screen.getByText('Pending 9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全部存入暂存' }))
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
      failures: [{ chunkIndex: 2, aids: [1], affectedVideoCount: 1, message: '请求过于频繁' }]
    }
    const organize = vi.fn().mockResolvedValue(partial)
    const retry = vi.fn().mockResolvedValue({ ...partial, progress: { totalChunks: 1, completedChunks: 1, successfulVideoCount: 1, failedVideoCount: 0 }, failures: [] })
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      organizeOldFavoriteWorkspaceDeepSeekV1: organize,
      retryOldFavoriteWorkspaceDeepSeekV1: retry
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} deepSeekArchiveAvailable />)

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek 整理' }))
    expect(await screen.findByText(/已处理 20 条；1 条未应用/)).toBeInTheDocument()
    expect(screen.getByText('第 2 批：请求过于频繁')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试失败批次' }))
    await waitFor(() => expect(retry).toHaveBeenCalledWith('100'))
  })
  it('renders source, classification provenance, and a virtualized multi-segment archive preview', async () => {
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
        { id: 'segment-1', index: 0, itemCount: 51, status: 'previewing' as const },
        { id: 'segment-2', index: 1, itemCount: 1, status: 'previewing' as const }
      ],
      currentSegment: { id: 'segment-1', aids: items.map((item) => item.aid), items },
      classifications: { '1': { aid: 1, targetLedgerIds: ['music'], source: 'system-low' as const } },
      recommendations: { candidates: [], adoptedCandidateIds: [] }, history: { cursor: 0, length: 0 }
    }
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview)
    } as typeof window.bilimiDesktop

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
    expect(screen.getByText('分类来源：低置信度自动分类')).toBeInTheDocument()
    expect(screen.getByText('目标收藏夹：Music')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '整理分段' })).toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '归档预览' }))

    expect(screen.queryByRole('group', { name: '整理分段' })).not.toBeInTheDocument()
    expect(screen.getAllByText('未分类')).not.toHaveLength(0)
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByText('整体准备度：1 / 2 条已分类')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 条未分类视频会仅本地暂存')
    expect(screen.getByRole('button', { name: '仅保存本轮到收藏库' })).toBeEnabled()
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
    } as typeof window.bilimiDesktop

    const rendered = render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '继续同步到 B 站' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'execute-frozen-bilibili-plan' }))
    expect(screen.getByRole('progressbar', { name: '正在同步到 B 站' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续同步到 B 站' })).not.toBeInTheDocument()

    rendered.unmount()
    persisted = reconciling
    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: '对账 B 站结果' }))
    await waitFor(() => expect(command).toHaveBeenCalledWith('100', { type: 'reconcile-frozen-bilibili-plan' }))
    expect(await screen.findByRole('status')).toHaveTextContent('本轮已完成同步到 B 站')
    expect(screen.queryByRole('button', { name: '确认并同步到 B 站' })).not.toBeInTheDocument()
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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '整理旧藏' }))

    await waitFor(() => expect(command).toHaveBeenCalledWith('100', {
      type: 'start-scan', mode: 'incremental'
    }))
  })

  it('keeps scan overview selected when a background refresh reports scan completion', async () => {
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
    let persisted = scanning
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockImplementation(() => Promise.resolve(persisted)),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    await screen.findByRole('region', { name: '整理旧藏向导' })
    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    persisted = previewing
    await waitFor(() => expect(screen.getByRole('button', { name: '归档预览' })).toBeEnabled(), { timeout: 1500 })

    expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('region', { name: '扫描概览' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
  })

  it('locks source selection after classifications have been persisted', async () => {
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
    window.bilimiDesktop = {
      openOldFavoriteWorkspaceV1: vi.fn().mockResolvedValue(preview),
      commandOldFavoriteWorkspaceV1: vi.fn()
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '扫描概览' }))
    expect(screen.getByRole('checkbox', { name: '选择来源 Source' })).toBeDisabled()
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
    } as typeof window.bilimiDesktop

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
    } as typeof window.bilimiDesktop

    render(<ControlledFavoriteLedgerPanel currentAccountMid="100" ledgers={[]} missingLedgerIds={[]}
      onEnsureLedgers={vi.fn()} onSaveLedgers={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: '确认执行' }))

    expect(screen.getByRole('button', { name: '确认并同步到 B 站' })).toBeDisabled()
  })
})
