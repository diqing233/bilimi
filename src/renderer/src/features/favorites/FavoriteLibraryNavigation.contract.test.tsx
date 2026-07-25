import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
const favoriteLibraryStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'),
  'utf8'
)

describe('FavoriteLibraryNavigation contract', () => {
  it('keeps all favorites fixed and makes only folder groups collapsible', () => {
    const range = chinese(0x6536, 0x85cf, 0x8303, 0x56f4)
    const workspace = `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939)}`
    const staging = `bilimi ${chinese(0x6682, 0x5b58)}`
    const custom = chinese(0x81ea, 0x5efa, 0x6536, 0x85cf, 0x5939)
    const menu = chinese(0x83dc, 0x5355)

    const { container } = render(<FavoriteLibraryNavigation
      groups={[
        { id: 'range', label: range, items: [{ id: 'all', label: chinese(0x5168, 0x90e8), count: 4 }] },
        { id: 'workspace', label: workspace, items: [{ id: 'folder:managed', label: workspace, count: 2, managed: true }, { id: 'folder:staging', label: staging, count: 0, managed: true }] },
        { id: 'bilibili', label: custom, items: [{ id: 'folder:remote', label: custom, count: 3 }] }
      ]}
      collapsedGroups={{}}
      selectedId="all"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.queryByText(range)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: workspace })).not.toHaveAttribute('aria-expanded')
    expect(screen.getByRole('button', { name: `${chinese(0x6536, 0x8d77)}${workspace}` })).toHaveClass('favorite-library__navigation-group-toggle')
    expect(container.querySelectorAll('.favorite-library__navigation-group--separated')).toHaveLength(2)
    expect(screen.getByText(staging).closest('.favorite-library__navigation-row')).toHaveClass('favorite-library__navigation-row--managed')
    expect(screen.getByRole('button', { name: `${workspace} ${menu}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${staging} ${menu}` })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${custom} ${menu}` })).not.toBeInTheDocument()
  })

  it('labels the ordinary Bilibili folder group as other favorites', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'bilibili', label: '其他收藏夹', items: [{ id: 'folder:remote', label: '默认收藏夹', count: 3 }] }]}
      collapsedGroups={{}}
      selectedId="folder:remote"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '收起其他收藏夹' })).toBeInTheDocument()
    expect(screen.queryByText('自建收藏夹')).not.toBeInTheDocument()
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

  it('keeps the managed-folder action menu open while moving from its trigger into the popup', () => {
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
    expect(screen.getByRole('menu', { name: `${label} ${chinese(0x64cd, 0x4f5c)}` })).toHaveClass('favorite-library__folder-menu-items')
    expect(favoriteLibraryStyles).toContain('.favorite-library__folder-menu-wrap { position: relative;')
    // The popup must touch the trigger hit area; a gap closes it before an action can be clicked.
    expect(favoriteLibraryStyles).toContain('.favorite-library__folder-menu-items { position: absolute; z-index: 3; top: 100%; right: 0;')

    const actions = screen.getByRole('menu', { name: `${label} ${chinese(0x64cd, 0x4f5c)}` })
    fireEvent.pointerLeave(screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` }), { relatedTarget: actions })
    fireEvent.click(screen.getByRole('button', { name: edit }))
    expect(screen.getByRole('button', { name: edit })).toBeInTheDocument()

    fireEvent.pointerLeave(menuWrap)
    expect(screen.queryByRole('button', { name: edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: remove })).not.toBeInTheDocument()
  })
})
