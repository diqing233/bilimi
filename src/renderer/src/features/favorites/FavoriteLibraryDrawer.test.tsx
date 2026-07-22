import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDrawer } from './FavoriteLibraryDrawer'

vi.mock('./FavoriteLibraryApp', () => ({
  FavoriteLibraryApp: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="favorite-library-content" data-embedded={embedded ? 'true' : 'false'}>
      收藏库内容
    </div>
  )
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FavoriteLibraryDrawer', () => {
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

  it('clamps a resized height to the available browser workspace', () => {
    vi.stubGlobal('innerHeight', 900)
    render(<FavoriteLibraryDrawer open onClose={vi.fn()} />)
    const drawer = screen.getByTestId('favorite-library-drawer')
    const handle = screen.getByRole('separator', { name: '调整收藏库高度' })

    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 600 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 10 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(drawer).toHaveStyle({ height: '720px' })
  })
})
