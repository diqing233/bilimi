import { describe, expect, it, vi } from 'vitest'
import {
  createAssistantSidebarLayoutStore,
  registerAssistantSidebarLayoutIpc,
  type AssistantSidebarLayoutStoreLike
} from './assistantSidebarLayoutStore'

function createStore(initial: unknown): AssistantSidebarLayoutStoreLike & {
  set: ReturnType<typeof vi.fn>
} {
  let value = initial
  return {
    get: vi.fn(() => value),
    set: vi.fn((next: number | null) => {
      value = next
    })
  }
}

describe('assistant sidebar layout store', () => {
  it('loads and normalizes a dedicated sidebar width', () => {
    const store = createStore(900)
    const layout = createAssistantSidebarLayoutStore({ store })

    expect(layout.load()).toBe(486)
  })

  it('saves only the normalized width in the dedicated store', () => {
    const store = createStore(null)
    const layout = createAssistantSidebarLayoutStore({ store })

    expect(layout.save(260)).toBe(320)
    expect(store.set).toHaveBeenCalledWith(320)
  })

  it('preserves a null reset', () => {
    const store = createStore(384)
    const layout = createAssistantSidebarLayoutStore({ store })

    expect(layout.save(null)).toBeNull()
    expect(store.set).toHaveBeenCalledWith(null)
  })

  it('seeds the dedicated store from the legacy preference once', () => {
    const store = createStore(undefined)
    const loadLegacyWidth = vi.fn(() => 420)
    const layout = createAssistantSidebarLayoutStore({ store, loadLegacyWidth })

    expect(layout.load()).toBe(420)
    expect(store.set).toHaveBeenCalledWith(420)
    expect(loadLegacyWidth).toHaveBeenCalledTimes(1)

    expect(layout.load()).toBe(420)
    expect(loadLegacyWidth).toHaveBeenCalledTimes(1)
  })

  it('seeds a legacy null so later loads do not revisit the shared preference store', () => {
    const store = createStore(undefined)
    const loadLegacyWidth = vi.fn(() => null)
    const layout = createAssistantSidebarLayoutStore({ store, loadLegacyWidth })

    expect(layout.load()).toBeNull()
    expect(store.set).toHaveBeenCalledWith(null)
    expect(layout.load()).toBeNull()
    expect(loadLegacyWidth).toHaveBeenCalledTimes(1)
  })

  it('serves focused IPC only to trusted assistant windows and notifies the main window', async () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, value?: unknown) => unknown>()
    const send = vi.fn()
    const store = createStore(360)
    const layout = createAssistantSidebarLayoutStore({ store })

    registerAssistantSidebarLayoutIpc({
      ipcMain: {
        handle: vi.fn((channel, handler) => handlers.set(channel, handler))
      },
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { id: 7, send }
      }),
      isTrustedSender: (senderId) => senderId === 7 || senderId === 9,
      layout
    })

    await expect(handlers.get('layout:assistant-sidebar-width-load')?.({ sender: { id: 7 } })).resolves.toBe(360)
    await expect(handlers.get('layout:assistant-sidebar-width-save')?.({ sender: { id: 7 } }, 280)).resolves.toBe(320)
    expect(send).toHaveBeenCalledWith('layout:assistant-sidebar-width-changed', 320)
    expect(store.set).toHaveBeenCalledWith(320)

    await expect(handlers.get('layout:assistant-sidebar-width-save')?.({ sender: { id: 9 } }, null)).resolves.toBeNull()
    expect(send).toHaveBeenLastCalledWith('layout:assistant-sidebar-width-changed', null)

    await expect(handlers.get('layout:assistant-sidebar-width-load')?.({ sender: { id: 8 } })).rejects.toThrow(
      'untrusted renderer'
    )
  })
})
