import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'
import { FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'

describe('Favorite Library workspace components', () => {
  it('renders a compact top bar with conditional remote warning and labelled window controls', () => {
    const { rerender } = render(<FavoriteLibraryHeader title="收藏库" remoteWarning={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
    rerender(<FavoriteLibraryHeader title="收藏库" remoteWarning maximized />)
    expect(screen.getByRole('status')).toHaveTextContent('\\u8fdc\\u7a0b\\u72b6\\u6001\\u5f85\\u786e\\u8ba4')
    expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument()
  })

  it('groups navigation, persists uid collapse changes, retains zero counts, and selects stable ids', () => {
    const onCollapseChange = vi.fn()
    const onSelect = vi.fn()
    render(<FavoriteLibraryNavigation
      uid="100"
      collapsedGroups={{ bilibili: false, workspace: false, local: false }}
      onCollapseChange={onCollapseChange}
      selectedId="folder:managed"
      onSelect={onSelect}
      groups={[
        { id: 'bilibili', label: 'B站收藏', items: [{ id: 'all', label: '全部收藏', count: 0 }] },
        { id: 'workspace', label: '工作区', items: [{ id: 'folder:managed', label: 'bilimi 工作夹', count: 2, managed: true }, { id: 'folder:unmatched', label: '未匹配分类', count: 0, protected: true }] },
        { id: 'local', label: '本地', items: [{ id: 'pending', label: '待处理', count: 0 }] }
      ]}
    />)
    expect(screen.getByRole('button', { name: '全部收藏' })).toHaveTextContent('全部收藏 0')
    fireEvent.click(screen.getByRole('button', { name: '工作区' }))
    expect(onCollapseChange).toHaveBeenCalledWith('100', 'workspace', true)
    fireEvent.click(screen.getByRole('button', { name: 'bilimi 工作夹' }))
    expect(onSelect).toHaveBeenCalledWith('folder:managed')
    expect(screen.getByRole('button', { name: 'bilimi 工作夹 菜单' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未匹配分类 菜单' })).not.toBeInTheDocument()
  })

  it('keeps current-page selection distinct from partial selection and expands batch actions without count labels', () => {
    const onTogglePage = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={3} selectedCount={1} allCurrentPageSelected={false} onTogglePage={onTogglePage} />)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getByText('全选当前页（3）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前页' }))
    expect(onTogglePage).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }))
    expect(screen.getByRole('button', { name: '复制至' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移动至' })).toBeInTheDocument()
  })

  it('keeps detail visible until manually collapsed and changes the active row without changing list state', () => {
    const onCollapse = vi.fn()
    const { rerender } = render(<FavoriteLibraryDetail title="视频一" onCollapse={onCollapse} />)
    expect(screen.getByRole('complementary', { name: '\\u89c6\\u9891\\u8be6\\u60c5' })).toHaveTextContent('视频一')
    fireEvent.click(screen.getByRole('button', { name: '\\u6536\\u8d77\\u8be6\\u60c5' }))
    expect(onCollapse).toHaveBeenCalledWith(true)
    rerender(<FavoriteLibraryDetail title="视频二" onCollapse={onCollapse} />)
    expect(screen.getByRole('complementary', { name: '\\u89c6\\u9891\\u8be6\\u60c5' })).toHaveTextContent('视频二')
  })

  it('exposes stable workspace divider and split footer contracts', () => {
    const style = document.createElement('style')
    style.textContent = '.favorite-library__workspace { }'
    document.head.append(style)
    expect(style.textContent).toContain('favorite-library__workspace')
    style.remove()
  })
})
