import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'
import { FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'
import { FavoriteLibraryDialogs } from './FavoriteLibraryDialogs'

describe('Favorite Library workspace components', () => {
  it('renders a compact top bar with conditional remote warning and labelled window controls', () => {
    const { rerender } = render(<FavoriteLibraryHeader title="收藏库" remoteWarning={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
    rerender(<FavoriteLibraryHeader title="收藏库" remoteWarning maximized />)
    expect(screen.getByRole('status')).toHaveTextContent('远程状态待确认')
    expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument()
  })

  it('routes failed and unknown remote warnings to the pending scope', () => {
    const onGoToPending = vi.fn()
    render(<FavoriteLibraryHeader title="收藏库" remoteWarning onGoToPending={onGoToPending} />)
    fireEvent.click(screen.getByRole('button', { name: 'go-pending-scope' }))
    expect(onGoToPending).toHaveBeenCalledOnce()
  })

  it('keeps the compact Xiaomi identity and complete window control affordances in the top bar', () => {
    const onMinimize = vi.fn()
    const onToggleMaximize = vi.fn()
    const onClose = vi.fn()
    render(<FavoriteLibraryHeader title="收藏库" account="小米（UID：100）" onMinimize={onMinimize} onToggleMaximize={onToggleMaximize} onClose={onClose} />)

    expect(screen.getByLabelText('XiaoMi')).toBeInTheDocument()
    expect(screen.getByText('小米（UID：100）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onMinimize).toHaveBeenCalledOnce()
    expect(onToggleMaximize).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('button', { name: '刷新所选信息' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入转写队列' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同步到B站' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '从收藏库删除' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '危险操作' }))
    expect(screen.getByRole('button', { name: '从收藏库删除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消B站收藏' })).toBeInTheDocument()
  })

  it('keeps detail visible until manually collapsed and changes the active row without changing list state', () => {
    const onCollapse = vi.fn()
    const { rerender } = render(<FavoriteLibraryDetail title="视频一" onCollapse={onCollapse} />)
    expect(screen.getByRole('complementary')).toHaveTextContent('视频一')
    fireEvent.click(screen.getByRole('button', { name: '收起详情' }))
    expect(onCollapse).toHaveBeenCalledWith(true)
    rerender(<FavoriteLibraryDetail title="视频二" onCollapse={onCollapse} />)
    expect(screen.getByRole('complementary')).toHaveTextContent('视频二')
  })

  it('exposes stable workspace divider and split footer contracts', () => {
    const style = document.createElement('style')
    style.textContent = '.favorite-library__workspace { }'
    document.head.append(style)
    expect(style.textContent).toContain('favorite-library__workspace')
    style.remove()
  })

  it('restores a manually collapsed detail without changing the selected video', () => {
    const onRestore = vi.fn()
    render(<FavoriteLibraryDetail title="视频一" collapsed onRestore={onRestore} onCollapse={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '恢复视频详情' }))
    expect(onRestore).toHaveBeenCalledOnce()
  })

  it('keeps managed-folder deletion as an explicit choice with a safe local default', () => {
    const onChoose = vi.fn()
    render(<FavoriteLibraryDialogs managedFolder={{ title: '工作夹', canDeleteRemotely: true }} onManagedFolderChoice={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: '仅从收藏库删除' }))
    expect(onChoose).toHaveBeenCalledWith('local')
    expect(screen.getByRole('button', { name: '删除并同步到B站' })).toBeInTheDocument()
  })
})
