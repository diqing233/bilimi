import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'

describe('FavoriteLedgerOverview', () => {
  it('keeps required defaults selected when cancel-all clears custom targets during a round', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      organizationActive
      ledgers={[
        { id: 'knowledge', displayName: 'bilimi·知识', keywords: [], enabled: true, priority: 10, isDefault: true },
        { id: 'custom-tech', displayName: '科技', keywords: [], enabled: true, priority: 20, isDefault: false }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={save}
    />)

    fireEvent.click(screen.getByTestId('favorite-ledger-cancel-all'))
    expect(save).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge', enabled: true }),
      expect.objectContaining({ id: 'custom-tech', enabled: false })
    ]), { deleteDisabled: false })
  })

  it('persists sequential priorities after native drag drop', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview ledgers={[
      { id: 'first', displayName: 'First', keywords: [], enabled: true, priority: 90, isDefault: false },
      { id: 'second', displayName: 'Second', keywords: [], enabled: true, priority: 40, isDefault: false }
    ]} missingLedgerIds={[]} onSaveLedgers={save} />)

    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'first') }
    fireEvent.dragStart(screen.getByTestId('favorite-ledger-chip-first'), { dataTransfer: transfer })
    fireEvent.drop(screen.getByTestId('favorite-ledger-chip-second'), { dataTransfer: transfer })
    expect(save).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'second', priority: 10 }),
      expect.objectContaining({ id: 'first', priority: 20 })
    ], { deleteDisabled: false })
  })

  it('uses the restored cancel-all action to clear the current selection', () => {
    const save = vi.fn()
    render(<FavoriteLedgerOverview
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: false, priority: 10, isDefault: true },
        { id: 'reading', displayName: 'bilimi:阅读', keywords: ['阅读'], ruleType: 'keyword', enabled: false, priority: 20, isDefault: true }
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
