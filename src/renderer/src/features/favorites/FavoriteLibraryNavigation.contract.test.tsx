import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)

describe('FavoriteLibraryNavigation contract', () => {
  it('uses right-aligned group controls, dashed group boundaries, and reserves folder menus for managed workspace rows', () => {
    const range = chinese(0x6536, 0x85cf, 0x8303, 0x56f4)
    const workspace = `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939)}`
    const staging = `bilimi ${chinese(0x6682, 0x5b58)}`
    const custom = chinese(0x81ea, 0x5efa, 0x6536, 0x85cf, 0x5939)
    const menu = chinese(0x83dc, 0x5355)

    const { container } = render(<FavoriteLibraryNavigation
      groups={[
        { id: 'range', label: range, items: [{ id: 'all', label: chinese(0x5168, 0x90e8), count: 4 }] },
        { id: 'workspace', label: workspace, items: [{ id: 'folder:managed', label: workspace, count: 2, managed: true }, { id: 'folder:staging', label: staging, count: 0, protected: true }] },
        { id: 'bilibili', label: custom, items: [{ id: 'folder:remote', label: custom, count: 3 }] }
      ]}
      collapsedGroups={{}}
      selectedId="all"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByText(range)).toHaveClass('favorite-library__navigation-group-label')
    expect(screen.getByRole('button', { name: `${chinese(0x6536, 0x8d77)}${range}` })).toHaveClass('favorite-library__navigation-group-toggle')
    expect(container.querySelectorAll('.favorite-library__navigation-group--separated')).toHaveLength(2)
    expect(screen.getByText(staging).closest('.favorite-library__navigation-row')).not.toHaveClass('favorite-library__navigation-row--managed')
    expect(screen.getByRole('button', { name: `${workspace} ${menu}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${staging} ${menu}` })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${custom} ${menu}` })).not.toBeInTheDocument()
  })

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

  it('reveals one managed-folder action menu on pointer hover and closes it on pointer leave', () => {
    const label = chinese(0x5de5, 0x4f5c, 0x5939)
    const edit = chinese(0x7f16, 0x8f91, 0x4fe1, 0x606f)
    const remove = chinese(0x5220, 0x9664)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 7, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    const menuWrap = screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` }).closest('.favorite-library__folder-menu-wrap')!
    expect(screen.queryByRole('button', { name: edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: remove })).not.toBeInTheDocument()

    fireEvent.pointerEnter(menuWrap)
    expect(screen.getAllByRole('button', { name: edit })).toHaveLength(1)
    expect(screen.getByRole('button', { name: remove })).toBeInTheDocument()

    fireEvent.pointerLeave(menuWrap)
    expect(screen.queryByRole('button', { name: edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: remove })).not.toBeInTheDocument()
  })
})
