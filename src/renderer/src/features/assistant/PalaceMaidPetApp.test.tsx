import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    generateDeepSeek: vi.fn().mockResolvedValue({
      kind: 'pet-chat',
      message: 'This page looks worth watching.'
    }),
    closeAssistantPet: vi.fn(),
    resizeFloatingSealByStep: vi.fn(),
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
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it('shows a close prompt on right click and closes after the prompt is clicked', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.contextMenu(screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' }))

    expect(api.closeAssistantPet).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '关闭宠物' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭宠物' }))

    expect(api.closeAssistantPet).toHaveBeenCalledOnce()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
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

  it('sends direct Xiao Mi chat messages through DeepSeek', async () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Xiao Mi chat' }))
    fireEvent.change(screen.getByLabelText('Talk to Xiao Mi'), {
      target: { value: 'watch this page' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(api.generateDeepSeek).toHaveBeenCalledWith({
      kind: 'pet-chat',
      messages: [{ role: 'user', content: 'watch this page' }]
    })
    expect(await screen.findByText('This page looks worth watching.')).toBeInTheDocument()
  })

  it('shows an alert when Xiao Mi chat fails', async () => {
    installDesktopApi({
      generateDeepSeek: vi.fn().mockRejectedValue(new Error('DeepSeek failed.'))
    })

    render(<PalaceMaidPetApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Xiao Mi chat' }))
    fireEvent.change(screen.getByLabelText('Talk to Xiao Mi'), {
      target: { value: 'watch this page' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek failed.')
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

  it('shows foot-side step controls that resize the floating pet without restoring the main window', () => {
    const api = installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' })
    const resizeControls = screen.getByRole('group', {
      name: '调整小mi大小',
      hidden: true
    })

    expect(resizeControls).toHaveAttribute('data-visible', 'false')

    fireEvent.pointerEnter(pet)

    expect(resizeControls).toHaveAttribute('data-visible', 'true')

    const shrinkButton = screen.getByRole('button', { name: '缩小小mi' })
    const growButton = screen.getByRole('button', { name: '放大小mi' })

    fireEvent.click(shrinkButton)
    fireEvent.click(growButton)

    expect(api.resizeFloatingSealByStep).toHaveBeenNthCalledWith(1, -1)
    expect(api.resizeFloatingSealByStep).toHaveBeenNthCalledWith(2, 1)
    expect(api.finishFloatingSealDrag).not.toHaveBeenCalled()
    expect(api.restoreMainWindowFromPet).not.toHaveBeenCalled()
  })

  it('keeps the speech bubble outside the resizable pet button', () => {
    installDesktopApi()

    const { container } = render(<PalaceMaidPetApp />)

    const bubble = container.querySelector('.palace-maid-pet__bubble')
    const pet = container.querySelector('.palace-maid-pet')

    expect(bubble).toBeInTheDocument()
    expect(pet).toBeInTheDocument()
    expect(bubble?.parentElement).toHaveClass('palace-maid-pet-shell')
    expect(pet).not.toContainElement(bubble as HTMLElement)
  })

  it('keeps the resize controls outside the pet button so resizing does not press the pet', () => {
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' })
    fireEvent.pointerEnter(pet)

    const shrinkButton = screen.getByRole('button', { name: '缩小小mi' })

    fireEvent.pointerDown(shrinkButton, {
      clientX: 332,
      clientY: 212,
      screenX: 1232,
      screenY: 712,
      pointerId: 2
    })

    expect(pet).toHaveAttribute('data-pressed', 'false')
  })

  it('keeps resize controls visible briefly after leaving the pet so they can be reached', () => {
    vi.useFakeTimers()
    installDesktopApi()

    render(<PalaceMaidPetApp />)

    const pet = screen.getByRole('button', { name: '打开 Bilimi，小mi在这里' })
    const resizeControls = screen.getByRole('group', {
      name: '调整小mi大小',
      hidden: true
    })

    fireEvent.pointerEnter(pet)
    fireEvent.pointerLeave(pet)

    expect(resizeControls).toHaveAttribute('data-visible', 'true')

    act(() => {
      vi.advanceTimersByTime(350)
    })

    expect(resizeControls).toHaveAttribute('data-visible', 'false')
  })
})
