import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryDetail } from './FavoriteLibraryDetail'

describe('FavoriteLibraryDetail', () => {
  it('lets the user resize a visible detail panel without removing its collapse action', () => {
    render(<FavoriteLibraryDetail title="测试视频" onCollapse={vi.fn()}>内容</FavoriteLibraryDetail>)

    const detail = screen.getByRole('complementary', { name: '视频详情' })
    const handle = screen.getByRole('separator', { name: '调整视频详情宽度' })
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 720 })
    fireEvent.pointerUp(handle, { pointerId: 1 })

    expect(detail).toHaveStyle({ '--favorite-detail-width': '380px' })
    expect(screen.getByRole('button', { name: '收起详情' })).toBeInTheDocument()
  })
})
