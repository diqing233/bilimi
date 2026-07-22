import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'

describe('FavoriteLedgerOverview', () => {
  it('uses one bulk toggle that selects and clears the currently operable ledgers', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true },
      { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const toggle = screen.getByTestId('favorite-ledger-cancel-all')
    expect(toggle).toHaveTextContent('全选')
    fireEvent.click(toggle)
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: true })
    ]), { deleteDisabled: false })

    expect(screen.getByTestId('favorite-ledger-cancel-all')).toHaveTextContent('取消全选')
    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: false }),
      expect.objectContaining({ id: 'custom-tech', enabled: false })
    ]), { deleteDisabled: false })
  })

  it('keeps required defaults selected when cancel-all clears custom targets during a round', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
        { id: 'inbox', displayName: 'bilimi·暂存', keywords: [], enabled: true, priority: 20, isDefault: true },
        { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', enabled: true }),
      expect.objectContaining({ id: 'inbox', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: false })
    ]), { deleteDisabled: false })
    expect(screen.getByRole('button', { name: '移出同步 bilimi·暂存' })).toBeDisabled()
  })

  it('shows disabled and unsaved state in the ledger name while retaining a disabled plus action', () => {
    render(<FavoriteLedgerOverview
      defaultFavoriteSystemEnabled={false}
      ledgers={[{ id: 'knowledge', displayName: 'bilimi·知识学习', keywords: [], enabled: true, priority: 10, isDefault: true }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '（已停用）知识学习' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出同步 bilimi·知识学习' })).toHaveTextContent('+')
    expect(screen.getByRole('button', { name: '移出同步 bilimi·知识学习' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    expect(screen.getByRole('button', { name: /^（未保存）/ })).toBeInTheDocument()
  })

  it('does not add a pending-sync label to a local recommendation', () => {
    render(<FavoriteLedgerOverview
      ledgers={[{ id: 'recommended-up', displayName: 'bilimi·影视飓风', keywords: ['影视飓风'], enabled: true, priority: 10, isDefault: false, syncState: 'local-draft' }]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '影视飓风' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '（待同步）影视飓风' })).not.toBeInTheDocument()
  })

  it('keeps an edited ledger marked as unsaved after selecting another ledger', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 20, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '音乐' }))
    fireEvent.change(screen.getByRole('textbox', { name: '关键词' }), { target: { value: '摇滚' } })
    fireEvent.click(screen.getByRole('button', { name: '知识' }))

    expect(screen.getByRole('button', { name: '（未保存）音乐' })).toBeInTheDocument()
    expect(screen.getByText('正在编辑：bilimi·知识')).toBeInTheDocument()
  })

  it('keeps a new unsaved ledger open when an equivalent ledger snapshot rerenders', () => {
    const ledgers = [{ id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }]
    const view = render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '新建收藏夹' }))
    fireEvent.change(screen.getByRole('textbox', { name: '册名' }), { target: { value: '临时草稿' } })
    view.rerender(<FavoriteLedgerOverview ledgers={ledgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))}
      missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.getByRole('button', { name: '（未保存）临时草稿' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toHaveTextContent('新建收藏夹bilimi·临时草稿')
  })

  it('collapses the editor when the active ledger card is selected again', () => {
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: true, priority: 10, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    const card = screen.getByRole('button', { name: '音乐' })
    fireEvent.click(card)
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
    fireEvent.click(card)
    expect(screen.queryByRole('region', { name: '当前收藏夹' })).not.toBeInTheDocument()
    fireEvent.click(card)
    expect(screen.getByRole('region', { name: '当前收藏夹' })).toBeInTheDocument()
  })

  it('persists a cross-row drag reorder as soon as the item is dropped', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'first', displayName: 'First', keywords: [], enabled: true, priority: 10, isDefault: false },
      { id: 'second', displayName: 'Second', keywords: [], enabled: true, priority: 20, isDefault: false },
      { id: 'third', displayName: 'Third', keywords: [], enabled: true, priority: 30, isDefault: false },
      { id: 'fourth', displayName: 'Fourth', keywords: [], enabled: true, priority: 40, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'first') }
    const fourthChip = screen.getByTestId('favorite-ledger-chip-fourth')
    fireEvent.dragStart(screen.getByTestId('favorite-ledger-chip-first'), { dataTransfer: transfer })
    fireEvent.dragOver(fourthChip, { dataTransfer: transfer, clientY: 36 })
    expect(fourthChip).toHaveAttribute('data-drop-position', 'before')
    fireEvent.drop(fourthChip, { dataTransfer: transfer })
    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'second', priority: 10 }),
      expect.objectContaining({ id: 'third', priority: 20 }),
      expect.objectContaining({ id: 'fourth', priority: 30 }),
      expect.objectContaining({ id: 'first', priority: 40 })
    ], { deleteDisabled: false })
    expect(Array.from(screen.getByRole('region', { name: '收藏夹' })
      .querySelectorAll('.favorite-ledger-panel__chip-item > button:first-child'))
      .map((button) => button.textContent)).toEqual(['Second', 'Third', 'Fourth', 'First'])
    expect(fourthChip).not.toHaveAttribute('data-drop-position')
    fireEvent.dragEnd(screen.getByTestId('favorite-ledger-chip-first'))
    expect(screen.getByTestId('favorite-ledger-chip-first')).not.toHaveAttribute('data-dragging')
  })

  it('checks managed deletion candidates from 同步 instead of rendering a separate check action', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const previewManagedFavoriteFolderDeletion = vi.fn().mockResolvedValue([
      { logicalLedgerId: 'music', remoteFolderId: 'remote-music', title: 'bilimi·音乐', memberCount: 3 }
    ])
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        readBilibiliAccountMid: vi.fn().mockResolvedValue('100'),
        previewManagedFavoriteFolderDeletion
      }
    })
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'music', displayName: 'bilimi·音乐', keywords: [], enabled: false, priority: 10, isDefault: true }
    ]} missingLedgerIds={[]} onSaveLedgers={vi.fn()} onSyncLedgers={sync} />)

    expect(screen.queryByRole('button', { name: '检查待删除收藏夹' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))

    expect(await screen.findByText('本次同步有 1 个 bilimi 管理的收藏夹需要删除。')).toBeInTheDocument()
    expect(previewManagedFavoriteFolderDeletion).toHaveBeenCalledWith('100', ['music'])
    expect(sync).not.toHaveBeenCalled()
  })

  it('uses the restored cancel-all action to clear the current selection', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: true, priority: 10, isDefault: true },
        { id: 'reading', displayName: 'bilimi:阅读', keywords: ['阅读'], ruleType: 'keyword', enabled: true, priority: 20, isDefault: true }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByRole('button', { name: '取消全选' }))
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'music', enabled: false }),
      expect.objectContaining({ id: 'reading', enabled: false })
    ]), { deleteDisabled: false })
  })

  it('keeps the legacy collapsed ledger list and its expand toggle', () => {
    const ledgers = Array.from({ length: 16 }, (_, index) => ({
      id: `ledger-${index + 1}`,
      displayName: `bilimi:收藏夹${index + 1}`,
      keywords: [],
      ruleType: 'keyword' as const,
      enabled: true,
      priority: (index + 1) * 10,
      isDefault: false
    }))
    render(<FavoriteLedgerOverview ledgers={ledgers} missingLedgerIds={[]} onSaveLedgers={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '收藏夹16' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开' }))
    expect(screen.getByRole('button', { name: '收藏夹16' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠' })).toBeInTheDocument()
  })
})
