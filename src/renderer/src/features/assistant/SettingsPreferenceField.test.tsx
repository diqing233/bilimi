import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsPreferenceCheckbox } from './SettingsPreferenceField'

afterEach(() => vi.unstubAllGlobals())

describe('SettingsPreferenceCheckbox', () => {
  it('updates locally before its owner accepts the persisted value on the next frame', () => {
    const onCommit = vi.fn()
    let paintCallback: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      paintCallback = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    render(<SettingsPreferenceCheckbox checked={false} onCommit={onCommit} aria-label="immediate setting" />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'immediate setting' }))

    expect(screen.getByRole('checkbox', { name: 'immediate setting' })).toBeChecked()
    expect(onCommit).not.toHaveBeenCalled()

    paintCallback?.(16)

    expect(onCommit).toHaveBeenCalledWith(true)
  })

  it('commits only the latest value when it changes repeatedly before paint', () => {
    const onCommit = vi.fn()
    const paintCallbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1
      paintCallbacks.set(nextFrameId, callback)
      return nextFrameId
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => paintCallbacks.delete(frameId)))
    render(<SettingsPreferenceCheckbox checked={false} onCommit={onCommit} aria-label="rapid setting" />)

    const checkbox = screen.getByRole('checkbox', { name: 'rapid setting' })
    fireEvent.click(checkbox)
    fireEvent.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(onCommit).not.toHaveBeenCalled()
    expect(paintCallbacks.size).toBe(1)

    Array.from(paintCallbacks.values())[0]?.(16)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(false)
  })
})
