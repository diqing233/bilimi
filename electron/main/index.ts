import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  getDesktopStore,
  loadAssistantPreferences,
  saveAssistantPreferences,
  type AssistantPreferences
} from './store'

function openUrlInRendererTab(win: BrowserWindow, url: string) {
  if (!url || win.isDestroyed()) {
    return
  }

  win.webContents.send('browser:open-in-tab', url)
}

function routeWindowOpenToRendererTab(win: BrowserWindow, url: string) {
  openUrlInRendererTab(win, url)

  return { action: 'deny' as const }
}

function installWindowOpenRouting(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => routeWindowOpenToRendererTab(win, url))

  win.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => routeWindowOpenToRendererTab(win, url))
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: '#1f140f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      contextIsolation: true,
      sandbox: false
    }
  })

  installWindowOpenRouting(win)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../../renderer/index.html'))
  }
}

function registerAssistantPreferenceHandlers() {
  ipcMain.handle('assistant:load-preferences', () => loadAssistantPreferences())
  ipcMain.handle('assistant:save-preferences', (_event, preferences: AssistantPreferences) =>
    saveAssistantPreferences(getDesktopStore(), preferences)
  )
}

app.whenReady().then(() => {
  registerAssistantPreferenceHandlers()
  createMainWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
