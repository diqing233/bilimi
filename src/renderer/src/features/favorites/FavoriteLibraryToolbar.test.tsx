import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryColumnMenu, FavoriteLibraryMultiSelectColumnMenu, FavoriteLibraryToolbar } from './FavoriteLibraryToolbar'

describe('FavoriteLibraryMultiSelectColumnMenu', () => {
  afterEach(() => vi.useRealTimers())

  it('updates search text immediately and applies only the settled query', async () => {
    vi.useFakeTimers()
    const onSearchChange = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={0} allCurrentPageSelected={false} onTogglePage={vi.fn()} onSearchChange={onSearchChange} deferSearchChange />)
    const search = screen.getByRole('searchbox')

    fireEvent.change(search, { target: { value: '原' } })
    fireEvent.change(search, { target: { value: '原神' } })

    expect(search).toHaveValue('原神')
    expect(onSearchChange).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(onSearchChange).toHaveBeenCalledTimes(1)
    expect(onSearchChange).toHaveBeenCalledWith('原神')
  })

  it('keeps the page selector and selected count aligned on one row', () => {
    const { container } = render(<FavoriteLibraryToolbar pageCount={17} selectedCount={0} allCurrentPageSelected={false} onTogglePage={vi.fn()} />)

    expect(container.querySelector('.favorite-library__selection-summary')).toHaveTextContent('已选 0 项')
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')
    expect(styles).toContain('.favorite-library__selection-controls { display: inline-flex; align-items: center;')
    expect(styles).toContain('white-space: nowrap;')
  })

  it('opens the shared document dialog directly without a download-format submenu', () => {
    const onBatchAction = vi.fn()
    const onDownload = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected onTogglePage={vi.fn()} onBatchAction={onBatchAction} onBatchDownload={onDownload} />)

    expect(screen.queryByRole('button', { name: '转写音频' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '转写操作' }))
    expect(screen.getByRole('menuitem', { name: '转写音频' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '取消转写' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: '导出文稿' }))
    expect(screen.queryByRole('menu', { name: '导出文稿格式' })).not.toBeInTheDocument()
    expect(onDownload).toHaveBeenCalledOnce()
    expect(onBatchAction).not.toHaveBeenCalledWith('download-documents')
  })

  it('keeps batch actions visible but disabled until a video is selected', () => {
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={0} allCurrentPageSelected={false} onTogglePage={vi.fn()} batchDisabled />)

    const summary = screen.getByRole('button', { name: '转写操作' })
    const more = screen.getByRole('button', { name: '更多批量操作' })
    expect(summary).toBeVisible()
    expect(summary).toBeDisabled()
    expect(summary).toHaveAttribute('title', '请先勾选视频')
    expect(more).toBeVisible()
    expect(more).toBeDisabled()
    expect(more).toHaveAttribute('title', '请先勾选视频')
  })

  it('starts selected-video reorganization from a dedicated direct action', () => {
    const onBatchAction = vi.fn()
    render(<FavoriteLibraryToolbar
      pageCount={2}
      selectedCount={2}
      allCurrentPageSelected={false}
      onTogglePage={vi.fn()}
      onBatchAction={onBatchAction}
    />)

    fireEvent.click(screen.getByRole('button', { name: '重新整理' }))

    expect(onBatchAction).toHaveBeenCalledWith('reorganize')
  })

  it('hides the more trigger when the current source has no more-menu actions', () => {
    render(<FavoriteLibraryToolbar
      pageCount={1}
      selectedCount={1}
      allCurrentPageSelected={false}
      onTogglePage={vi.fn()}
      allowedActions={['copy', 'refresh', 'reorganize', 'transcribe', 'cancel-transcribe', 'download-documents']}
    />)

    expect(screen.queryByRole('button', { name: '更多批量操作' })).not.toBeInTheDocument()
  })

  it('keeps a 30000-folder destination menu DOM bounded', () => {
    render(<FavoriteLibraryToolbar
      pageCount={1}
      selectedCount={1}
      allCurrentPageSelected={false}
      onTogglePage={vi.fn()}
      logicalFolders={Array.from({ length: 30_000 }, (_, index) => ({ id: `${index}`, title: `folder ${index}` }))}
    />)

    fireEvent.click(screen.getByRole('button', { name: /复制至/ }))

    expect(screen.getByRole('menu', { name: '复制至收藏夹' }).querySelectorAll('label').length).toBeLessThan(100)
  })

  it('reaches an unmounted destination by keyboard without expanding the DOM window', () => {
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected={false} onTogglePage={vi.fn()}
      logicalFolders={Array.from({ length: 30_000 }, (_, index) => ({ id: `${index}`, title: `folder ${index}` }))} />)
    fireEvent.click(screen.getByRole('button', { name: /复制至/ }))
    const first = screen.getByRole('menuitemcheckbox', { name: 'folder 0' })

    fireEvent.keyDown(first, { key: 'End' })

    expect(screen.getByRole('menuitemcheckbox', { name: 'folder 29999' })).toHaveFocus()
    expect(screen.getByRole('menu', { name: '复制至收藏夹' }).querySelectorAll('label').length).toBeLessThan(100)
  })

  it('opens destinations from the keyboard with one focus target per item and toggles with Space or Enter', () => {
    const onBatchPlacement = vi.fn()
    render(<FavoriteLibraryToolbar pageCount={1} selectedCount={1} allCurrentPageSelected={false} onTogglePage={vi.fn()}
      logicalFolders={[{ id: 'one', title: 'folder one' }, { id: 'two', title: 'folder two' }]}
      onBatchPlacement={onBatchPlacement} />)
    const trigger = screen.getByRole('button', { name: /复制至/ })

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const first = screen.getByRole('menuitemcheckbox', { name: 'folder one' })
    expect(first).toHaveFocus()
    expect(first.querySelector('input')).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(first, { key: ' ' })
    expect(first).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    const second = screen.getByRole('menuitemcheckbox', { name: 'folder two' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second, { key: 'Enter' })
    expect(second).toHaveAttribute('aria-checked', 'true')
  })

  it('always exposes the same three video-summary menu items in order', () => {
    render(<FavoriteLibraryToolbar
      pageCount={1}
      selectedCount={1}
      allCurrentPageSelected
      onTogglePage={vi.fn()}
      allowedActions={['copy', 'download-documents']}
    />)

    fireEvent.click(screen.getByRole('button', { name: '转写操作' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['转写音频', '取消转写', '导出文稿'])
    expect(items[0]).toBeDisabled()
    expect(items[1]).toBeDisabled()
    expect(items[2]).toBeEnabled()
  })

  it('keeps the batch transcription trigger visually aligned with the neighboring batch actions', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')

    expect(styles).toContain('.favorite-library__batch-actions .video-summary-menu__trigger { min-height: 30px; padding: 5px 8px; border: 1px solid #cbdcf5; border-radius: 6px; color: #1e3a8a; background: #fff; cursor: pointer; font: inherit; white-space: nowrap; }')
    expect(styles).toContain('.favorite-library__detail-action-row .video-summary-menu__trigger')
    expect(styles).toContain('.favorite-library__detail-action-row .video-summary-menu__trigger { min-height: 28px; padding: 4px 7px; border: 1px solid #cbdcf5; border-radius: 6px; background: #fff; color: #1e3a8a; cursor: pointer; font-size: 12px; white-space: nowrap; }')
    expect(styles).not.toContain('.favorite-library__batch-actions .video-summary-menu__trigger,\n.favorite-library__detail-action-row .video-summary-menu__trigger')
  })

  it('uses a rotating disclosure chevron for the video-name and status column menus', () => {
    render(<><FavoriteLibraryColumnMenu label="视频名称" value="updated-desc" options={[{ value: 'updated-desc', label: '最近更新' }]} onChange={vi.fn()} /><FavoriteLibraryColumnMenu label="状态" value="all" options={[{ value: 'all', label: '全部' }]} onChange={vi.fn()} /></>)

    const videoName = screen.getByRole('button', { name: '视频名称' })
    const status = screen.getByRole('button', { name: '状态' })
    expect(videoName.querySelector('.favorite-library__chevron')).toBeInTheDocument()
    expect(status.querySelector('.favorite-library__chevron')).toBeInTheDocument()
    expect(videoName.querySelector('.favorite-library__sort-arrows')).not.toBeInTheDocument()
    fireEvent.click(videoName)
    expect(videoName).toHaveAttribute('aria-expanded', 'true')
    expect(status).toHaveAttribute('aria-expanded', 'false')
  })

  it('toggles multiple transcription conditions and closes on Escape or an outside click', () => {
    const onChange = vi.fn()
    function Harness() {
      const [values, setValues] = useState<('completed' | 'failed')[]>([])
      return <><FavoriteLibraryMultiSelectColumnMenu label="转写筛选" values={values} options={[
      { value: 'completed', label: '已转写' }, { value: 'failed', label: '失败' }
      ]} onChange={(next) => { onChange(next); setValues(next as ('completed' | 'failed')[]) }} /><button type="button">外部</button></>
    }
    render(<Harness />)

    const trigger = screen.getByRole('button', { name: '转写筛选' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '已转写' }))
    expect(onChange).toHaveBeenCalledWith(['completed'])
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '失败' }))
    expect(onChange).toHaveBeenLastCalledWith(['completed', 'failed'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keeps its portal menu within the narrow viewport gutter', () => {
    const viewportWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 170 })
    try {
      render(<FavoriteLibraryMultiSelectColumnMenu label="转写筛选" values={[]} options={[{ value: 'completed', label: '已转写' }]} onChange={vi.fn()} />)
      const trigger = screen.getByRole('button', { name: '转写筛选' })
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ left: 164, width: 14, bottom: 30 } as DOMRect)
      fireEvent.click(trigger)
      expect(screen.getByRole('menu', { name: '转写筛选' })).toHaveStyle({ left: '8px' })
      const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryApp.css'), 'utf8')
      expect(styles).toContain('min-width: 0; width: min(164px, calc(100vw - 16px));')
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth })
    }
  })
})
