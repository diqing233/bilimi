import Store from 'electron-store'
import { normalizeAssistantSidebarWidthPx } from '../../src/shared/assistantSidebarWidth'

export type AssistantSidebarLayoutStoreLike = {
  get: () => unknown
  set: (widthPx: number | null) => void
}

type AssistantSidebarLayoutStoreOptions = {
  store: AssistantSidebarLayoutStoreLike
  loadLegacyWidth?: () => unknown
}

type AssistantSidebarLayoutState = {
  assistantSidebarWidthPx?: number | null
}

type AssistantSidebarLayout = ReturnType<typeof createAssistantSidebarLayoutStore>

type AssistantSidebarLayoutIpcOptions = {
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: { sender: { id: number } }, value?: unknown) => unknown
    ) => void
  }
  getMainWindow: () => {
    isDestroyed: () => boolean
    webContents: {
      id: number
      send: (channel: string, value: number | null) => void
    }
  } | null
  isTrustedSender: (senderId: number) => boolean
  layout: AssistantSidebarLayout
}

export function createAssistantSidebarLayoutStore({
  store,
  loadLegacyWidth
}: AssistantSidebarLayoutStoreOptions) {
  function normalize(value: unknown): number | null {
    return value === null ? null : normalizeAssistantSidebarWidthPx(value)
  }

  return {
    load(): number | null {
      const stored = store.get()
      const normalizedStored = normalize(stored)
      if (stored !== undefined) return normalizedStored

      const legacyWidth = normalize(loadLegacyWidth?.())
      store.set(legacyWidth)
      return legacyWidth
    },
    save(widthPx: unknown): number | null {
      const normalized = normalize(widthPx)
      store.set(normalized)
      return normalized
    }
  }
}

export function createElectronAssistantSidebarLayoutStore(loadLegacyWidth: () => unknown) {
  const store = new Store<AssistantSidebarLayoutState>({ name: 'layout-preferences' })
  return createAssistantSidebarLayoutStore({
    store: {
      get: () => store.get('assistantSidebarWidthPx'),
      set: (widthPx) => store.set('assistantSidebarWidthPx', widthPx)
    },
    loadLegacyWidth
  })
}

export function registerAssistantSidebarLayoutIpc({
  ipcMain,
  getMainWindow,
  isTrustedSender,
  layout
}: AssistantSidebarLayoutIpcOptions) {
  function requireMainWindowSender(event: { sender: { id: number } }) {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || !isTrustedSender(event.sender.id)) {
      throw new Error('Assistant sidebar layout request came from an untrusted renderer.')
    }
    return mainWindow
  }

  ipcMain.handle('layout:assistant-sidebar-width-load', async (event) => {
    requireMainWindowSender(event)
    return layout.load()
  })
  ipcMain.handle('layout:assistant-sidebar-width-save', async (event, widthPx) => {
    const mainWindow = requireMainWindowSender(event)
    const saved = layout.save(widthPx)
    mainWindow.webContents.send('layout:assistant-sidebar-width-changed', saved)
    return saved
  })
}
