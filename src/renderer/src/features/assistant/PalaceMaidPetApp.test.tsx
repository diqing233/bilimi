import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantPetState } from './petState'

vi.mock('./LayeredPetRenderer', () => ({
  LayeredPetRenderer: ({
    petState,
    clickReactionSignal,
    petStyle
  }: {
    petState: AssistantPetState
    clickReactionSignal: number
    petStyle: string
  }) => (
    <span
      data-testid="mock-layered-pet"
      data-pet-state={petState}
      data-click-reaction-signal={clickReactionSignal}
      data-pet-style={petStyle}
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
    resizeFloatingSeal: vi.fn(),
    startFloatingSealDrag: vi.fn(),
    startFloatingSealResize: vi.fn(),
    ...overrides
  } satisfies Partial<Window['bilimiDesktop']>

  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: api
  })

  return api
}

describe('PalaceMaidPetApp', () => {
  it('restores the main Bilimi window when clicked', async () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' }))

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

    expect(screen.getByText('小mi待机')).toBeInTheDocument()

    act(() => {
      stateChanged?.('working')
    })

    expect(screen.getByText('小mi忙碌中')).toBeInTheDocument()
    expect(screen.getByText('小mi正在处理，马上回来。')).toBeInTheDocument()
  })

  it('loads the persisted pet style for the floating pet renderer', async () => {
    installDesktopApi({
      loadPreferences: vi.fn().mockResolvedValue({
        favoritesFolderName: 'Bilimi',
        favoriteLedgers: [],
        ledgerPromptDismissed: true,
        preferenceCounts: {},
        petStyle: 'classic'
      })
    })

    render(<PalaceMaidPetApp />)

    expect(await screen.findByTestId('mock-layered-pet')).toHaveAttribute(
      'data-pet-style',
      'classic'
    )
  })

  it('refreshes the floating pet renderer when assistant preferences change', async () => {
    let preferencesChanged: ((preferences: Parameters<Window['bilimiDesktop']['savePreferences']>[0]) => void) | undefined
    installDesktopApi({
      onAssistantPreferencesChanged: vi.fn((callback) => {
        preferencesChanged = callback
        return vi.fn()
      })
    })

    render(<PalaceMaidPetApp />)

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-style', 'big-head')

    act(() => {
      preferencesChanged?.({
        favoritesFolderName: 'Bilimi',
        favoriteLedgers: [],
        ledgerPromptDismissed: true,
        preferenceCounts: {},
        petStyle: 'classic'
      })
    })

    expect(screen.getByTestId('mock-layered-pet')).toHaveAttribute('data-pet-style', 'classic')
  })

  it('keeps dragging from restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' })

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

  it('shows a bottom-right resize handle that resizes the floating pet without restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const resizeHandle = screen.getByRole('button', { name: '调整小mi大小' })

    fireEvent.pointerDown(resizeHandle, {
      clientX: 332,
      clientY: 212,
      screenX: 1232,
      screenY: 712,
      pointerId: 2
    })
    fireEvent.pointerMove(resizeHandle, {
      clientX: 354,
      clientY: 238,
      screenX: 1254,
      screenY: 738,
      pointerId: 2
    })
    fireEvent.pointerUp(resizeHandle, {
      clientX: 354,
      clientY: 238,
      screenX: 1254,
      screenY: 738,
      pointerId: 2
    })
    fireEvent.click(resizeHandle)

    expect(api.startFloatingSealResize).toHaveBeenCalledWith(1232, 712)
    expect(api.resizeFloatingSeal).toHaveBeenCalledWith(1254, 738)
    expect(api.finishFloatingSealDrag).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('keeps the resize handle outside the pet button so resizing does not press the pet', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' })
    const resizeHandle = screen.getByRole('button', { name: '调整小mi大小' })

    fireEvent.pointerDown(resizeHandle, {
      clientX: 332,
      clientY: 212,
      screenX: 1232,
      screenY: 712,
      pointerId: 2
    })

    expect(pet).toHaveAttribute('data-pressed', 'false')
  })
})
