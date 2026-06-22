import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantSidebar } from './AssistantSidebar'

function installDesktopApi() {
  let openAssistantCallback: (() => void) | undefined
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(),
      onOpenAssistant: vi.fn((callback) => {
        openAssistantCallback = callback
        return vi.fn()
      }),
      onAssistantSnapshotChanged: vi.fn(),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn()
    }
  })

  return {
    openAssistant: () => openAssistantCallback?.()
  }
}

describe('AssistantSidebar', () => {
  it('opens by default with the 批阅 tab selected', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('uses the left boundary collapse control without rendering a rail column', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    expect(screen.queryByRole('navigation', { name: '侧边栏收合控制' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '折叠侧边栏' })).toHaveClass(
      'assistant-sidebar__collapse-button'
    )
    expect(screen.getByText('折叠')).toHaveClass('assistant-sidebar__collapse-label')
    expect(screen.getByRole('img', { name: '小咪收起侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )
    expect(screen.queryByRole('button', { name: '打开批阅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开札记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开掌库' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '小咪展开侧栏' })).toHaveClass(
      'assistant-sidebar__collapse-pet'
    )

    expect(screen.getByText('展开')).toHaveClass('assistant-sidebar__collapse-label')

    fireEvent.click(screen.getByRole('button', { name: '展开侧边栏' }))

    expect(await screen.findByRole('tab', { name: '批阅' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('expands the sidebar when the floating pet asks to open the assistant', async () => {
    const api = installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(await screen.findByRole('button', { name: '折叠侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )

    act(() => {
      api.openAssistant()
    })

    expect(await screen.findByRole('tab', { name: '批阅' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'false'
    )
  })
})
