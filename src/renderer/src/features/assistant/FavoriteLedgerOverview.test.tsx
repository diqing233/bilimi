import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLedgerOverview } from './FavoriteLedgerOverview'

describe('FavoriteLedgerOverview', () => {
  it('uses the legacy all-select toggle wording as its enabled state changes', () => {
    render(<FavoriteLedgerOverview
      ledgers={[
        { id: 'music', displayName: 'bilimi:音乐', keywords: ['音乐'], ruleType: 'keyword', enabled: false, priority: 10, isDefault: true },
        { id: 'reading', displayName: 'bilimi:阅读', keywords: ['阅读'], ruleType: 'keyword', enabled: false, priority: 20, isDefault: true }
      ]}
      missingLedgerIds={[]}
      onSaveLedgers={vi.fn()}
    />)

    const selectAll = screen.getByRole('button', { name: '全选' })
    fireEvent.click(selectAll)

    expect(screen.getByRole('button', { name: '全不选' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '全不选' }))
    expect(screen.getByRole('button', { name: '全选' })).toBeInTheDocument()
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
