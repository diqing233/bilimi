import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'

describe('OldFavoritePreviewCard', () => {
  it('keeps the legacy static preview-video layer inside its article shell', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Legacy preview', author: 'Uploader', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    const article = screen.getByRole('article')
    expect(article).not.toHaveClass('favorite-ledger-panel__preview-item-shell')
    expect(article).not.toHaveClass('favorite-ledger-panel__preview-video')
    expect(article).toHaveAttribute('data-selected', 'true')
    expect(article.querySelector('.favorite-ledger-panel__preview-video--pending')).not.toHaveAttribute('data-selected')
  })

  it('uses one on-demand portal tooltip for complete title, source, and tag text and closes it with Escape', () => {
    const { container } = render(<OldFavoritePreviewCard
      item={{
        aid: 1,
        title: 'A complete long video title',
        tags: ['TypeScript', 'Frontend'],
        sourceFolderIds: ['source']
      }}
      sourceFolderTitles={['A complete source folder name']}
      ledgers={[]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    fireEvent.mouseEnter(screen.getByRole('link', { name: 'A complete long video title' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('A complete long video title')
    expect(container.querySelector('[role="tooltip"]')).toBeNull()

    const source = screen.getByText('来源：A complete source folder name')
    fireEvent.mouseLeave(screen.getByRole('link', { name: 'A complete long video title' }))
    fireEvent.focus(source)
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('来源：A complete source folder name')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows scanned Bilibili tags from the authoritative workspace item', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Tagged video', tags: ['TypeScript', 'Frontend'], sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      ledgers={[]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    expect(screen.getByText('标签：TypeScript、Frontend')).toBeInTheDocument()
  })

  it('keeps only the compact transfer trigger below the legacy card metadata', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Manual move', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    const article = screen.getByRole('article')
    expect(screen.getByRole('button', { name: '转移 Manual move' })).toBeInTheDocument()
    expect(screen.queryByText(/^目标收藏夹：/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^分类来源：/)).not.toBeInTheDocument()
    expect(article.querySelector('.favorite-ledger-panel__preview-controls')).not.toBeNull()
  })

  it('keeps an unclassified card free of internal classification provenance', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Unclassified', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      ledgers={[]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    expect(screen.queryByText(/^分类来源：/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^目标收藏夹：/)).not.toBeInTheDocument()
  })

  it('keeps targets inside the transfer menu and applies multiple targets only on confirmation', () => {
    const apply = vi.fn()
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Multi target', sourceFolderIds: ['source'] }} sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music', 'knowledge'], source: 'manual' }}
      ledgers={[
        { id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true },
        { id: 'knowledge', displayName: 'Knowledge', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false }
      ]} loading={false} onApplyManualClassification={apply}
    />)

    expect(screen.getByRole('link', { name: 'Multi target' })).toHaveAttribute('href', 'https://www.bilibili.com/video/av1')
    expect(screen.queryByRole('checkbox', { name: '归类 Multi target Music' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '转移 Multi target' }))
    expect(screen.getByRole('menu', { name: '转移 Multi target' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '多选…' }))
    expect(screen.getByRole('checkbox', { name: '归类 Multi target Music' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '归类 Multi target Knowledge' })).toBeChecked()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认多选' }))
    expect(apply).toHaveBeenCalledWith(1, ['music', 'knowledge'])
    expect(screen.getByText('分类把握：比较稳')).toBeInTheDocument()
  })

  it('replaces only the current archive target and preserves the other selected targets', () => {
    const apply = vi.fn()
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Replace current target', sourceFolderIds: ['source'] }} sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music', 'knowledge'], source: 'manual' }}
      currentLedgerId="music" originalTargetLedgerIds={['music']}
      ledgers={[
        { id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true },
        { id: 'knowledge', displayName: 'Knowledge', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false },
        { id: 'archive', displayName: 'Archive', keywords: [], ruleType: 'keyword', enabled: true, priority: 2, isDefault: false }
      ]} loading={false} onApplyManualClassification={apply}
    />)

    expect(screen.getByText('原分类：Music')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '转移 Replace current target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }))
    expect(apply).toHaveBeenCalledWith(1, ['knowledge', 'archive'])
  })

  it('distinguishes removing the current archive target from removing every target', () => {
    const apply = vi.fn()
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Remove targets', sourceFolderIds: ['source'] }} sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music', 'knowledge'], source: 'manual' }} currentLedgerId="music"
      ledgers={[
        { id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true },
        { id: 'knowledge', displayName: 'Knowledge', keywords: [], ruleType: 'keyword', enabled: true, priority: 1, isDefault: false }
      ]} loading={false} onApplyManualClassification={apply}
    />)

    fireEvent.click(screen.getByRole('button', { name: '转移 Remove targets' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移出当前分类' }))
    expect(apply).toHaveBeenLastCalledWith(1, ['knowledge'])

    fireEvent.click(screen.getByRole('button', { name: '转移 Remove targets' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '移出全部分类' }))
    expect(apply).toHaveBeenLastCalledWith(1, [])
  })

  it('renders the transfer menu in an independent overlay and closes it from outside or Escape', () => {
    const { container } = render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Floating target', sourceFolderIds: ['source'] }} sourceFolderTitles={['Source folder']}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false} onApplyManualClassification={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '转移 Floating target' }))
    expect(screen.getByRole('menu', { name: '转移 Floating target' })).toBeInTheDocument()
    expect(container.querySelector('.favorite-ledger-panel__target-menu')).toBeNull()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: '转移 Floating target' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '转移 Floating target' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '转移 Floating target' })).not.toBeInTheDocument()
  })
})
