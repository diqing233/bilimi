import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FavoriteLibraryFooter } from './FavoriteLibraryFooter'

describe('FavoriteLibraryFooter', () => {
  const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints)
  const nextPage = chinese(0x4e0b, 0x4e00, 0x9875)
  const previousPage = chinese(0x4e0a, 0x4e00, 0x9875)
  const allFavorites = chinese(0x5168, 0x90e8, 0x6536, 0x85cf)
  const selectedVideo = `${chinese(0x5df2, 0x9009)}：${chinese(0x6d4b, 0x8bd5, 0x89c6, 0x9891)}`
  it('keeps pagination in the middle of three persistent footer regions', () => {
    const onNextPage = vi.fn()
    render(<FavoriteLibraryFooter hasNextPage onNextPage={onNextPage} />)

    expect(screen.getByTestId('favorite-library-footer')).toHaveAttribute('data-footer-split', 'true')
    expect(screen.getByTestId('favorite-library-footer-left')).toBeInTheDocument()
    expect(screen.getByTestId('favorite-library-footer-middle')).toContainElement(screen.getByRole('button', { name: nextPage }))
    expect(screen.getByTestId('favorite-library-footer-right')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: nextPage }))
    expect(onNextPage).toHaveBeenCalledOnce()
  })

  it('offers previous-page navigation when cursor history exists', () => {
    const onPreviousPage = vi.fn()
    render(<FavoriteLibraryFooter hasPreviousPage hasNextPage={false} onPreviousPage={onPreviousPage} onNextPage={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: previousPage }))
    expect(onPreviousPage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: nextPage })).not.toBeInTheDocument()
  })

  it('shows scope, page range, page size, and detail context in aligned footer regions', () => {
    render(<FavoriteLibraryFooter
      hasPreviousPage
      hasNextPage
      pageNumber={2}
      pageSize={50}
      visibleCount={50}
      totalCount={120}
      scopeLabel={allFavorites}
      detailLabel={selectedVideo}
      onNextPage={() => undefined}
    />)

    expect(screen.getByTestId('favorite-library-footer-left')).toHaveTextContent(`${allFavorites} · 120 ${chinese(0x9879)}`)
    expect(screen.getByTestId('favorite-library-footer-middle')).toHaveTextContent('51-100 / 120')
    expect(screen.getByTestId('favorite-library-footer-middle')).toHaveTextContent(`${chinese(0x7b2c)} 2 ${chinese(0x9875)}`)
    expect(screen.getByTestId('favorite-library-footer-right')).toHaveTextContent(selectedVideo)
  })
})
