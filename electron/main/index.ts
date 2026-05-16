import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import {
  getDesktopStore,
  loadAssistantPreferences,
  loadVideoNotes,
  saveAssistantPreferences,
  saveVideoNote,
  type AssistantPreferences
} from './store'
import { sendAssistantActionWhenReady } from './assistantActionSignal'
import { sendAssistantOpenWhenReady } from './assistantOpenSignal'
import { FloatingMenuController } from './floatingMenuController'
import {
  createAssistantPanelPosition,
  createFloatingMenuBounds,
  createFloatingSealDragPosition
} from './floatingSealGeometry'
import { createPreloadScriptPath } from './preloadPath'
import type { AssistantAction, VideoNote } from '../../src/shared/types'

const FLOATING_SEAL_SIZE = 92
const FLOATING_SEAL_MARGIN = 24
const ASSISTANT_PANEL_SIZE = { width: 236, height: 212 }
const FLOATING_SEAL_QUERY = { window: 'floating-seal' }
const FLOATING_MENU_SIZE = { width: 156, height: 214 }
const FLOATING_MENU_QUERY = { window: 'floating-menu' }

let mainWindow: BrowserWindow | null = null
let floatingSealWindow: BrowserWindow | null = null
let floatingSealDragSession: {
  startBounds: Electron.Rectangle
  startCursor: { x: number; y: number }
} | null = null

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

function createRendererSearch(query: Record<string, string> = {}) {
  const params = new URLSearchParams(query)

  return params.toString()
}

function loadRendererWindow(win: BrowserWindow, query: Record<string, string> = {}) {
  const search = createRendererSearch(query)

  if (process.env.ELECTRON_RENDERER_URL) {
    const rendererUrl = new URL(process.env.ELECTRON_RENDERER_URL)
    rendererUrl.search = search
    void win.loadURL(rendererUrl.toString())
  } else {
    void win.loadFile(join(__dirname, '../../renderer/index.html'), {
      search
    })
  }
}

function getFloatingSealBounds() {
  const { workArea } = screen.getPrimaryDisplay()

  return {
    width: FLOATING_SEAL_SIZE,
    height: FLOATING_SEAL_SIZE,
    x: workArea.x + workArea.width - FLOATING_SEAL_SIZE - FLOATING_SEAL_MARGIN,
    y: workArea.y + Math.round(workArea.height * 0.62)
  }
}

function getFloatingMenuBounds() {
  const sealBounds = floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealBounds)

  return createFloatingMenuBounds({
    sealBounds,
    menuSize: FLOATING_MENU_SIZE,
    workArea: display.workArea
  })
}

function createFloatingSealWindow() {
  const seal = new BrowserWindow({
    ...getFloatingSealBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: createPreloadScriptPath(__dirname),
      contextIsolation: true,
      sandbox: false
    }
  })

  seal.setAlwaysOnTop(true, 'floating')
  seal.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  seal.removeMenu()
  seal.on('closed', () => {
    floatingSealWindow = null
  })

  loadRendererWindow(seal, FLOATING_SEAL_QUERY)
  floatingSealWindow = seal

  return seal
}

function createFloatingMenuWindow() {
  const menu = new BrowserWindow({
    ...getFloatingMenuBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: {
      preload: createPreloadScriptPath(__dirname),
      contextIsolation: true,
      sandbox: false
    }
  })

  menu.setAlwaysOnTop(true, 'floating')
  menu.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  menu.removeMenu()
  menu.on('blur', () => floatingMenuController.close())
  menu.on('closed', () => {
    floatingMenuController.clearIfCurrent(menu)
  })

  loadRendererWindow(menu, FLOATING_MENU_QUERY)

  return menu
}

const floatingMenuController = new FloatingMenuController(createFloatingMenuWindow)

function closeFloatingMenuWindow() {
  floatingMenuController.close()
}

function toggleFloatingMenuWindow() {
  floatingMenuController.toggle()
}

function moveFloatingSealBy(deltaX: number, deltaY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  const [x, y] = floatingSealWindow.getPosition()

  floatingSealWindow.setPosition(Math.round(x + deltaX), Math.round(y + deltaY))
}

function startFloatingSealDrag(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  closeFloatingMenuWindow()
  floatingSealDragSession = {
    startBounds: floatingSealWindow.getBounds(),
    startCursor: { x: screenX, y: screenY }
  }
}

function moveFloatingSealTo(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed() || !floatingSealDragSession) {
    return
  }

  const position = createFloatingSealDragPosition({
    ...floatingSealDragSession,
    currentCursor: { x: screenX, y: screenY }
  })

  floatingSealWindow.setPosition(position.x, position.y)
}

function finishFloatingSealDrag() {
  floatingSealDragSession = null
}

function getAssistantOpenPosition() {
  if (!mainWindow || mainWindow.isDestroyed() || !floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return undefined
  }

  return createAssistantPanelPosition({
    mainBounds: mainWindow.getBounds(),
    sealBounds: floatingSealWindow.getBounds(),
    panelSize: ASSISTANT_PANEL_SIZE
  })
}

function openAssistantFromFloatingSeal() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
  sendAssistantOpenWhenReady(mainWindow, {
    position: getAssistantOpenPosition()
  })
}

function runAssistantActionFromFloatingMenu(action: AssistantAction) {
  closeFloatingMenuWindow()

  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show()
  }

  mainWindow.focus()
  sendAssistantActionWhenReady(mainWindow, { action })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: '#1f140f',
    webPreferences: {
      preload: createPreloadScriptPath(__dirname),
      webviewTag: true,
      contextIsolation: true,
      sandbox: false
    }
  })

  mainWindow = win
  installWindowOpenRouting(win)
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  loadRendererWindow(win)

  return win
}

function registerAssistantPreferenceHandlers() {
  ipcMain.handle('assistant:load-preferences', () => loadAssistantPreferences())
  ipcMain.handle('assistant:save-preferences', (_event, preferences: AssistantPreferences) =>
    saveAssistantPreferences(getDesktopStore(), preferences)
  )
  ipcMain.handle('video-notes:load', () => loadVideoNotes(getDesktopStore()))
  ipcMain.handle('video-notes:save', (_event, note: VideoNote) =>
    saveVideoNote(getDesktopStore(), note)
  )
  ipcMain.handle('assistant:open-from-floating-seal', () => openAssistantFromFloatingSeal())
  ipcMain.handle('floating-menu:toggle', () => {
    toggleFloatingMenuWindow()
  })
  ipcMain.handle('floating-menu:run-action', (_event, action: AssistantAction) => {
    runAssistantActionFromFloatingMenu(action)
  })
  ipcMain.on('floating-menu:close', () => {
    closeFloatingMenuWindow()
  })
  ipcMain.on('floating-seal:finish-drag', () => {
    finishFloatingSealDrag()
  })
  ipcMain.on('floating-seal:move-to', (_event, screenX: number, screenY: number) => {
    moveFloatingSealTo(screenX, screenY)
  })
  ipcMain.on('floating-seal:start-drag', (_event, screenX: number, screenY: number) => {
    startFloatingSealDrag(screenX, screenY)
  })
  ipcMain.handle('floating-seal:move-by', (_event, deltaX: number, deltaY: number) => {
    moveFloatingSealBy(deltaX, deltaY)
  })
}

app.whenReady().then(() => {
  registerAssistantPreferenceHandlers()
  createMainWindow()
  createFloatingSealWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
