import { app, BrowserWindow, ipcMain, screen, session } from 'electron'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDesktopStore,
  loadAssistantPreferences,
  loadVideoNoteArchives,
  loadVideoNotes,
  saveVideoNoteArchiveVersion,
  saveAssistantPreferences,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  saveVideoNote,
  type AssistantPreferences
} from './store'
import { requestAssistantRuntimeWhenReady } from './assistantRuntimeSignal'
import { sendAssistantSnapshotChangedWhenReady } from './assistantSnapshotSignal'
import { FloatingMenuController } from './floatingMenuController'
import { FloatingSealDragController } from './floatingSealDragController'
import { createMainWindowOptions } from './mainWindowOptions'
import { restoreMainWindowFromPet } from './mainWindowRestore'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'
import {
  configureFloatingMenuWindow,
  createFloatingMenuWindowOptions
} from './floatingMenuWindowOptions'
import { keepMainWindowTitle } from './windowTitleGuard'
import {
  createFloatingAssistantBounds,
  createFloatingHostBounds,
  createFloatingMenuBounds,
  createFloatingSealDragPosition,
  createFloatingSealResizeBounds,
  createFloatingVisualBounds
} from './floatingSealGeometry'
import { createPreloadScriptPath } from './preloadPath'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import type {
  AssistantAction,
  AssistantAutomationResult,
  VideoAudioTranscriptionRequest,
  VideoNote
} from '../../src/shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantSnapshot,
  FloatingAssistantActionOptions
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type { AssistantPetState } from '../../src/renderer/src/features/assistant/petState'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../../src/renderer/src/features/favorites/favoriteLedgerPreview'

const FLOATING_SEAL_VISUAL_SIZE = { width: 300, height: 232 }
const FLOATING_SEAL_SHADOW_PADDING = 28
const FLOATING_SEAL_MARGIN = 24
const FLOATING_SEAL_QUERY = { window: 'floating-seal' }
const FLOATING_MENU_VISUAL_SIZE = { width: 184, height: 248 }
const FLOATING_MENU_SHADOW_PADDING = 28
const FLOATING_MENU_QUERY = { window: 'floating-menu' }
const FLOATING_ASSISTANT_SIZE = { width: 460, height: 680 }
const FLOATING_ASSISTANT_QUERY = { window: 'floating-assistant' }

let mainWindow: BrowserWindow | null = null
let floatingSealWindow: BrowserWindow | null = null
let assistantPetState: AssistantPetState = 'idle'
let floatingSealResizeSession: {
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
  const visualBounds = {
    width: FLOATING_SEAL_VISUAL_SIZE.width,
    height: FLOATING_SEAL_VISUAL_SIZE.height,
    x: workArea.x + workArea.width - FLOATING_SEAL_VISUAL_SIZE.width - FLOATING_SEAL_MARGIN,
    y: workArea.y + Math.round(workArea.height * 0.62)
  }

  return createFloatingHostBounds({
    visualBounds,
    padding: FLOATING_SEAL_SHADOW_PADDING
  })
}

function getFloatingMenuBounds() {
  const sealHostBounds = floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealHostBounds)
  const sealVisualBounds = createFloatingVisualBounds({
    hostBounds: sealHostBounds,
    padding: FLOATING_SEAL_SHADOW_PADDING
  })
  const visualBounds = createFloatingMenuBounds({
    sealBounds: sealVisualBounds,
    menuSize: FLOATING_MENU_VISUAL_SIZE,
    workArea: display.workArea
  })

  return createFloatingHostBounds({
    visualBounds,
    padding: FLOATING_MENU_SHADOW_PADDING
  })
}

function getFloatingAssistantBounds() {
  const sealHostBounds = floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealHostBounds)
  const sealVisualBounds = createFloatingVisualBounds({
    hostBounds: sealHostBounds,
    padding: FLOATING_SEAL_SHADOW_PADDING
  })

  return createFloatingAssistantBounds({
    sealBounds: sealVisualBounds,
    workspaceSize: FLOATING_ASSISTANT_SIZE,
    workArea: display.workArea
  })
}

function createFloatingSealWindow() {
  const seal = new BrowserWindow(
    createFloatingSealWindowOptions(getFloatingSealBounds(), createPreloadScriptPath(__dirname))
  )

  seal.setAlwaysOnTop(true, 'floating')
  seal.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  seal.removeMenu()
  seal.on('closed', () => {
    floatingSealWindow = null
  })

  loadRendererWindow(seal, FLOATING_SEAL_QUERY)
  seal.webContents.once('did-finish-load', () => {
    sendAssistantPetState()
    seal.show()
  })
  floatingSealWindow = seal

  return seal
}

function sendAssistantPetState() {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  floatingSealWindow.webContents.send('assistant-pet:state-changed', assistantPetState)
}

