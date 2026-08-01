import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VirtualOldFavoriteTrack } from './VirtualOldFavoriteTrack'

const items = Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1 }))

describe('VirtualOldFavoriteTrack', () => {
  it('bounds a 30,000-item expanded preview and moves the window horizontally', () => {
    render(
      <VirtualOldFavoriteTrack
        ariaLabel="三万条展开预览"
        items={items}
        itemKey={(item) => item.aid}
        itemWidth={280}
        renderItem={(item) => <article>视频 {item.aid}</article>}
      />
    )
    const track = screen.getByLabelText('三万条展开预览')
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 560 })
    expect(track.querySelectorAll('article').length).toBeLessThan(20)

    track.scrollLeft = 280 * 500
    fireEvent.scroll(track)

    expect(screen.getByText('视频 501')).toBeInTheDocument()
    expect(track.querySelectorAll('article').length).toBeLessThan(20)
    expect(track.querySelector('.favorite-ledger-panel__virtual-track-item')).toHaveStyle({
      height: 'var(--old-favorite-preview-card-height)'
    })
  })
})
