import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'

const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
const favoriteLibraryStyles = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'),
  'utf8'
)

describe('FavoriteLibraryNavigation contract', () => {
  it('does not rerender unrelated navigation groups when one disclosure changes', () => {
    let unrelatedReads = 0
    const unrelatedItem = {
      id: 'folder:remote',
      get label() {
        unrelatedReads += 1
        return '默认收藏夹'
      },
      count: 3
    }
    render(<FavoriteLibraryNavigation
      uid="100"
      groups={[
        { id: 'workspace', label: 'bilimi 工作夹', items: [{ id: 'folder:one', label: '工作夹一', count: 1, managed: true }] },
        { id: 'bilibili', label: '其他收藏夹', items: [unrelatedItem] }
      ]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)
    unrelatedReads = 0

    fireEvent.click(screen.getByRole('button', { name: '收起bilimi 工作夹' }))

    expect(unrelatedReads).toBe(0)
  })

  it('updates a group disclosure immediately without waiting for its parent to rerender', () => {
    const onCollapseChange = vi.fn()
    render(<FavoriteLibraryNavigation
      uid="100"
      groups={[{ id: 'workspace', label: 'bilimi 工作夹', items: [{ id: 'folder:one', label: '工作夹一', count: 1, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={onCollapseChange}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '收起bilimi 工作夹' }))

    expect(screen.getByRole('button', { name: '展开bilimi 工作夹' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '工作夹一' })).not.toBeInTheDocument()
    expect(onCollapseChange).toHaveBeenCalledWith('100', 'workspace', true)
  })

  it('ignores an older failed selection after a newer optimistic selection starts', async () => {
    let rejectFirst!: (reason?: unknown) => void
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    const onSelect = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(true)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'workspace', items: [
        { id: 'folder:one', label: 'one', count: 1 },
        { id: 'folder:two', label: 'two', count: 1 }
      ] }]}
      collapsedGroups={{}}
      selectedId="all"
      onCollapseChange={vi.fn()}
      onSelect={onSelect}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'one' }))
    fireEvent.click(screen.getByRole('button', { name: 'two' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'two' })).toHaveAttribute('aria-current', 'page'))
    rejectFirst(new Error('stale request'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'two' })).toHaveAttribute('aria-current', 'page'))
  })

  it('uses the latest managed-folder action after its parent rerenders', () => {
    const label = chinese(0x5de5, 0x4f5c, 0x5939)
    const firstAction = vi.fn()
    const latestAction = vi.fn()
    const props = {
      uid: '100',
      groups: [{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 1, managed: true }] }],
      collapsedGroups: {},
      selectedId: 'folder:managed',
      onCollapseChange: vi.fn(),
      onSelect: vi.fn()
    }
    const { rerender } = render(<FavoriteLibraryNavigation {...props} onManagedFolderAction={firstAction} />)

    rerender(<FavoriteLibraryNavigation {...props} onManagedFolderAction={latestAction} />)
    fireEvent.click(screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` }))
    fireEvent.click(screen.getByRole('menuitem', { name: chinese(0x7f16, 0x8f91, 0x4fe1, 0x606f) }))

    expect(latestAction).toHaveBeenCalledWith('folder:managed', 'edit')
    expect(firstAction).not.toHaveBeenCalled()
  })

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

  it('describes the all-favorites aggregate as a deduplicated video total', () => {
    const all = chinese(0x5168, 0x90e8, 0x6536, 0x85cf)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'range', label: '', items: [{ id: 'all', label: all, count: 257 }] }]}
      collapsedGroups={{}}
      selectedId="all"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: all })).toHaveAttribute('title', '共 257 个去重视频')
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

  it('keeps workspace aggregate counts in the group tooltip instead of the row', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'bilimi 工作夹', count: 9, items: [
        { id: 'folder:one', label: '一', count: 4, managed: true },
        { id: 'folder:two', label: '二', count: 5, managed: true }
      ] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    const heading = screen.getByRole('button', { name: '收起bilimi 工作夹' }).parentElement!
    expect(heading.querySelector('.favorite-library__navigation-count')).not.toBeInTheDocument()
    expect(heading.querySelector('.favorite-library__workspace-menu')).toBeInTheDocument()
  })

  it('keeps the workspace title uncluttered and reserves the trailing slot for its menu', () => {
    const { container } = render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'bilimi 工作夹', count: 99, items: [
        { id: 'folder:one', label: '一', count: 3, managed: true, aids: [1, 2, 3] },
        { id: 'folder:two', label: '二', count: 3, managed: true, aids: [2, 3, 4] },
        { id: 'folder:protected', label: '收件箱', count: 5, managed: true, protected: true, aids: [5, 6, 7, 8, 9] }
      ] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '收起bilimi 工作夹' })).toBeInTheDocument()
    const heading = container.querySelector('.favorite-library__navigation-group-heading--workspace')
    expect(heading?.querySelector('.favorite-library__navigation-count')).not.toBeInTheDocument()
    expect(heading?.querySelector('.favorite-library__workspace-menu')).toBeInTheDocument()
  })

  it('keeps the workspace group trigger visually compact without changing its controls', () => {
    expect(favoriteLibraryStyles).toContain('.favorite-library__navigation-group-heading { display: flex; align-items: center; min-height: 28px; padding: 0 0 0 8px; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__navigation-group-toggle { flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-start; gap: 4px; width: auto; min-height: 24px; margin: 0; padding: 0 4px 0 0; color: #1e3a8a; font-size: 12px; font-weight: 700; }')
    expect(favoriteLibraryStyles).toContain('.favorite-library__navigation-group-toggle .favorite-library__chevron { width: 14px; height: 14px;')
  })

  it('closes a workspace portal when the account changes or its group collapses', async () => {
    const props = {
      groups: [{ id: 'workspace', label: 'bilimi 工作夹', items: [{ id: 'folder:managed', label: '工作夹', count: 1, managed: true }] }],
      selectedId: 'folder:managed',
      onCollapseChange: vi.fn(),
      onSelect: vi.fn()
    }
    const { rerender } = render(<FavoriteLibraryNavigation {...props} uid="100" collapsedGroups={{}} />)
    const trigger = screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'bilimi 工作夹操作' })).toBeInTheDocument()

    rerender(<FavoriteLibraryNavigation {...props} uid="200" collapsedGroups={{}} />)
    expect(screen.queryByRole('menu', { name: 'bilimi 工作夹操作' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    expect(screen.getByRole('menu', { name: 'bilimi 工作夹操作' })).toBeInTheDocument()
    rerender(<FavoriteLibraryNavigation {...props} uid="200" collapsedGroups={{ workspace: true }} />)
    expect(screen.queryByRole('menu', { name: 'bilimi 工作夹操作' })).not.toBeInTheDocument()
  })

  it('unmounts work-folder rows while collapsed and restores them on expansion', () => {
    const label = chinese(0x5de5, 0x4f5c, 0x5939)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: `bilimi ${label}`, items: [{ id: 'folder:managed', label, count: 7, managed: true }] }]}
      uid="100"
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: `\u6536\u8d77bilimi ${label}` }))
    expect(screen.queryByText(label)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `\u5c55\u5f00bilimi ${label}` }))
    expect(screen.getByText(label).closest('.favorite-library__navigation-row')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` })).toBeInTheDocument()
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
    const menuTrigger = screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` })
    expect(menuTrigger).toHaveTextContent('\u22ee')
    expect(menuTrigger).not.toHaveAttribute('tabindex', '-1')
    menuTrigger.focus()
    fireEvent.click(menuTrigger)
    expect(screen.getByRole('menu', { name: `${label} 操作` })).toBeInTheDocument()
    expect(favoriteLibraryStyles).toContain('.favorite-library__folder-menu, .favorite-library__workspace-menu { grid-area: 1 / 1; display: inline-flex;')
    expect(favoriteLibraryStyles).toContain('opacity: 0; pointer-events: none;')
  })

  it('marks workspace and individual managed-folder deletion controls as danger actions', () => {
    const label = chinese(0x5de5, 0x4f5c, 0x5939)
    const remove = chinese(0x5220, 0x9664)
    const removeAll = chinese(0x5220, 0x9664, 0x5168, 0x90e8, 0x5de5, 0x4f5c, 0x5939)
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 7, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    expect(screen.getByRole('menuitem', { name: removeAll })).toHaveClass('favorite-library__danger-action')
    fireEvent.click(screen.getByRole('button', { name: `${label} 菜单` }))
    expect(screen.getByRole('menuitem', { name: remove })).toHaveClass('favorite-library__danger-action')
    expect(favoriteLibraryStyles).toContain('.favorite-library__folder-floating-menu button.favorite-library__danger-action { color: #9d2e2e; }')
  })

  it('opens the workspace group menu in a drawer-scoped floating Portal', () => {
    const label = `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939)}`
    const menu = chinese(0x83dc, 0x5355)
    const { container } = render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 1, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939, 0x7ba1, 0x7406)}${menu}` }))
    const floatingMenu = screen.getByRole('menu', { name: `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939, 0x64cd, 0x4f5c)}` })
    expect(container.querySelector('.favorite-library__navigation-groups')).not.toContainElement(floatingMenu)
    expect(floatingMenu).toHaveClass('favorite-library__workspace-floating-menu')
    expect(favoriteLibraryStyles).toContain('.favorite-library__workspace-floating-menu { position: fixed;')
  })

  it('anchors portal menus 6px below their trigger, clamps them to an 8px gutter, and restores focus on Escape', () => {
    const label = `bilimi ${chinese(0x5de5, 0x4f5c, 0x5939)}`
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label, items: [{ id: 'folder:managed', label, count: 1, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:managed"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 20, width: 24, height: 20, top: 20, right: 24, bottom: 40, left: 0, toJSON: () => ({}) })
    fireEvent.click(trigger)

    const menu = screen.getByRole('menu', { name: 'bilimi 工作夹操作' })
    expect(menu).toHaveStyle({ top: '46px', left: '8px' })
    expect(screen.getByRole('menuitem', { name: '新建工作夹' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'bilimi 工作夹操作' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'bilimi 工作夹操作' })).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu', { name: 'bilimi 工作夹操作' })).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: 'bilimi 工作夹操作' })).not.toBeInTheDocument()
  })

  it('keeps a narrow viewport clamp valid and repositions on resize and scroll', () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    try {
      render(<FavoriteLibraryNavigation
        groups={[{ id: 'workspace', label: 'bilimi 工作夹', items: [] }]}
        collapsedGroups={{}}
        selectedId="all"
        onCollapseChange={vi.fn()}
        onSelect={vi.fn()}
      />)
      const trigger = screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' })
      const rect = { x: 260, y: 20, width: 24, height: 20, top: 20, right: 284, bottom: 40, left: 260, toJSON: () => ({}) }
      vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => rect)
      fireEvent.click(trigger)
      const menu = screen.getByRole('menu', { name: 'bilimi 工作夹操作' })
      expect(menu).toHaveStyle({ left: '112px' })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 160 })
      fireEvent.resize(window)
      expect(menu).toHaveStyle({ left: '8px' })
      rect.left = 40; rect.right = 64; rect.bottom = 80
      fireEvent.scroll(window)
      expect(menu).toHaveStyle({ top: '86px', left: '8px' })
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('keeps non-workspace group counts in their trailing slot without creating an ellipsis trigger', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'bilibili', label: '其他收藏夹', items: [{ id: 'folder:remote', label: '默认收藏夹', count: 3 }] }]}
      collapsedGroups={{}}
      selectedId="folder:remote"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    const trigger = screen.getByRole('button', { name: '收起其他收藏夹' })
    expect(trigger.parentElement).toHaveTextContent('其他收藏夹')
    expect(trigger).toHaveAttribute('title', '共 1 个收藏夹\n共 3 条收藏归属\n去重后 0 个视频')
    expect(screen.queryByRole('button', { name: /管理菜单$/ })).not.toBeInTheDocument()
  })

  it('uses each title tooltip to show folder and deduplicated-video totals', () => {
    const workspace = 'bilimi 工作夹'
    const other = '其他收藏夹'
    render(<FavoriteLibraryNavigation
      groups={[
        { id: 'workspace', label: workspace, items: [
          { id: 'folder:one', label: '一', count: 3, managed: true, aids: [1, 2, 3] },
          { id: 'folder:two', label: '二', count: 3, managed: true, aids: [2, 3, 4] },
          { id: 'folder:inbox', label: '暂存', count: 2, managed: true, protected: true, aids: [5, 6] }
        ] },
        { id: 'bilibili', label: other, items: [
          { id: 'folder:three', label: '三', count: 2, aids: [7, 8] },
          { id: 'folder:four', label: '四', count: 2, aids: [8, 9] }
        ] }
      ]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '收起bilimi 工作夹' })).toHaveAttribute('title', '共 2 个工作夹\n共 6 条收藏归属\n去重后 4 个视频')
    expect(screen.getByRole('button', { name: '收起其他收藏夹' })).toHaveAttribute('title', '共 2 个收藏夹\n共 4 条收藏归属\n去重后 3 个视频')
  })

  it('does not offer an ellipsis for an arbitrary managed folder outside the workspace group', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'bilibili', label: '其他收藏夹', items: [{ id: 'folder:remote', label: '远程工作夹', count: 3, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:remote"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(screen.queryByRole('button', { name: '远程工作夹 菜单' })).not.toBeInTheDocument()
  })

  it('keeps mounted navigation rows bounded for a 30000-folder group', () => {
    const items = Array.from({ length: 30_000 }, (_, index) => ({
      id: `folder:${index}`,
      label: `folder ${index}`,
      count: index,
      managed: true
    }))
    const { container } = render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'bilimi workspace', items }]}
      collapsedGroups={{}}
      selectedId="folder:0"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(container.querySelectorAll('.favorite-library__navigation-row').length).toBeLessThan(100)
  })

  it('does not mount folder rows or their menu triggers while a large group is collapsed', () => {
    const items = Array.from({ length: 30_000 }, (_, index) => ({
      id: `folder:${index}`,
      label: `folder ${index}`,
      count: index,
      managed: true
    }))
    const { container } = render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'bilimi workspace', items }]}
      collapsedGroups={{ workspace: true }}
      selectedId="folder:0"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    expect(container.querySelectorAll('.favorite-library__navigation-row')).toHaveLength(0)
    expect(container.querySelectorAll('.favorite-library__folder-menu')).toHaveLength(1)
  })

  it('opens the managed-folder action menu as a trigger-anchored Portal', () => {
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

    const menuTrigger = screen.getByRole('button', { name: `${label} ${chinese(0x83dc, 0x5355)}` })
    expect(screen.queryByRole('button', { name: edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: remove })).not.toBeInTheDocument()

    fireEvent.click(menuTrigger)
    expect(screen.getAllByRole('menuitem', { name: edit })).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: remove })).toBeInTheDocument()
    expect(screen.getByRole('menu', { name: `${label} ${chinese(0x64cd, 0x4f5c)}` })).toHaveClass('favorite-library__folder-floating-menu')
    expect(favoriteLibraryStyles).toContain('.favorite-library__navigation-trailing-slot { display: grid; flex: 0 0 28px;')
    expect(favoriteLibraryStyles).toContain(".favorite-library__navigation-row--managed:hover .favorite-library__navigation-count")
    expect(favoriteLibraryStyles).toContain(".favorite-library__navigation-row--managed:has(.favorite-library__folder-menu:focus-visible) .favorite-library__navigation-count")
    expect(favoriteLibraryStyles).toContain('.favorite-library__folder-floating-menu { position: fixed;')

    const actions = screen.getByRole('menu', { name: `${label} ${chinese(0x64cd, 0x4f5c)}` })
    fireEvent.click(screen.getByRole('menuitem', { name: edit }))
    expect(screen.queryByRole('menuitem', { name: edit })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: remove })).not.toBeInTheDocument()
  })

  it('uses one shared managed-folder portal when switching between folder menus', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'workspace', items: [
        { id: 'folder:one', label: 'one', count: 1, managed: true },
        { id: 'folder:two', label: 'two', count: 2, managed: true }
      ] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'one 菜单' }))
    fireEvent.click(screen.getByRole('button', { name: 'two 菜单' }))

    expect(screen.getAllByRole('menu', { name: /操作$/ })).toHaveLength(1)
    expect(screen.getByRole('menu', { name: 'two 操作' })).toBeInTheDocument()
  })

  it('does not rebuild visible folder rows just to open their shared action menu', () => {
    let unrelatedLabelReads = 0
    const items = [
      { id: 'folder:one', label: 'one', count: 1, managed: true },
      {
        id: 'folder:two',
        get label() { unrelatedLabelReads += 1; return 'two' },
        count: 2,
        managed: true
      }
    ]
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'workspace', items }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)
    unrelatedLabelReads = 0

    fireEvent.click(screen.getByRole('button', { name: 'one 菜单' }))

    expect(screen.getByRole('menu', { name: 'one 操作' })).toBeInTheDocument()
    expect(unrelatedLabelReads).toBe(0)
  })

  it('closes the shared managed-folder portal when its group collapses', () => {
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'workspace', items: [{ id: 'folder:one', label: 'one', count: 1, managed: true }] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'one 菜单' }))
    fireEvent.click(screen.getByRole('button', { name: '收起workspace' }))

    expect(screen.queryByRole('menu', { name: 'one 操作' })).not.toBeInTheDocument()
  })

  it('closes the shared managed-folder portal when the account changes', () => {
    const props = {
      groups: [{ id: 'workspace', label: 'workspace', items: [{ id: 'folder:one', label: 'one', count: 1, managed: true }] }],
      collapsedGroups: {},
      selectedId: 'folder:one',
      onCollapseChange: vi.fn(),
      onSelect: vi.fn()
    }
    const { rerender } = render(<FavoriteLibraryNavigation {...props} uid="100" />)
    fireEvent.click(screen.getByRole('button', { name: 'one 菜单' }))

    rerender(<FavoriteLibraryNavigation {...props} uid="200" />)

    expect(screen.queryByRole('menu', { name: 'one 操作' })).not.toBeInTheDocument()
  })

  it('closes the shared portal when virtual scrolling unmounts its trigger', async () => {
    const items = Array.from({ length: 200 }, (_, index) => ({ id: `folder:${index}`, label: `folder ${index}`, count: index, managed: true }))
    render(<FavoriteLibraryNavigation groups={[{ id: 'workspace', label: 'workspace', items }]} collapsedGroups={{}} selectedId="folder:0" onCollapseChange={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'folder 0 菜单' }))
    const nav = screen.getByRole('navigation')
    Object.defineProperty(nav, 'getBoundingClientRect', { configurable: true, value: () => ({ top: 0 }) })
    const itemsRoot = nav.querySelector('.favorite-library__navigation-items') as HTMLElement
    Object.defineProperty(itemsRoot, 'getBoundingClientRect', { configurable: true, value: () => ({ top: -3000 }) })

    fireEvent.scroll(nav)

    await waitFor(() => expect(screen.queryByRole('menu', { name: 'folder 0 操作' })).not.toBeInTheDocument())
  })

  it('marks a selected folder immediately while dispatching its parent selection', () => {
    const onSelect = vi.fn()
    render(<FavoriteLibraryNavigation
      groups={[{ id: 'workspace', label: 'workspace', items: [
        { id: 'folder:one', label: 'one', count: 1, managed: true },
        { id: 'folder:two', label: 'two', count: 2, managed: true }
      ] }]}
      collapsedGroups={{}}
      selectedId="folder:one"
      onCollapseChange={vi.fn()}
      onSelect={onSelect}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'two' }))

    expect(screen.getByRole('button', { name: 'two' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'one' })).not.toHaveAttribute('aria-current')
    expect(onSelect).toHaveBeenCalledWith('folder:two')
  })
})