function setAssistantPetState(state: AssistantPetState) {
  assistantPetState = state
  sendAssistantPetState()
}

function sendAssistantPreferencesChanged(preferences: AssistantPreferences) {
  const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]

  for (const target of targets) {
    if (!target || target.isDestroyed()) {
      continue
    }

    target.webContents.send('assistant:preferences-changed', preferences)
  }
}

function createFloatingMenuWindow() {
  const menu = new BrowserWindow(
    createFloatingMenuWindowOptions({
      bounds: getFloatingMenuBounds(),
      preload: createPreloadScriptPath(__dirname)
    })
  )

  configureFloatingMenuWindow(menu, () => {
    floatingMenuController.clearIfCurrent(menu)
  })

  loadRendererWindow(menu, FLOATING_MENU_QUERY)

  return menu
}

const floatingMenuController = new FloatingMenuController(createFloatingMenuWindow)

function createFloatingAssistantWindow() {
  const assistant = new BrowserWindow({
    ...getFloatingAssistantBounds(),
    title: '',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: createPreloadScriptPath(__dirname),
      contextIsolation: true,
      sandbox: false
    }
  })

  assistant.setAlwaysOnTop(true, 'floating')
  assistant.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  assistant.removeMenu()
  assistant.on('closed', () => {
    floatingAssistantController.clearIfCurrent(assistant)
  })

  loadRendererWindow(assistant, FLOATING_ASSISTANT_QUERY)

  return assistant
}

const floatingAssistantController = new FloatingMenuController(createFloatingAssistantWindow)

const floatingSealDragController = new FloatingSealDragController({
  getCursorPoint: () => screen.getCursorScreenPoint(),
  getSealBounds: () => floatingSealWindow?.getBounds() ?? getFloatingSealBounds(),
  moveSealTo: (position) => {
    if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
      return
    }

    floatingSealWindow.setPosition(position.x, position.y)
  }
})

function closeFloatingMenuWindow() {
  floatingMenuController.close()
}

function closeFloatingAssistantWindow() {
  floatingAssistantController.close()
}

function notifyFloatingAssistantSnapshotChanged() {
  const assistant = floatingAssistantController.getWindow()

  if (!assistant || assistant.isDestroyed()) {
    return
  }

  sendAssistantSnapshotChangedWhenReady(assistant)
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
  closeFloatingAssistantWindow()
  floatingSealResizeSession = null
  floatingSealDragController.start({ x: screenX, y: screenY })
}

function startFloatingSealResize(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  closeFloatingMenuWindow()
  closeFloatingAssistantWindow()
  floatingSealDragController.finish()
  floatingSealResizeSession = {
    startBounds: floatingSealWindow.getBounds(),
    startCursor: { x: screenX, y: screenY }
  }
}

function resizeFloatingSeal(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed() || !floatingSealResizeSession) {
    return
  }

  floatingSealWindow.setBounds(
    createFloatingSealResizeBounds({
      ...floatingSealResizeSession,
      currentCursor: { x: screenX, y: screenY }
    })
  )
}

function moveFloatingSealTo(screenX: number, screenY: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  const position = createFloatingSealDragPosition({
    startBounds: floatingSealWindow.getBounds(),
    startCursor: screen.getCursorScreenPoint(),
    currentCursor: { x: screenX, y: screenY }
  })

  floatingSealWindow.setPosition(position.x, position.y)
}

function finishFloatingSealDrag() {
  floatingSealDragController.finish()
  floatingSealResizeSession = null
}

function restoreMainWindowForPet() {
  mainWindow = restoreMainWindowFromPet({
    createMainWindow,
    mainWindow
  })
}

let assistantRuntimeRequestIndex = 0

function createAssistantRuntimeRequestId() {
  assistantRuntimeRequestIndex += 1
  return `assistant-runtime-${Date.now()}-${assistantRuntimeRequestIndex}`
}

function ensureMainWindowForAssistantRuntime() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }

  return mainWindow
}

function requestMainAssistantRuntime<TPayload>(
  request: Omit<AssistantRuntimeRequest, 'id'>
): Promise<TPayload> {
  return requestAssistantRuntimeWhenReady<TPayload>({
    createRequestId: createAssistantRuntimeRequestId,
    request,
    responseBus: ipcMain,
    target: ensureMainWindowForAssistantRuntime()
  })
}

