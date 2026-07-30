import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

let favoriteLibraryRenderCount = 0
let favoriteLibraryActiveStates: boolean[] = []

vi.mock('./FavoriteLibraryApp', () => ({
  FavoriteLibraryApp: ({
    embedded,
    active,
    onAccountChange
  }: {
    embedded?: boolean
    active?: boolean
    onAccountChange?: (account: { mid: string; nickname?: string } | undefined) => void
  }) => {
    favoriteLibraryRenderCount += 1
    favoriteLibraryActiveStates.push(active !== false)
    const [selection, setSelection] = useState('all')
    useEffect(() => onAccountChange?.({ mid: '100', nickname: '小咪' }), [onAccountChange])
    return (
      <div data-testid="favorite-library-content" data-embedded={embedded ? 'true' : 'false'}>
        <label>
          收藏库筛选
          <select value={selection} onChange={(event) => setSelection(event.target.value)}>
            <option value="all">全部收藏</option>
            <option value="pending">待处理</option>
          </select>
        </label>
      </div>
    )
  }
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  favoriteLibraryRenderCount = 0
  favoriteLibraryActiveStates = []
})

describe('FavoriteLibraryDrawer', () => {
  it('keeps an explicitly controlled expanded drawer open when its parent rejects collapse', () => {
    vi.useFakeTimers()
    const onCollapsedChange = vi.fn()
    try {
      const view = render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      act(() => { vi.advanceTimersByTime(220) })
      view.rerender(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)

      expect(onCollapsedChange).toHaveBeenCalledWith(true)
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'false')
      expect(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an explicitly controlled collapsed drawer closed when its parent rejects expansion', () => {
    const onCollapsedChange = vi.fn()
    const view = render(<FavoriteLibraryDrawer open collapsed onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)

    fireEvent.click(screen.getByRole('button', { name: '\u5c55\u5f00\u6536\u85cf\u5e93' }))
    view.rerender(<FavoriteLibraryDrawer open collapsed onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)

    expect(onCollapsedChange).toHaveBeenCalledWith(false)
    expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: '\u5c55\u5f00\u6536\u85cf\u5e93' })).toBeInTheDocument()
  })

  it('lets an external controlled value override a pending collapse without a same-value echo loop', () => {
    vi.useFakeTimers()
    const onCollapsedChange = vi.fn()
    try {
      const view = render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsing', 'true')

      view.rerender(<FavoriteLibraryDrawer open collapsed onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'true')
      view.rerender(<FavoriteLibraryDrawer open collapsed onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      act(() => { vi.advanceTimersByTime(220) })

      expect(onCollapsedChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('favorite-library-drawer')).not.toHaveAttribute('data-collapsing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('scopes a compact sans-serif treatment and larger mark to the actual drawer', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styles).toContain('.favorite-library-drawer {\n  position: relative;')
    expect(styles).toContain('font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;')
    expect(styles).toContain('.favorite-library-drawer__brand-mark {\n  width: 24px;\n  height: 24px;')
  })

  it('includes the embedded library account in the drawer title', () => {
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    const account = screen.getByText('（小咪）')
    expect(account.closest('strong')).toHaveTextContent('小咪收藏库（小咪）')
    expect(account).toHaveClass('favorite-library-drawer__account')
  })

  it('uses the compact product header with its SVG expand-and-maximize control', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')

    expect(screen.getByText('（小咪）').closest('strong')).toHaveTextContent('小咪收藏库（小咪）')
    expect(screen.getByRole('img', { name: '小咪收藏库' })).toBeInTheDocument()
    expect(screen.queryByText('米')).not.toBeInTheDocument()
    expect(screen.queryByText('收藏库')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '展开并拉到最高' })).toHaveAttribute('title', '展开并拉到最高')
    expect(screen.getByRole('button', { name: '展开并拉到最高' }).querySelector('svg')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '恢复高度' })).not.toBeInTheDocument()
    expect(drawer).toHaveStyle({ height: '360px' })
  })

  it('gives the actual Drawer maximize SVG an explicit visible icon size', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles.css'), 'utf8')

    expect(styles).toContain('.favorite-library-drawer__actions button svg { width: 16px; height: 16px; display: block;')
  })

  it('starts a collapsed drawer maximize from its current height before one expansion frame', () => {
    vi.useFakeTimers()
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    function DrawerHarness() {
      const [collapsed, setCollapsed] = useState(true)
      return <FavoriteLibraryDrawer open collapsed={collapsed} onClose={vi.fn()} onCollapsedChange={setCollapsed} />
    }
    try {
      render(<DrawerHarness />)

      fireEvent.click(screen.getByRole('button', { name: '展开并拉到最高' }))

      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'false')
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-maximizing', 'true')
      expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '220px' })
      act(() => { vi.advanceTimersByTime(16) })
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'false')
      expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '672px' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the existing drawer expand timing for one maximization animation and ignores a repeated trigger', () => {
    vi.useFakeTimers()
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    const onCollapsedChange = vi.fn()
    try {
      render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      const maximize = screen.getByRole('button', { name: '展开并拉到最高' })

      fireEvent.click(maximize)
      fireEvent.click(maximize)

      expect(maximize).toBeDisabled()
      expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ '--favorite-library-drawer-height-duration': '220ms' })
      act(() => { vi.advanceTimersByTime(220) })
      expect(maximize).not.toBeDisabled()
      expect(onCollapsedChange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('measures a collapsed drawer before its maximize frame so the motion has no height jump', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/features/favorites/FavoriteLibraryDrawer.tsx'), 'utf8')

    expect(source).toContain('drawerRef.current?.getBoundingClientRect().height')
  })

  it('does not render until opened', () => {
    const { container } = render(<FavoriteLibraryDrawer open={false} collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(container.querySelector('[data-testid="favorite-library-drawer"]')).not.toBeInTheDocument()
  })

  it('keeps the drawer content mounted but inert after its closing motion has finished', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(
        <FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />
      )

      rerender(<FavoriteLibraryDrawer open={false} collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-closing', 'true')
      expect(screen.getByTestId('favorite-library-content')).toBeInTheDocument()

      act(() => { vi.advanceTimersByTime(170) })

      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('inert')
      expect(screen.getByTestId('favorite-library-content')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the embedded library mounted while its body is collapsed', () => {
    vi.useFakeTimers()
    function DrawerHarness() {
      const [collapsed, setCollapsed] = useState(false)
      return <FavoriteLibraryDrawer open collapsed={collapsed} onClose={vi.fn()} onCollapsedChange={setCollapsed} />
    }
    try {
      render(<DrawerHarness />)

      expect(screen.getByTestId('favorite-library-content')).toHaveAttribute('data-embedded', 'true')
      fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))

      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsing', 'true')
      act(() => { vi.advanceTimersByTime(170) })

      expect(screen.getByTestId('favorite-library-content')).toBeInTheDocument()
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'true')
      expect(screen.getByRole('button', { name: '展开收藏库' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reverses a pending drawer collapse instead of queueing another transition', () => {
    vi.useFakeTimers()
    function DrawerHarness() {
      const [collapsed, setCollapsed] = useState(false)
      return <FavoriteLibraryDrawer open collapsed={collapsed} onClose={vi.fn()} onCollapsedChange={setCollapsed} />
    }
    try {
      render(<DrawerHarness />)
      fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsing', 'true')

      fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))
      expect(screen.getByTestId('favorite-library-drawer')).not.toHaveAttribute('data-collapsing')
      act(() => { vi.advanceTimersByTime(220) })
      expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'false')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps repository work active during collapse motion and pauses only after it settles', () => {
    vi.useFakeTimers()
    try {
      render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
      expect(favoriteLibraryActiveStates.at(-1)).toBe(true)

      fireEvent.click(screen.getByRole('button', { name: '\u6536\u8d77\u6536\u85cf\u5e93' }))
      expect(favoriteLibraryActiveStates.at(-1)).toBe(true)
      act(() => { vi.advanceTimersByTime(220) })
      expect(favoriteLibraryActiveStates.at(-1)).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: '\u5c55\u5f00\u6536\u85cf\u5e93' }))
      expect(favoriteLibraryActiveStates.at(-1)).toBe(true)
      act(() => { vi.advanceTimersByTime(16) })
      expect(favoriteLibraryActiveStates.filter(Boolean)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps drawer chrome transitions outside the mounted library render boundary', () => {
    vi.useFakeTimers()
    function DrawerHarness() {
      const [collapsed, setCollapsed] = useState(false)
      return <FavoriteLibraryDrawer open collapsed={collapsed} onClose={vi.fn()} onCollapsedChange={setCollapsed} />
    }
    try {
      render(<DrawerHarness />)
      const initialRenders = favoriteLibraryRenderCount

      fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))
      expect(favoriteLibraryRenderCount).toBe(initialRenders)
      act(() => { vi.advanceTimersByTime(220) })
      expect(favoriteLibraryActiveStates.at(-1)).toBe(false)

      fireEvent.click(screen.getByRole('button', { name: '展开收藏库' }))
      expect(favoriteLibraryActiveStates.at(-1)).toBe(true)
      act(() => { vi.advanceTimersByTime(16) })
      const rendersAfterReactivation = favoriteLibraryRenderCount

      fireEvent.click(screen.getByRole('button', { name: '展开并拉到最高' }))
      act(() => { vi.advanceTimersByTime(220) })
      expect(favoriteLibraryRenderCount).toBe(rendersAfterReactivation)
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies its parent when closed', () => {
    const onClose = vi.fn()
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={onClose} onCollapsedChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭收藏库' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to the element that opened the drawer when closed', () => {
    function DrawerHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开收藏库</button>
          <FavoriteLibraryDrawer open={open} collapsed={false} onClose={() => setOpen(false)} onCollapsedChange={vi.fn()} />
        </>
      )
    }

    render(<DrawerHarness />)
    const trigger = screen.getByRole('button', { name: '打开收藏库' })
    trigger.focus()
    fireEvent.click(trigger)
    const close = screen.getByRole('button', { name: '关闭收藏库' })
    close.focus()
    fireEvent.click(close)

    expect(trigger).toHaveFocus()
  })

  it('retains the embedded library state after closing and reopening', () => {
    function DrawerHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开收藏库</button>
          <FavoriteLibraryDrawer open={open} collapsed={false} onClose={() => setOpen(false)} onCollapsedChange={vi.fn()} />
        </>
      )
    }

    render(<DrawerHarness />)
    fireEvent.click(screen.getByRole('button', { name: '打开收藏库' }))
    fireEvent.change(screen.getByLabelText('收藏库筛选'), { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭收藏库' }))
    fireEvent.click(screen.getByRole('button', { name: '打开收藏库' }))

    expect(screen.getByLabelText('收藏库筛选')).toHaveValue('pending')
  })

  it('restores the user-resized height after the drawer remounts', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    const first = render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '384px' })
    first.unmount()

    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '384px' })
  })

  it('clamps a resized height to the available browser workspace', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(drawer).toHaveStyle({ height: '672px' })
  })

  it('updates pointer-drag height without rerendering the embedded library on every move', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })
    fireEvent.pointerDown(handle, { pointerId: 11, clientY: 600 })
    const rendersAfterDragStarted = favoriteLibraryRenderCount
    fireEvent.pointerMove(handle, { pointerId: 11, clientY: 500 })
    fireEvent.pointerMove(handle, { pointerId: 11, clientY: 400 })

    expect(drawer).toHaveStyle({ height: '560px' })
    expect(favoriteLibraryRenderCount).toBe(rendersAfterDragStarted)
  })

  it('keeps drag start and settle outside the mounted library render boundary', () => {
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })
    const initialRenders = favoriteLibraryRenderCount

    fireEvent.pointerDown(handle, { pointerId: 12, clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 12, clientY: 520 })
    fireEvent.pointerUp(handle, { pointerId: 12 })

    expect(favoriteLibraryRenderCount).toBe(initialRenders)
  })

  it('reserves browser stack height with the compact tab bar', () => {
    vi.stubGlobal('innerWidth', 1200)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })

    expect(drawer).toHaveStyle({ height: '676px' })
  })

  it('clamps its initial height to a short browser workspace', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 500)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '276px' })
  })

  it('reclamps its height when the browser workspace becomes shorter', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')

    vi.stubGlobal('innerHeight', 400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(drawer).toHaveStyle({ height: '220px' })
  })

  it('resizes with keyboard controls within the same bounds as pointer dragging', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    expect(handle).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(drawer).toHaveStyle({ height: '384px' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(drawer).toHaveStyle({ height: '360px' })
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(drawer).toHaveStyle({ height: '220px' })
    fireEvent.keyDown(handle, { key: 'End' })
    expect(drawer).toHaveStyle({ height: '672px' })
  })

  it('uses a thin accessible resize target and restores the default height on double click', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(drawer).toHaveStyle({ height: '384px' })
    fireEvent.doubleClick(handle)

    expect(drawer).toHaveStyle({ height: '360px' })
    expect(handle).toHaveClass('favorite-library-drawer__resize-handle')
  })

  it('snaps a drag at the lower boundary into the collapsed drawer state', () => {
    vi.useFakeTimers()
    const onCollapsedChange = vi.fn()
    try {
      render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={onCollapsedChange} />)
      const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

      fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 900 })
      fireEvent.pointerUp(handle, { pointerId: 1 })

      act(() => { vi.advanceTimersByTime(220) })
      expect(onCollapsedChange).toHaveBeenCalledWith(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('notifies its host to pause size repaints while the drawer is resized', () => {
    const onResizeActiveChange = vi.fn()
    render(
      <FavoriteLibraryDrawer
        open
        collapsed={false}
        onClose={vi.fn()}
        onCollapsedChange={vi.fn()}
        onResizeActiveChange={onResizeActiveChange}
      />
    )
    const handle = screen.getByRole('separator')

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 400 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(onResizeActiveChange).toHaveBeenNthCalledWith(1, true)
    expect(onResizeActiveChange).toHaveBeenLastCalledWith(false)
  })
})
