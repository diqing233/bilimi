import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OldFavoritePreviewCard } from './OldFavoritePreviewCard'

describe('OldFavoritePreviewCard', () => {
  it('uses the legacy preview-video card shell for a controlled workspace item', () => {
    render(<OldFavoritePreviewCard
      item={{ aid: 1, title: 'Legacy preview', author: 'Uploader', sourceFolderIds: ['source'] }}
      sourceFolderTitles={['Source folder']}
      classification={{ aid: 1, targetLedgerIds: ['music'], source: 'manual' }}
      ledgers={[{ id: 'music', displayName: 'Music', keywords: [], ruleType: 'keyword', enabled: true, priority: 0, isDefault: true }]}
      loading={false}
      onApplyManualClassification={vi.fn()}
    />)

    expect(screen.getByRole('article')).toHaveClass('favorite-ledger-panel__preview-video')
    expect(screen.getByRole('article')).toHaveClass('favorite-ledger-panel__preview-item-shell')
  })
})
