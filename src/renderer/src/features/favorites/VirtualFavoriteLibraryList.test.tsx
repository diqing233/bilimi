import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'

const items = Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}` }))

describe('VirtualFavoriteLibraryList', () => {
  it('renders fewer than 100 list items for a 30,000-item page', () => {
    render(<VirtualFavoriteLibraryList ariaLabel="Favorite library results" items={items} />)

    expect(screen.getAllByRole('listitem').length).toBeLessThan(100)
    expect(screen.getByText('Video 1')).toBeInTheDocument()
    expect(screen.queryByText('Video 30000')).not.toBeInTheDocument()
  })

  it('moves the rendered window on scroll while retaining a bounded DOM', () => {
    render(<VirtualFavoriteLibraryList ariaLabel="Favorite library results" items={items} itemHeight={40} height={240} />)
    const list = screen.getByRole('list', { name: 'Favorite library results' })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 240 })
    list.scrollTop = 20_000
    fireEvent.scroll(list)

    expect(screen.getByText('Video 501')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(100)
  })

  it('only invokes thumbnail and row rendering for visible rows', () => {
    const visibleAids: number[] = []
    render(
      <VirtualFavoriteLibraryList
        ariaLabel="Lazy thumbnails"
        items={items}
        renderItem={(item) => {
          visibleAids.push(item.aid)
          return <span>{item.title}</span>
        }}
      />
    )

    expect(visibleAids.length).toBeLessThan(100)
    expect(visibleAids).toContain(1)
    expect(visibleAids).not.toContain(30_000)
  })
})
