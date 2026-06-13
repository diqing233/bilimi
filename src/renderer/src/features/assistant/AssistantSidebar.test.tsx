import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssistantSidebar } from './AssistantSidebar'

function installDesktopApi() {
  Object.defineProperty(window, 'bilimiDesktop', {
    configurable: true,
    value: {
      version: '0.1.0',
      loadPreferences: vi.fn(),
      onAssistantSnapshotChanged: vi.fn(),
      requestAssistantSnapshot: vi.fn().mockResolvedValue(undefined),
      savePreferences: vi.fn()
    }
  })
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

  it('collapses to the icon rail and expands from a tab icon', async () => {
    installDesktopApi()

    render(<AssistantSidebar />)

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))

    expect(screen.getByRole('complementary', { name: 'Bilimi 侧边栏' })).toHaveAttribute(
      'data-collapsed',
      'true'
    )
    expect(screen.queryByRole('tab', { name: '批阅' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '打开掌库' }))

    expect(await screen.findByRole('tab', { name: '掌库' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})