function createMainWindow() {
  const win = new BrowserWindow(createMainWindowOptions(createPreloadScriptPath(__dirname)))

  mainWindow = win
  keepMainWindowTitle(win)
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
  ipcMain.handle('assistant:save-preferences', (_event, preferences: AssistantPreferences) => {
    const saved = saveAssistantPreferences(getDesktopStore(), preferences)
    sendAssistantPreferencesChanged(saved)
    return saved
  })
  ipcMain.handle('video-notes:load', () => loadVideoNotes(getDesktopStore()))
  ipcMain.handle('video-notes:save', (_event, note: VideoNote) =>
    saveVideoNote(getDesktopStore(), note)
  )
  ipcMain.handle('video-note-archives:load', () => loadVideoNoteArchives(getDesktopStore()))
  ipcMain.handle('video-note-archives:save-version', (_event, note: VideoNote) =>
    saveVideoNoteArchiveVersion(getDesktopStore(), note)
  )
  ipcMain.handle('video-note-archives:delete-entry', (_event, archiveId: string) =>
    deleteVideoNoteArchiveEntry(getDesktopStore(), archiveId)
  )
  ipcMain.handle(
    'video-note-archives:delete-version',
    (_event, archiveId: string, versionId: string) =>
      deleteVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId)
  )
  ipcMain.handle(
    'video-audio:transcribe-current',
    async (event, request: VideoAudioTranscriptionRequest) => {
      const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-transcribe-'))
      const sourceSession = session.fromPartition(BILIMI_SESSION_PARTITION)

      return transcribeCurrentVideoAudio({
        request,
        session: sourceSession,
        tempDir,
        progress: (progress) => {
          event.sender.send('video-audio:transcription-progress', progress)
        }
      })
    }
  )
  ipcMain.handle('assistant-pet:restore-main-window', () => {
    restoreMainWindowForPet()
  })
  ipcMain.on('assistant-pet:set-state', (_event, state: AssistantPetState) => {
    setAssistantPetState(state)
  })
  ipcMain.handle('assistant:open-from-floating-seal', () => {
    restoreMainWindowForPet()
  })
  ipcMain.handle('floating-menu:toggle', () => {
    restoreMainWindowForPet()
  })
  ipcMain.handle(
    'floating-menu:run-action',
    (_event, action: AssistantAction, options?: FloatingAssistantActionOptions) => {
    return requestMainAssistantRuntime<AssistantAutomationResult>({
      type: 'run-action',
      action,
      options
    })
  })
  ipcMain.on('floating-menu:close', () => {
    closeFloatingMenuWindow()
    closeFloatingAssistantWindow()
  })
  ipcMain.handle('floating-assistant:toggle', () => {
    restoreMainWindowForPet()
  })
  ipcMain.handle('floating-assistant:snapshot', () =>
    requestMainAssistantRuntime<AssistantSnapshot>({ type: 'snapshot' })
  )
  ipcMain.handle('floating-assistant:get-current-video-time', () =>
    requestMainAssistantRuntime<number>({ type: 'get-current-video-time' })
  )
  ipcMain.handle('floating-assistant:seek-video-time', (_event, seconds: number) =>
    requestMainAssistantRuntime<boolean>({ type: 'seek-video-time', seconds })
  )
  ipcMain.handle(
    'floating-assistant:run-action',
    (_event, action: AssistantAction, options?: FloatingAssistantActionOptions) =>
      requestMainAssistantRuntime<AssistantAutomationResult>({
        type: 'run-action',
        action,
        options
      })
  )
  ipcMain.handle('floating-assistant:generate-video-note', (_event, manualTranscript?: string) =>
    requestMainAssistantRuntime<VideoNote | null>({
      type: 'generate-video-note',
      manualTranscript
    })
  )
  ipcMain.handle('floating-assistant:generate-video-note-from-audio', () =>
    requestMainAssistantRuntime<VideoNote | null>({
      type: 'generate-video-note-from-audio'
    })
  )
  ipcMain.handle('floating-assistant:ensure-ledgers', () =>
    requestMainAssistantRuntime<AssistantAutomationResult>({ type: 'ensure-ledgers' })
  )
  ipcMain.handle('floating-assistant:scan-old-favorites', () =>
    requestMainAssistantRuntime<FavoriteLedgerPreview>({ type: 'scan-old-favorites' })
  )
  ipcMain.handle(
    'floating-assistant:execute-old-favorite-plan',
    (_event, items: FavoriteLedgerPreviewItem[]) =>
      requestMainAssistantRuntime<AssistantAutomationResult>({
        type: 'execute-old-favorite-plan',
        items
      })
  )
  ipcMain.on('floating-assistant:close', () => {
    closeFloatingAssistantWindow()
  })
  ipcMain.on('floating-assistant:snapshot-changed', () => {
    notifyFloatingAssistantSnapshotChanged()
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
  ipcMain.on('floating-seal:resize', (_event, screenX: number, screenY: number) => {
    resizeFloatingSeal(screenX, screenY)
  })
  ipcMain.on('floating-seal:start-resize', (_event, screenX: number, screenY: number) => {
    startFloatingSealResize(screenX, screenY)
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
