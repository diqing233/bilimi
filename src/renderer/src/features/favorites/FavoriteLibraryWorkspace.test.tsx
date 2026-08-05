import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'
import { FavoriteLibraryNavigation } from './FavoriteLibraryNavigation'
import { FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'
import { FavoriteLibraryDialogs } from './FavoriteLibraryDialogs'

describe('Favorite Library workspace components', () => {
  it('pins virtual navigation geometry to the compact row box without clipping text', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')
    expect(styles).toContain('.favorite-library__navigation-row { display: flex; align-items: center; min-height: 30px; height: 30px; box-sizing: border-box; }')
    expect(styles).toContain('.favorite-library__navigation-row > button:first-child { display: flex; flex: 1; align-items: center; min-width: 0; height: 100%;')
  })
  it('keeps the embedded workspace title controls compact without a heavy menu outline', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__navigation-group-heading { display: flex; align-items: center; min-height: 28px;')
    expect(styles).toContain('.favorite-library__folder-menu, .favorite-library__workspace-menu { grid-area: 1 / 1; display: inline-flex; align-items: center; justify-content: flex-end; width: 28px; min-width: 28px; padding: 5px 0; border: 0; background: transparent; color: #64748b; opacity: 0; pointer-events: none; }')
    expect(styles).toContain('.favorite-library__navigation-group-toggle { flex: 1 1 auto;')
    expect(styles).toContain('.favorite-library__folder-menu-items hr { width: 100%; height: 1px; margin: 3px 0;')
    expect(styles).toContain('.favorite-library__batch-floating-menu { position: fixed;')
  })

  it('limits porcelain scrollbars to favorite-library-owned scroll containers', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__nav, .favorite-library__navigation-groups, .favorite-library__list, .favorite-library__detail { scrollbar-width: thin; scrollbar-color: #7ea8d8 rgb(226 238 255 / .58); }')
    expect(styles).toContain('.favorite-library__batch-destination-scroll, .favorite-library__batch-floating-menu { scrollbar-width: thin; scrollbar-color: #7ea8d8 rgb(226 238 255 / .58); }')
    expect(styles).toContain('.favorite-library__nav { overflow-x: hidden; overflow-y: auto; }')
    expect(styles).toContain('.favorite-library__nav::-webkit-scrollbar { width: 6px; height: 0; }')
    expect(styles).toContain('.favorite-library__nav::-webkit-scrollbar-thumb, .favorite-library__list::-webkit-scrollbar-thumb, .favorite-library__detail::-webkit-scrollbar-thumb, .favorite-library__batch-destination-scroll::-webkit-scrollbar-thumb, .favorite-library__batch-floating-menu::-webkit-scrollbar-thumb { border: 1px solid transparent; border-radius: 999px; background: #5d8fc8; background-clip: padding-box; }')
    expect(styles).not.toContain('body::-webkit-scrollbar')
  })

  it('keeps title, status, transcription, and source columns bounded in both detail states', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('--favorite-library-row-columns: minmax(0, 1fr) minmax(92px, .34fr) minmax(118px, .42fr) minmax(96px, .34fr);')
    expect(styles).toContain('.favorite-library__row-source { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }')
    expect(styles).not.toContain(".favorite-library__layout[data-detail-state='open'] .favorite-library__row-transcription { display: none; }")
  })

  it('uses compact porcelain controls for current workspace actions', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__workspace-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-left: auto; }')
    expect(styles).toContain('.favorite-library__workspace-actions button { border: 1px solid #cbdcf5; border-radius: 6px; background: #fff; color: #1e3a8a; }')
  })

  it('renders a compact top bar with conditional remote warning and labelled window controls', () => {
    const { rerender } = render(<FavoriteLibraryHeader title="收藏库" remoteWarning={false} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument()
    rerender(<FavoriteLibraryHeader title="收藏库" remoteWarning />)
    expect(screen.getByRole('status')).toHaveTextContent('远程状态待确认')
    expect(screen.getByRole('button', { name: '最大化' })).toHaveAttribute('title', '展开并拉到最高')
  })

  it('routes failed and unknown remote warnings to the pending scope', () => {
    const onGoToPending = vi.fn()
    render(<FavoriteLibraryHeader title="收藏库" remoteWarning onGoToPending={onGoToPending} />)
    fireEvent.click(screen.getByRole('button', { name: 'go-pending-scope' }))
    expect(onGoToPending).toHaveBeenCalledOnce()
  })

  it('keeps the compact Xiaomi identity and complete window control affordances in the top bar', () => {
    const onMinimize = vi.fn()
    const onExpandAndMaximize = vi.fn()
    const onClose = vi.fn()
    render(<FavoriteLibraryHeader title="收藏库" account="小米（UID：100）" onMinimize={onMinimize} onExpandAndMaximize={onExpandAndMaximize} onClose={onClose} />)

    expect(screen.getByLabelText('XiaoMi')).toBeInTheDocument()
    expect(screen.getByText('小米（UID：100）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '最小化' }))
    fireEvent.click(screen.getByRole('button', { name: '最大化' }))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onMinimize).toHaveBeenCalledOnce()
    expect(onExpandAndMaximize).toHaveBeenCalledOnce()
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
    expect(screen.getByRole('button', { name: '全部收藏' }).closest('.favorite-library__navigation-row')).toHaveTextContent('全部收藏0')
    fireEvent.click(screen.getByRole('button', { name: '收起工作区' }))
    expect(onCollapseChange).toHaveBeenCalledWith('100', 'workspace', true)
    fireEvent.click(screen.getByRole('button', { name: '展开工作区' }))
    fireEvent.click(screen.getByRole('button', { name: 'bilimi 工作夹' }))
    expect(onSelect).toHaveBeenCalledWith('folder:managed')
    expect(screen.getByRole('button', { name: 'bilimi 工作夹 菜单' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未匹配分类 菜单' })).not.toBeInTheDocument()
  })

  it('offers the separate bilimi workspace group menu actions', () => {
    const onWorkspaceAction = vi.fn()
    render(<FavoriteLibraryNavigation uid="100" collapsedGroups={{ workspace: false }} selectedId="all" onCollapseChange={vi.fn()} onSelect={vi.fn()} onWorkspaceAction={onWorkspaceAction} groups={[
      { id: 'workspace', label: 'bilimi 工作夹', items: [{ id: 'folder:work', label: '工作夹', count: 2, managed: true }] }
    ]} />)

    fireEvent.click(screen.getByRole('button', { name: 'bilimi 工作夹管理菜单' }))
    expect(screen.getByRole('menuitem', { name: '新建工作夹' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '同步全部工作夹' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '删除全部工作夹' }))
    expect(onWorkspaceAction).toHaveBeenCalledWith('delete-all')
  })

  it('keeps current-page selection distinct from partial selection and expands batch actions without count labels', () => {
    const onTogglePage = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={3} selectedCount={1} allCurrentPageSelected={false} onTogglePage={onTogglePage} />)
    expect(screen.getByText('已选 1 项')).toBeInTheDocument()
    expect(screen.getByText('全选')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '全选' }))
    expect(onTogglePage).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    expect(screen.getByRole('button', { name: '复制至' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移动至' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新信息' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '视频总结' }))
    expect(screen.getByRole('menuitem', { name: '转写音频' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '取消转写' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '同步到B站' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '从收藏库删除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '移出 bilimi 工作夹' })).toBeInTheDocument()
  })

  it('keeps more batch actions fixed while its detached popup is outside the toolbar', () => {
    const { container } = render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected onTogglePage={vi.fn()} />)

    const transcribe = screen.getByRole('button', { name: '视频总结' })
    const more = screen.getByRole('button', { name: '更多批量操作' })
    expect(transcribe.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(more)

    const menu = screen.getByRole('menu', { name: '更多批量操作菜单' })
    expect(container.querySelector('[data-testid="favorite-library-toolbar"]')).not.toContainElement(menu)
    expect(screen.getByRole('button', { name: '从收藏库删除' })).toHaveClass('favorite-library__danger-action')
    expect(screen.getByRole('button', { name: '移出 bilimi 工作夹' })).toHaveClass('favorite-library__danger-action')
  })

  it('can disable only cancel-waiting transcription when no selected item is pending', () => {
    render(<FavoriteLibraryToolbar
      pageCount={1}
      selectedCount={1}
      allCurrentPageSelected
      onTogglePage={vi.fn()}
      disabledActions={['cancel-transcribe']}
    />)

    fireEvent.click(screen.getByRole('button', { name: '视频总结' }))
    expect(screen.getByRole('menuitem', { name: '取消转写' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: '转写音频' })).toBeEnabled()
  })

  it('styles expanded danger actions as red text while retaining their blue button frames', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__detail-danger .favorite-library__danger-action { color: #9d2e2e; }')
    expect(styles).not.toContain('.favorite-library__detail-danger .favorite-library__danger-action { color: #9d2e2e; border-color: transparent; background: transparent; }')
    expect(styles).toContain('.favorite-library__detail-danger .favorite-library__danger-action:hover, .favorite-library__detail-danger .favorite-library__danger-action:focus-visible { background: #fff4f3; color: #9d2e2e;')
  })

  it('keeps the batch toolbar on one row when it fits and lets it wrap naturally when constrained', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__batch-actions { flex-wrap: wrap; overflow: visible;')
  })

  it('rotates every batch-menu chevron only while its menu is expanded', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected onTogglePage={vi.fn()} />)

    const copy = screen.getByRole('button', { name: /\u590d\u5236\u81f3/ })
    const move = screen.getByRole('button', { name: /\u79fb\u52a8\u81f3/ })
    const more = screen.getByRole('button', { name: /\u66f4\u591a\u6279\u91cf\u64cd\u4f5c/ })
    fireEvent.click(copy)
    expect(copy).toHaveAttribute('aria-expanded', 'true')
    expect(move).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: '\u53d6\u6d88' }))
    expect(copy).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    expect(styles).toContain(".favorite-library__batch-destination-trigger[aria-expanded='true'] .favorite-library__chevron { transform: rotate(180deg); }")
    expect(styles).toContain('.favorite-library__disclosure-button .favorite-library__chevron { width: 14px; height: 14px; transition: transform 120ms ease; }')
    expect(styles).toContain(".favorite-library__disclosure-button[aria-expanded='true'] .favorite-library__chevron { transform: rotate(180deg); }")
  })

  it('selects real workspace destinations in a detached copy and move menu', () => {
    const onBatchPlacement = vi.fn()
    const { container } = render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected onTogglePage={vi.fn()} onBatchPlacement={onBatchPlacement}
      logicalFolders={[{ id: 'bilimi-logical:games', title: '游戏' }, { id: 'bilimi-logical:music', title: '音乐' }]} />)

    fireEvent.click(screen.getByRole('button', { name: '复制至' }))
    const copyMenu = screen.getByRole('menu', { name: '复制至收藏夹' })
    expect(container.querySelector('[data-testid="favorite-library-toolbar"]')).not.toContainElement(copyMenu)
    expect(screen.getByRole('button', { name: '确认复制' })).toBeDisabled()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '音乐' }))
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }))
    expect(onBatchPlacement).toHaveBeenCalledWith('copy', ['bilimi-logical:games', 'bilimi-logical:music'])
    expect(screen.queryByRole('menu', { name: '复制至收藏夹' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '移动至' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '游戏' }))
    fireEvent.click(screen.getByRole('button', { name: '确认移动' }))
    expect(onBatchPlacement).toHaveBeenCalledWith('move', ['bilimi-logical:games'])
  })

  it('closes detached batch menus on Escape and outside pointer input', () => {
    render(<><button type="button">外部</button><FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected onTogglePage={vi.fn()} /></>)

    fireEvent.click(screen.getByRole('button', { name: '更多批量操作' }))
    expect(screen.getByRole('menu', { name: '更多批量操作菜单' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '更多批量操作菜单' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制至' }))
    expect(screen.getByRole('menu', { name: '复制至收藏夹' })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }))
    expect(screen.queryByRole('menu', { name: '复制至收藏夹' })).not.toBeInTheDocument()
  })

  it('keeps detail visible without a header collapse action and changes the active row without changing list state', () => {
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

  it('uses solid full-width boundaries for the workspace/list footer and vertically centers dense row controls', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__footer-region { min-width: 0; border: 1px solid #c9dcf5; border-top: 1px solid #c9dcf5;')
    expect(styles).toContain('.favorite-library__row-wrap input { flex: 0 0 auto; align-self: center;')
    expect(styles).toContain('.favorite-library__row { display: grid; box-sizing: border-box; align-items: center; grid-template-columns: var(--favorite-library-row-columns); width: 100%; min-height: 64px;')
  })

  it('uses one elevated white list workspace while preserving the blue column header', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('border-bottom: 0; background: #fff; box-shadow: 0 4px 16px rgb(45 91 140 / .10);')
    expect(styles).toContain('.favorite-library__toolbar { display: grid; gap: 6px; margin: 0 0 8px; padding: 8px 10px; border: 1px solid #c9dcf5; border-radius: 10px; background: #fff; }')
    expect(styles).toContain('.favorite-library__footer-region { min-width: 0; border: 1px solid #c9dcf5; border-top: 1px solid #c9dcf5; border-radius: 0 0 12px 12px; background: #fff; box-shadow: 0 8px 16px -8px rgb(45 91 140 / .10); }')
    expect(styles).toContain('border-bottom: 1px solid #c9dcf5; background: #f3f8ff; color: #1e3a8a;')
  })

  it('balances the quiet navigation, primary list, and secondary detail surfaces', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__navigation-groups { grid-column: 1; grid-row: 1 / 3; display: grid; align-content: start; gap: 0; margin: 0; padding: 10px 8px; border: 1px solid rgb(201 220 245 / .72); border-radius: 10px; background: rgb(255 255 255 / .62); box-shadow: none; overflow-x: hidden; overflow-y: auto; }')
    expect(styles).toContain(".favorite-library__navigation-row > button[aria-current='page'] { border-radius: 7px; color: #1d4ed8; background: #e5f0ff; font-weight: 700; }")
    expect(styles).toContain('border: 1px solid #c9dcf5; box-shadow: 0 3px 12px rgb(45 91 140 / .08); border-radius: 12px; overflow: auto; background: #fff;')
    expect(styles).toContain(".favorite-library__status-tags button[data-tone='success'] { border-color: #cce8d7; background: #edf9f2; color: #25613b; }")
    expect(styles).toContain("@container (max-width: 760px) { .favorite-library[data-embedded='true'] .favorite-library__layout[data-embedded-layout='true'] { grid-template-columns: 150px minmax(0, 1fr); }")
  })

  it('keeps all four list data columns visible with detail open or collapsed', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).not.toContain(".favorite-library__layout[data-detail-state='open'] .favorite-library__row-transcription { display: none; }")
    expect(styles).toContain('.favorite-library__row-columns { display: grid; grid-template-columns: 34px var(--favorite-library-row-columns);')
    expect(styles).toContain('.favorite-library__row { display: grid; box-sizing: border-box; align-items: center; grid-template-columns: var(--favorite-library-row-columns);')
  })

  it('limits workspace-collapse motion to the chevron without animating every mounted folder row', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__navigation-group-toggle .favorite-library__chevron { width: 14px; height: 14px; transition: transform 180ms ease-out; }')
    expect(styles).not.toContain('favorite-library-navigation-item-reveal')
    expect(styles).not.toContain('transition: height')
  })

  it('right-aligns every count and its replacement menu at the stable ones-place edge', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__navigation-group-heading { display: flex; align-items: center; min-height: 28px; padding: 0 0 0 8px; }')
    expect(styles).toContain('.favorite-library__navigation-count { grid-area: 1 / 1; color: #64748b; font-variant-numeric: tabular-nums; text-align: right; }')
    expect(styles).toContain('.favorite-library__navigation-trailing-slot { display: grid; flex: 0 0 28px; align-items: center; justify-items: end; min-width: 28px;')
    expect(styles).toContain('.favorite-library__folder-menu-wrap { grid-area: 1 / 1; display: inline-flex; align-self: stretch; }')
  })

  it('does not animate more-information content when reduced motion is requested', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('@media (prefers-reduced-motion: no-preference) { .favorite-library__more-information > div { animation: favorite-library-detail-reveal 180ms ease-out both; } }')
    expect(styles).not.toContain('.favorite-library__more-information > div { margin-top: 7px; animation: favorite-library-detail-reveal')
  })

  it('keeps a manually collapsed detail hidden until the row opens it again', () => {
    render(<FavoriteLibraryDetail title="视频一" collapsed onCollapse={vi.fn()} />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('keeps managed-folder deletion as an explicit choice with a safe local default', async () => {
    const onChoose = vi.fn()
    render(<FavoriteLibraryDialogs managedFolder={{ title: '工作夹', canDeleteRemotely: true }} onManagedFolderChoice={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: '仅从收藏库删除' }))
    await waitFor(() => expect(onChoose).toHaveBeenCalledWith('local'))
    expect(screen.getByRole('button', { name: '删除并同步到B站' })).toBeInTheDocument()
  })

  it('treats managed-folder deletion as a closable modal before execution starts', () => {
    const onClose = vi.fn()
    const { container } = render(<FavoriteLibraryDialogs
      managedFolder={{ title: '工作夹', canDeleteRemotely: true }}
      onManagedFolderChoice={vi.fn()}
      onClose={onClose}
    />)

    const dialog = screen.getByRole('dialog', { name: '删除 工作夹' })
    const actions = Array.from(dialog.querySelectorAll('button')).map((button) => button.textContent)
    expect(actions.slice(0, 3)).toEqual(['取消', '仅从收藏库删除', '删除并同步到B站'])
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveClass('bilimi-modal__dialog', 'favorite-library__dialog-overlay')
    expect(container.querySelector('.favorite-library__dialog-backdrop')).not.toBeInTheDocument()
    expect(dialog.parentElement).toHaveClass('bilimi-modal__viewport')
    expect(screen.getByRole('button', { name: '删除并同步到B站' })).toHaveClass('favorite-library__dialog-remote-action')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
