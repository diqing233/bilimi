import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantPetState } from './petState'

vi.mock('./LayeredPetRenderer', () => ({
  LayeredPetRenderer: ({
    petState,
    clickReactionSignal
  }: {
    petState: AssistantPetState
    clickReactionSignal: number
  }) => (
    <span
      data-testid="mock-layered-pet"
      data-pet-state={petState}
      data-click-reaction-signal={clickReactionSignal}
    />
  )
}))

import { PalaceMaidPetApp } from './PalaceMaidPetApp'

function installDesktopApi(overrides: Partial<Window['bilimiDesktop']> = {}) {
  const api = {
    version: '0.1.0',
    finishFloatingSealDrag: vi.fn(),
    onAssistantPetStateChanged: vi.fn(),
    restoreMainWindowFromPet: vi.fn().mockResolvedValue(undefined),
    savePreferences: vi.fn(),
    loadPreferences: vi.fn(),
    startFloatingSealDrag: vi.fn(),
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('PalaceMaidPetApp', () => {
  it('restores the main Bilimi window when clicked', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi' }))

    expect(api.restoreMainWindowFromPet).toHaveBeenCalledOnce()
    expect(window.bilimiDesktop.toggleFloatingAssistant).toBeUndefined()
    expect(window.bilimiDesktop.toggleFloatingMenu).toBeUndefined()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '1'
    )
  })

  it('renders pet state changes from the desktop shell', () => {
    let stateChanged: ((state: AssistantPetState) => void) | undefined
    installDesktopApi({
      onAssistantPetStateChanged: vi.fn((callback) => {
        stateChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByText('待机')).toBeInTheDocument()

    act(() => {
      stateChanged?.('working')
    })

    expect(screen.getByText('处理中')).toBeInTheDocument()
    expect(screen.getByText('奴婢正在传旨，稍候即回。')).toBeInTheDocument()
  })

  it('keeps dragging from restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi' })

    fireEvent.pointerDown(pet, { clientX: 10, clientY: 10, screenX: 110, screenY: 210, pointerId: 1 })
    fireEvent.pointerMove(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.pointerUp(pet, { clientX: 28, clientY: 22, screenX: 128, screenY: 222, pointerId: 1 })
    fireEvent.click(pet)

    expect(api.startFloatingSealDrag).toHaveBeenCalledWith(110, 210)
    expect(api.finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute(
      'data-click-reaction-signal',
      '0'
    )
  })
})
