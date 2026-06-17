import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LayeredPetRenderer } from './LayeredPetRenderer'

describe('LayeredPetRenderer', () => {
  it('renders persistent state layers with hidden decorative images', () => {
    render(<LayeredPetRenderer petState="working" clickReactionSignal={0} />)

    const pet = screen.getByTestId('layered-pet')

    expect(pet).toHaveAttribute('data-pet-state', 'working')
    expect(pet).toHaveAttribute('data-pet-motion', 'working')
    expect(pet).toHaveAttribute('data-pet-effect', 'working-stars')
    expect(screen.getByTestId('layered-pet-character')).toHaveAttribute(
      'src',
      expect.stringContaining('working.png')
    )
    expect(screen.getAllByRole('presentation')).toHaveLength(2)
  })

  it('plays clicked transient when the click signal changes and then returns to persistent state', () => {
    vi.useFakeTimers()

    const { rerender } = render(<LayeredPetRenderer petState="idle" clickReactionSignal={0} />)

    rerender(<LayeredPetRenderer petState="idle" clickReactionSignal={1} />)

    const pet = screen.getByTestId('layered-pet')
    expect(pet).toHaveAttribute('data-pet-transient', 'clicked')
    expect(pet).toHaveAttribute('data-pet-motion', 'clicked')
    expect(pet).toHaveAttribute('data-pet-effect', 'click-hearts')
    expect(screen.getByTestId('layered-pet-character')).toHaveAttribute(
      'src',
      expect.stringContaining('clicked.png')
    )

    act(() => {
      vi.advanceTimersByTime(850)
    })

    expect(pet).not.toHaveAttribute('data-pet-transient')
    expect(pet).toHaveAttribute('data-pet-motion', 'idle')
    expect(pet).toHaveAttribute('data-pet-effect', 'none')

    vi.useRealTimers()
  })

  it('keeps the newest persistent state after a click transient expires', () => {
    vi.useFakeTimers()

    const { rerender } = render(<LayeredPetRenderer petState="idle" clickReactionSignal={0} />)
    rerender(<LayeredPetRenderer petState="idle" clickReactionSignal={1} />)
    rerender(<LayeredPetRenderer petState="error" clickReactionSignal={1} />)

    const pet = screen.getByTestId('layered-pet')

    act(() => {
      vi.advanceTimersByTime(850)
    })

    expect(pet).toHaveAttribute('data-pet-state', 'error')
    expect(pet).toHaveAttribute('data-pet-motion', 'error')
    expect(pet).toHaveAttribute('data-pet-effect', 'error-sweat')

    vi.useRealTimers()
  })

  it('shows a fallback when any image layer fails to load', () => {
    render(<LayeredPetRenderer petState="hint" clickReactionSignal={0} />)

    fireEvent.error(screen.getByTestId('layered-pet-character'))

    expect(screen.getByText('Bilimi')).toBeInTheDocument()
    expect(screen.getByTestId('layered-pet')).toHaveAttribute('data-asset-error', 'true')
  })
})
