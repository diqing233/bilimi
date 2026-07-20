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
    expect(article).toHaveClass('favorite-ledger-panel__preview-item-shell')
    expect(article).not.toHaveClass('favorite-ledger-panel__preview-video')
    expect(article.querySelector('.favorite-ledger-panel__preview-video--pending')).toHaveAttribute('data-selected', 'false')
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
})
