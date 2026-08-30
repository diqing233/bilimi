import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PetHoverShortcutId } from '@shared/petHoverShortcuts'
import { PetHoverShortcutSettings } from './PetHoverShortcutSettings'
import { createPetHoverShortcutFieldStore } from './petHoverShortcutFieldStore'

describe('PetHoverShortcutSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('paints the local order before committing on the next frame', () => {
    const onCommit = vi.fn()
    render(<PetHoverShortcutSettings value={['like', 'coin']} onCommit={onCommit} />)

    fireEvent.click(screen.getByRole('button', { name: /表/ }))

    expect(screen.getByRole('button', { name: /表/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /表/ }).querySelector('.assistant-settings__hover-shortcut-mark')).toHaveTextContent('3')
    expect(onCommit).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(16))
    expect(onCommit).toHaveBeenCalledWith(['like', 'coin', 'comment'])
  })

  it('merges rapid clicks into the latest visible shortcut order', () => {
    const onCommit = vi.fn()
    render(<PetHoverShortcutSettings value={['like', 'coin']} onCommit={onCommit} />)

    fireEvent.click(screen.getByRole('button', { name: /表/ }))
    fireEvent.click(screen.getByRole('button', { name: /^赏 / }))
    fireEvent.click(screen.getByRole('button', { name: /转/ }))

    expect(onCommit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(16))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(['coin', 'comment', 'transcribe'])
  })

  it('discards a pending local commit when a newer authoritative value arrives', () => {
    const onCommit = vi.fn()
    const { rerender } = render(
      <PetHoverShortcutSettings value={['like', 'coin']} onCommit={onCommit} />
    )

    fireEvent.click(screen.getByRole('button', { name: /表/ }))
    rerender(<PetHoverShortcutSettings value={['favorite']} onCommit={onCommit} />)
    act(() => vi.advanceTimersByTime(16))

    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /藏/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^赏 / })).toHaveAttribute('aria-pressed', 'false')
  })

  it('applies an authoritative subscription update without waiting for a parent render', () => {
    const onCommit = vi.fn()
    const fieldStore = createPetHoverShortcutFieldStore(['like', 'coin'])
    render(<PetHoverShortcutSettings
      fieldStore={fieldStore}
      onCommit={onCommit}
    />)

    fireEvent.click(screen.getByRole('button', { name: /表/ }))
    expect(onCommit).toHaveBeenCalledWith(['like', 'coin', 'comment'])
    onCommit.mockClear()
    act(() => fieldStore.set(['favorite']))
    act(() => vi.advanceTimersByTime(16))

    expect(onCommit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /藏/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps a pending field-store commit across an unrelated parent value rerender', () => {
    const onCommit = vi.fn()
    const fieldStore = createPetHoverShortcutFieldStore(['like', 'coin'])
    const { rerender } = render(
      <PetHoverShortcutSettings value={['like', 'coin']} fieldStore={fieldStore} onCommit={onCommit} />
    )

    fireEvent.click(screen.getByRole('button', { name: /^赏 / }))
    rerender(
      <PetHoverShortcutSettings value={['like', 'coin']} fieldStore={fieldStore} onCommit={onCommit} />
    )
    act(() => vi.advanceTimersByTime(16))

    expect(onCommit).toHaveBeenCalledWith(['coin'])
  })

  it('does not lose a visible shortcut change when the settings region unmounts immediately', () => {
    const onCommit = vi.fn()
    const fieldStore = createPetHoverShortcutFieldStore(['like', 'coin'])
    const view = render(
      <PetHoverShortcutSettings fieldStore={fieldStore} onCommit={onCommit} />
    )

    fireEvent.click(screen.getByRole('button', { name: /^赏 / }))
    view.unmount()

    expect(onCommit).toHaveBeenCalledWith(['coin'])
  })

  it('reads the retained authoritative value after being unmounted during an update', () => {
    const onCommit = vi.fn()
    const fieldStore = createPetHoverShortcutFieldStore(['like', 'coin'])
    const first = render(
      <PetHoverShortcutSettings fieldStore={fieldStore} onCommit={onCommit} />
    )

    first.unmount()
    fieldStore.set(['favorite'])
    render(<PetHoverShortcutSettings fieldStore={fieldStore} onCommit={onCommit} />)

    expect(screen.getByRole('button', { name: /藏/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^赏 / })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does not render an unrelated settings region after commits across multiple frames', () => {
    const unrelatedRender = vi.fn()
    const onCommit = vi.fn()

    function UnrelatedSettings() {
      unrelatedRender()
      return <div>unrelated settings</div>
    }

    function Harness() {
      return <>
        <PetHoverShortcutSettings value={['like', 'coin']} onCommit={onCommit} />
        <UnrelatedSettings />
      </>
    }

    render(<Harness />)
    expect(unrelatedRender).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /表/ }))
    act(() => vi.advanceTimersByTime(16))
    fireEvent.click(screen.getByRole('button', { name: /转/ }))
    act(() => vi.advanceTimersByTime(16))

    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(unrelatedRender).toHaveBeenCalledTimes(1)
  })
})
