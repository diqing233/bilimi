import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  FavoriteLedgerEnableButton,
  FavoriteLedgerEnableSummary,
  FavoriteLedgerEnableStore
} from './favoriteLedgerEnableStore'

describe('FavoriteLedgerEnableStore', () => {
  it('rerenders only the target button and the compact summary', () => {
    const store = new FavoriteLedgerEnableStore([
      { id: 'first', enabled: false, operable: true },
      { id: 'second', enabled: false, operable: true }
    ])
    const firstRender = vi.fn()
    const secondRender = vi.fn()
    const summaryRender = vi.fn()
    const parentRender = vi.fn()

    function Button({ id, onRender }: { id: string; onRender: () => void }) {
      onRender()
      return <FavoriteLedgerEnableButton store={store} id={id}>{({ enabled, toggle }) =>
        <button type="button" aria-pressed={enabled} onClick={toggle}>{id}</button>
      }</FavoriteLedgerEnableButton>
    }
    function Harness() {
      const renders = useRef(0)
      renders.current += 1
      parentRender()
      return <div data-testid="parent" data-renders={renders.current}>
        <Button id="first" onRender={firstRender} />
        <Button id="second" onRender={secondRender} />
        <FavoriteLedgerEnableSummary store={store}>{({ enabledCount }) => {
          summaryRender()
          return <span>enabled:{enabledCount}</span>
        }}</FavoriteLedgerEnableSummary>
      </div>
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'first' }))

    expect(screen.getByRole('button', { name: 'first' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('enabled:1')).toBeInTheDocument()
    expect(parentRender).toHaveBeenCalledTimes(1)
    expect(firstRender).toHaveBeenCalledTimes(1)
    expect(secondRender).toHaveBeenCalledTimes(1)
    expect(summaryRender).toHaveBeenCalledTimes(2)
  })

  it('keeps 101 rapid toggles synchronous and exposes the final intent', () => {
    const store = new FavoriteLedgerEnableStore([{ id: 'music', enabled: false, operable: true }])
    for (let index = 0; index < 101; index += 1) store.toggle('music')
    expect(store.isEnabled('music')).toBe(true)
  })

  it('restores one failed mutation without visiting unrelated entries', () => {
    const store = new FavoriteLedgerEnableStore([
      { id: 'first', enabled: true, operable: true },
      { id: 'second', enabled: false, operable: true }
    ])
    const secondListener = vi.fn()
    store.subscribeId('second', secondListener)

    expect(store.setEnabled('first', false)).toBe(true)

    expect(store.isEnabled('first')).toBe(false)
    expect(store.isEnabled('second')).toBe(false)
    expect(secondListener).not.toHaveBeenCalled()
  })
})
