import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FavoriteLibraryHeader } from './FavoriteLibraryHeader'

describe('FavoriteLibraryHeader', () => {
  it('uses the existing Xiaomi avatar and exposes the expand-to-top tooltip', () => {
    render(<FavoriteLibraryHeader title="收藏库" account="小咪" />)

    expect(screen.getByLabelText('XiaoMi').querySelector('img')).toHaveAttribute('alt', '')
    expect(screen.getByText('小咪收藏库')).toBeInTheDocument()
    expect(screen.getByText('（小咪）')).toBeInTheDocument()
    expect(screen.getByTitle('展开并拉到最高').querySelector('svg')).toHaveAttribute('width', '16')
  })

  it('keeps the expand-to-top action idempotent while the window is already maximized', () => {
    render(<FavoriteLibraryHeader title="收藏库" />)

    expect(screen.getByRole('button', { name: '最大化' })).toHaveAttribute('title', '展开并拉到最高')
    expect(screen.queryByRole('button', { name: '还原' })).not.toBeInTheDocument()
  })
})
