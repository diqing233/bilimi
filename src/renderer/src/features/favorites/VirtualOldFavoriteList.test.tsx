import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VirtualOldFavoriteList } from './VirtualOldFavoriteList'

const items = Array.from({ length: 30_000 }, (_, index) => ({ aid: index + 1 }))

describe('VirtualOldFavoriteList', () => {
  it('mounts only a bounded window for 30,000 stable items', () => {
    render(
      <VirtualOldFavoriteList
        ariaLabel="三万条旧藏"
        items={items}
        itemKey={(item) => item.aid}
        itemHeight={40}
        height={240}
        renderItem={(item) => <button type="button">视频 {item.aid}</button>}
      />
    )

    expect(screen.getByRole('list', { name: '三万条旧藏' }).children.length).toBeLessThan(30)
    expect(screen.getByRole('button', { name: '视频 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '视频 30000' })).not.toBeInTheDocument()
  })

  it('preserves mounted DOM identity and focus when unrelated progress changes', () => {
    const renderItem = vi.fn((item: { aid: number }) => <button type="button">视频 {item.aid}</button>)
    const rendered = render(
      <VirtualOldFavoriteList
        ariaLabel="稳定旧藏"
        items={items}
        itemKey={(item) => item.aid}
        itemHeight={40}
        height={240}
        renderItem={renderItem}
        revision={25}
      />
    )
    const first = screen.getByRole('button', { name: '视频 1' })
    first.focus()

    rendered.rerender(
      <VirtualOldFavoriteList
        ariaLabel="稳定旧藏"
        items={items}
        itemKey={(item) => item.aid}
        itemHeight={40}
        height={240}
        renderItem={renderItem}
        revision={27}
      />
    )

    expect(screen.getByRole('button', { name: '视频 1' })).toBe(first)
    expect(first).toHaveFocus()
  })

  it('moves the mounted window with scroll instead of growing the DOM', () => {
    render(
      <VirtualOldFavoriteList
        ariaLabel="滚动旧藏"
        items={items}
        itemKey={(item) => item.aid}
        itemHeight={40}
        height={240}
        renderItem={(item) => <span>视频 {item.aid}</span>}
      />
    )
    const list = screen.getByRole('list', { name: '滚动旧藏' })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 240 })
    list.scrollTop = 20_000
    fireEvent.scroll(list)

    expect(screen.getByText('视频 501')).toBeInTheDocument()
    expect(list.children.length).toBeLessThan(30)
  })
})
