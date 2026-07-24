import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

vi.mock('./FavoriteLibraryApp', () => ({
  FavoriteLibraryApp: ({
    embedded,
    onAccountChange
  }: {
    embedded?: boolean
    onAccountChange?: (account: { mid: string; nickname?: string } | undefined) => void
  }) => {
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
})

describe('FavoriteLibraryDrawer', () => {
  it('shows the embedded library account beside the drawer title', () => {
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(screen.getByText('小咪')).toBeInTheDocument()
  })

  it('uses the compact product header and restores the prior height after maximizing the drawer', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')

    expect(screen.getByText('小咪收藏库')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪收藏库' })).toBeInTheDocument()
    expect(screen.queryByText('米')).not.toBeInTheDocument()
    expect(screen.queryByText('收藏库')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '拉到最高' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '拉到最高' }))
    expect(drawer).toHaveStyle({ height: '672px' })
    fireEvent.click(screen.getByRole('button', { name: '恢复高度' }))
    expect(drawer).toHaveStyle({ height: '360px' })
  })

  it('does not render until opened', () => {
    const { container } = render(<FavoriteLibraryDrawer open={false} collapsed={false} onClose={vi.fn()} onCollapsedChange={vi.fn()} />)

    expect(container.querySelector('[data-testid="favorite-library-drawer"]')).not.toBeInTheDocument()
  })

  it('keeps the embedded library mounted while its body is collapsed', () => {
    function DrawerHarness() {
      const [collapsed, setCollapsed] = useState(false)
      return <FavoriteLibraryDrawer open collapsed={collapsed} onClose={vi.fn()} onCollapsedChange={setCollapsed} />
    }
    render(<DrawerHarness />)

    expect(screen.getByTestId('favorite-library-content')).toHaveAttribute('data-embedded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))

    expect(screen.getByTestId('favorite-library-content')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: '展开收藏库' })).toBeInTheDocument()
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
})
