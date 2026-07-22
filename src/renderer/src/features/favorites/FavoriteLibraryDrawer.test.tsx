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
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)

    expect(screen.getByText('当前账号：小咪（UID：100）')).toBeInTheDocument()
  })

  it('does not render until opened', () => {
    const { container } = render(<FavoriteLibraryDrawer open={false} onClose={vi.fn()} />)

    expect(container.querySelector('[data-testid="favorite-library-drawer"]')).not.toBeInTheDocument()
  })

  it('keeps the embedded library mounted while its body is collapsed', () => {
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)

    expect(screen.getByTestId('favorite-library-content')).toHaveAttribute('data-embedded', 'true')
    fireEvent.click(screen.getByRole('button', { name: '收起收藏库' }))

    expect(screen.getByTestId('favorite-library-content')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-drawer')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: '展开收藏库' })).toBeInTheDocument()
  })

  it('notifies its parent when closed', () => {
    const onClose = vi.fn()
    render(<FavoriteLibraryDrawer open onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '关闭收藏库' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to the element that opened the drawer when closed', () => {
    function DrawerHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>打开收藏库</button>
          <FavoriteLibraryDrawer open={open} onClose={() => setOpen(false)} />
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
          <FavoriteLibraryDrawer open={open} onClose={() => setOpen(false)} />
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
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
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
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })

    expect(drawer).toHaveStyle({ height: '676px' })
  })

  it('clamps its initial height to a short browser workspace', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 500)
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)

    expect(screen.getByTestId('favorite-library-drawer')).toHaveStyle({ height: '276px' })
  })

  it('reclamps its height when the browser workspace becomes shorter', () => {
    vi.stubGlobal('innerWidth', 1440)
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
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
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
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
