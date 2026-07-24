import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)

describe('FavoriteLibraryNavigation contract', () => {
  it('keeps a managed folder count in a dedicated slot replaced by an accessible three-dot menu', () => {
    const label = chinese(0x5de5, 0x4f5c, 0x5939)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 7, managed: true }] }]}
      uid="100"
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByText('7')).toHaveClass('favorite-library__navigation-count')
    expect(screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` })).toHaveTextContent('\u22ee')
  })
})
