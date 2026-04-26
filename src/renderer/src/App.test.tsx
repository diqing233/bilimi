import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

describe('App integration', () => {
  it('opens the memorial panel and shows the recommendation summary', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))

    expect(screen.getByText('御前待阅折')).toBeInTheDocument()
    expect(screen.getByText(/此物颇能解闷/)).toBeInTheDocument()
  })

  it('runs assistant actions through the webview bridge and saves updated preferences', async () => {
    const loadPreferences = vi.fn().mockResolvedValue({
      favoritesFolderName: 'Bilimi 内库',
      preferenceCounts: {
        funny: 1,
        knowledge: 0,
        story: 0,
        suspicious: 0
      }
    })
    const savePreferences = vi.fn().mockImplementation(async (preferences) => preferences)

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences,
        savePreferences
      }
    })

    render(<App />)

    const webview = document.getElementById('bilimi-webview') as HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }
    const executeJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['like', 'favorite'],
      missingTargets: [],
      message: '轻赏已入内库。'
    })

    Object.assign(webview, { executeJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(executeJavaScript).toHaveBeenCalledOnce())
    await waitFor(() => expect(savePreferences).toHaveBeenCalled())

    expect(loadPreferences).toHaveBeenCalled()
    expect(savePreferences).toHaveBeenCalledWith({
      favoritesFolderName: 'Bilimi 内库',
      preferenceCounts: {
        funny: 2,
        knowledge: 0,
        story: 0,
        suspicious: 0
      }
    })
  })

  it('opens webview popup URLs as internal browser tabs', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1demo'
          }
        })
      )
    })

    expect(await screen.findByRole('tab', { name: /BV1demo/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelectorAll('webview')).toHaveLength(2)
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1demo'
    )
    expect(screen.getByRole('button', { name: '开折批阅' })).toBeInTheDocument()
  })

  it('opens main-process window-open URLs as internal browser tabs', async () => {
    let openInTabCallback: ((url: string) => void) | undefined

    Object.defineProperty(window, 'bilimiDesktop', {
      configurable: true,
      value: {
        version: '0.1.0',
        loadPreferences: vi.fn(),
        savePreferences: vi.fn(),
        onOpenInTab: vi.fn((callback: (url: string) => void) => {
          openInTabCallback = callback
          return vi.fn()
        })
      }
    })

    render(<App />)

    act(() => {
      openInTabCallback?.('https://www.bilibili.com/video/BV1ipc')
    })

    expect(await screen.findByRole('tab', { name: /BV1ipc/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1ipc'
    )
  })

  it('opens injected video click signals as internal browser tabs', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('page-title-updated', {
          detail: {
            title: `__BILIMI_OPEN_IN_TAB__:${encodeURIComponent(
              'https://www.bilibili.com/video/BV1signal'
            )}`
          }
        })
      )
    })

    expect(await screen.findByRole('tab', { name: /BV1signal/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelector('webview[data-active="true"]')).toHaveAttribute(
      'src',
      'https://www.bilibili.com/video/BV1signal'
    )
    expect(document.querySelector('.seal-button')).toBeInTheDocument()
  })

  it('runs assistant actions against the active internal tab', async () => {
    render(<App />)

    const homeWebview = document.getElementById('bilimi-webview') as HTMLElement
    const homeExecuteJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['home'],
      missingTargets: [],
      message: 'home'
    })
    Object.assign(homeWebview, { executeJavaScript: homeExecuteJavaScript })

    act(() => {
      homeWebview.dispatchEvent(
        new CustomEvent('new-window', {
          detail: {
            url: 'https://www.bilibili.com/video/BV1active'
          }
        })
      )
    })

    await screen.findByRole('tab', { name: /BV1active/ })

    let activeWebview: (HTMLElement & {
      executeJavaScript?: (script: string) => Promise<unknown>
    }) | null = null

    await waitFor(() => {
      activeWebview = document.querySelector(
        'webview[data-active="true"][src="https://www.bilibili.com/video/BV1active"]'
      ) as HTMLElement & {
        executeJavaScript?: (script: string) => Promise<unknown>
      }
      expect(activeWebview).not.toBeNull()
    })

    const activeExecuteJavaScript = vi.fn().mockResolvedValue({
      ok: true,
      steps: ['active'],
      missingTargets: [],
      message: 'active'
    })
    Object.assign(activeWebview!, { executeJavaScript: activeExecuteJavaScript })

    fireEvent.click(screen.getByRole('button', { name: '开折批阅' }))
    fireEvent.click(screen.getByRole('button', { name: '赏' }))

    await waitFor(() => expect(activeExecuteJavaScript).toHaveBeenCalledOnce())
    expect(homeExecuteJavaScript).not.toHaveBeenCalled()
  })
})
