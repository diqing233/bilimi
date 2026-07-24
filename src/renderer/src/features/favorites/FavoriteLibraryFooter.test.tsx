import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryFooter } from './FavoriteLibraryFooter'

describe('FavoriteLibraryFooter', () => {
  it('keeps pagination in the middle of three persistent footer regions', () => {
    const onNextPage = vi.fn()
    render(<FavoriteLibraryFooter hasNextPage onNextPage={onNextPage} />)

    expect(screen.getByTestId('favorite-library-footer')).toHaveAttribute('data-footer-split', 'true')
    expect(screen.getByTestId('favorite-library-footer-left')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-footer-middle')).toContainElement(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByTestId('favorite-library-footer-right')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onNextPage).toHaveBeenCalledOnce()
  })

  it('offers previous-page navigation when cursor history exists', () => {
    const onPreviousPage = vi.fn()
    render(<FavoriteLibraryFooter hasPreviousPage hasNextPage={false} onPreviousPage={onPreviousPage} onNextPage={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(onPreviousPage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '下一页' })).not.toBeInTheDocument()
  })
})
