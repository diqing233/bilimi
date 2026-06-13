import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingMenuApp } from './FloatingMenuApp'

describe('FloatingMenuApp', () => {
  it('renders the system menu actions', () => {
    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu: vi.fn(),
        runFloatingMenuAction: vi.fn()
      }
    })

    render(<FloatingMenuApp />)

    expect(screen.getByRole('menu', { name: 'Bilimi 悬浮动作' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '赞' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '藏' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '赐' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '评' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '阅' })).toBeInTheDocument()
  })

  it('dispatches a menu action through the desktop bridge', async () => {
    const runFloatingMenuAction = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu: vi.fn(),
        runFloatingMenuAction
      }
    })

    render(<FloatingMenuApp />)

    fireEvent.click(screen.getByRole('menuitem', { name: '藏' }))

    await waitFor(() => expect(runFloatingMenuAction).toHaveBeenCalledWith('藏'))
  })

  it('asks for coin count before dispatching 赐 from the system menu', async () => {
    const runFloatingMenuAction = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu: vi.fn(),
        runFloatingMenuAction
      }
    })

    render(<FloatingMenuApp />)

    fireEvent.click(screen.getByRole('menuitem', { name: '赐' }))

    expect(screen.getByText('陛下意欲赐几枚铜钱？')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '赐两枚' }))

    await waitFor(() =>
      expect(runFloatingMenuAction).toHaveBeenCalledWith(
        '赐',
        expect.objectContaining({ coinCount: 2 })
      )
    )
  })

  it('closes the menu from the close button', () => {
    const closeFloatingMenu = vi.fn()

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        closeFloatingMenu,
        runFloatingMenuAction: vi.fn()
      }
    })

    render(<FloatingMenuApp />)

    fireEvent.click(screen.getByRole('button', { name: '收起悬浮菜单' }))

    expect(closeFloatingMenu).toHaveBeenCalledOnce()
  })
})
