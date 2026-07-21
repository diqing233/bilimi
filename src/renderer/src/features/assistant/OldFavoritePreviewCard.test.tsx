import { render, screen } from '@testing-library/react'
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
    expect(article.querySelector('.favorite-ledger-panel__preview-video--pending')).toHaveAttribute('data-selected', 'true')
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

  it('keeps the legacy target line and compact classification footer together', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Manual move', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    const article = screen.getByRole('article')
    expect(screen.getByText('目标收藏夹：Music')).toBeInTheDocument()
    expect(screen.getByLabelText('归类 Manual move')).toBeInTheDocument()
    expect(article.querySelector('.favorite-ledger-panel__preview-controls')).not.toBeNull()
    expect(article.querySelector('.favorite-ledger-panel__preview-change-source')).toHaveTextContent('改动来源：人工调整')
  })

  it('labels an unclassified card as an unclassified classification source', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Unclassified', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      ledgers={[]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    expect(screen.getByText('分类来源：未分类')).toBeInTheDocument()
    expect(screen.getByText('目标收藏夹：未分类')).toBeInTheDocument()
  })

  it('links its title to the original Bilibili video and keeps every selected target editable', () => {
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
    expect(screen.getByText('目标收藏夹：Music、Knowledge')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '归类 Multi target Music' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '归类 Multi target Knowledge' })).toBeChecked()
    expect(screen.getByText('分类把握：比较稳')).toBeInTheDocument()
  })
})
