import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  NoteSelectionCheckbox,
  NoteSelectionStore,
  NoteSelectionSubscriber
} from './noteSelectionStore'

describe('NoteSelectionStore', () => {
  it('updates only the target checkbox and the compact selection subscriber', () => {
    const firstRender = vi.fn()
    const secondRender = vi.fn()
    const summaryRender = vi.fn()

    function Checkbox({ id, label, onRender }: { id: string; label: string; onRender: () => void }) {
      onRender()
      return <NoteSelectionCheckbox store={store} id={id} label={label} />
    }

    function Summary() {
      summaryRender()
      return <NoteSelectionSubscriber store={store}>{({ count }) => <span>selected:{count}</span>}</NoteSelectionSubscriber>
    }

    function Harness() {
      const parentRenderCount = useRef(0)
      parentRenderCount.current += 1
      return <div data-testid="parent" data-renders={parentRenderCount.current}>
        <Checkbox id="first" label="first" onRender={firstRender} />
        <Checkbox id="second" label="second" onRender={secondRender} />
        <Summary />
      </div>
    }

    const store = new NoteSelectionStore()
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'first' }))

    expect(screen.getByRole('checkbox', { name: 'first' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'second' })).not.toBeChecked()
    expect(screen.getByText('selected:1')).toBeInTheDocument()
    expect(screen.getByTestId('parent')).toHaveAttribute('data-renders', '1')
    expect(firstRender).toHaveBeenCalledTimes(1)
    expect(secondRender).toHaveBeenCalledTimes(1)
    expect(summaryRender).toHaveBeenCalledTimes(1)
  })

  it('keeps rapid repeated input synchronous and exposes the final intent', () => {
    const store = new NoteSelectionStore()
    render(<NoteSelectionCheckbox store={store} id="archive" label="archive" />)
    const checkbox = screen.getByRole('checkbox', { name: 'archive' })

    for (let index = 0; index < 101; index += 1) fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(store.getSelectedIds()).toEqual(['archive'])
  })
})
