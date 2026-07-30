import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualFavoriteLibraryList } from './VirtualFavoriteLibraryList'

const items = Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1, title: `Video ${index + 1}` }))

afterEach(() => vi.useRealTimers())

describe('VirtualFavoriteLibraryList', () => {
  it('keeps live scrolling local and publishes only the settled position', async () => {
    vi.useFakeTimers()
    const onScrollTopChange = vi.fn()
    render(<VirtualFavoriteLibraryList ariaLabel="Settled scroll" items={items} itemHeight={40} height={240} onScrollTopChange={onScrollTopChange} />)
    const list = screen.getByRole('list', { name: 'Settled scroll' })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 240 })

    list.scrollTop = 400
    fireEvent.scroll(list)
    list.scrollTop = 800
    fireEvent.scroll(list)

    expect(onScrollTopChange).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(onScrollTopChange).toHaveBeenCalledTimes(1)
    expect(onScrollTopChange).toHaveBeenCalledWith(800)
  })

  it('uses a compact 64px minimum row height that can grow for scaled or multi-line content', () => {
    render(<VirtualFavoriteLibraryList ariaLabel="Default height" items={items.slice(0, 1)} />)

    expect(screen.getByRole('listitem')).toHaveStyle({ minHeight: '64px' })
    expect(screen.getByRole('listitem')).not.toHaveStyle({ height: '64px' })
  })

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

  it('restores an account-scoped scroll offset and reports later user scrolling', async () => {
    const onScrollTopChange = vi.fn()
    render(
      <VirtualFavoriteLibraryList
        ariaLabel="Restored results"
        items={items}
        itemHeight={40}
        height={240}
        scrollTop={20_000}
        onScrollTopChange={onScrollTopChange}
      />
    )
    const list = screen.getByRole('list', { name: 'Restored results' })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 240 })

    await waitFor(() => expect(list.scrollTop).toBe(20_000))
    expect(screen.getByText('Video 501')).toBeInTheDocument()
    fireEvent.scroll(list)
    expect(onScrollTopChange).not.toHaveBeenCalled()

    list.scrollTop = 20_040
    fireEvent.scroll(list)

    await waitFor(() => expect(onScrollTopChange).toHaveBeenLastCalledWith(20_040))
  })

  it('clamps a restored offset when the current folder page is shorter than its prior scope', async () => {
    const onScrollTopChange = vi.fn()
    render(
      <VirtualFavoriteLibraryList
        ariaLabel="Short restored results"
        items={items.slice(0, 17)}
        itemHeight={74}
        height={600}
        scrollTop={20_000}
        onScrollTopChange={onScrollTopChange}
      />
    )

    const list = screen.getByRole('list', { name: 'Short restored results' })
    await waitFor(() => expect(list.scrollTop).toBeLessThanOrEqual(658))
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.getByText('Video 12')).toBeInTheDocument()
    expect(onScrollTopChange).toHaveBeenCalledWith(658)
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

  it('marks only the final item so a row border is removed once', () => {
    render(<VirtualFavoriteLibraryList ariaLabel="Bordered results" items={items.slice(0, 2)} renderItem={(item) => <div className="favorite-library__row-wrap">{item.title}</div>} />)

    expect(screen.getByText('Video 1').closest('[role="listitem"]')).not.toHaveAttribute('data-last-item')
    expect(screen.getByText('Video 2').closest('[role="listitem"]')).toHaveAttribute('data-last-item', 'true')
  })
})
