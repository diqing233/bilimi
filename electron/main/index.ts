import { app, BrowserWindow, clipboard, ipcMain, screen, session } from 'electron'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDesktopStore,
  clearPendingFavoriteQueue,
  clearDeepSeekApiKey,
  loadDeepSeekApiKey,
  loadDeepSeekApiKeyStatus,
  loadAssistantPreferences,
  loadPendingFavoriteQueue,
  loadVideoAudioTranscriptionQueue,
  loadVideoNoteArchives,
  loadVideoNotes,
  saveDeepSeekApiKey,
  upsertPendingFavoriteQueueItems,
  updatePendingFavoriteQueueItemStatus,
  saveVideoAudioTranscriptionQueue,
  saveVideoNoteArchiveVersion,
  updateVideoNoteArchiveVersion,
  saveAssistantPreferences,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  saveVideoNote,
  type AssistantPreferences
} from './store'
import { requestAssistantRuntimeWhenReady } from './assistantRuntimeSignal'
import { sendAssistantSnapshotChangedToTargets } from './assistantSnapshotSignal'
import { sendAssistantOpenWhenReady } from './assistantOpenSignal'
import { FloatingMenuController } from './floatingMenuController'
import { FloatingSealDragController } from './floatingSealDragController'
import { createMainWindowOptions } from './mainWindowOptions'
import { installMainWindowControlReactions } from './mainWindowControlReactions'
import { restoreMainWindowFromPet } from './mainWindowRestore'
import { installFixedFloatingSealBoundsGuard } from './floatingSealBoundsGuard'
import { installFloatingSealCaptionStrip } from './floatingSealCaptionStrip'
import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'
import { installFloatingSealWhiteStripFix } from './floatingSealWhiteStripFix'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'
import { toggleFloatingAssistantFromSeal } from './floatingMenuToggleFlow'
import {
  configureFloatingMenuWindow,
  createFloatingMenuWindowOptions
} from './floatingMenuWindowOptions'
import { keepMainWindowTitle } from './windowTitleGuard'
import {
  createFloatingAssistantBounds,
  createFloatingHostBounds,
  createInitialFloatingSealVisualBounds,
  createFloatingMenuBounds,
  createFloatingSealDragPosition,
  createFloatingVisualBounds
} from './floatingSealGeometry'
import { createPreloadScriptPath } from './preloadPath'
import { createRendererFilePath } from './rendererPath'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'
import { createVideoTranscriptionQueue } from './videoTranscriptionQueue'
import { DeepSeekServiceError, generateDeepSeekResult } from './deepseekService'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { runStartupDiagnostics } from './startupDiagnostics'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import { createNotePosterText } from '../../src/shared/videoNoteArchive'
import { configureAppIdentity } from './appIdentity'
import type {
  AssistantAction,
  AssistantAutomationResult,
  DeepSeekGenerateRequest,
  FavoriteLedger,
  FavoriteLedgerSaveOptions,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  VideoAudioTranscriptionQueueSnapshot,
  VideoAudioTranscriptionRequest,
  VideoNote
} from '../../src/shared/types'
import type {
  AssistantRuntimeRequest,
  AssistantSnapshot,
  FloatingAssistantActionOptions,
  FloatingAssistantWorkspaceRequest
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type {
  AssistantPetHint,
  AssistantPetState
} from '../../src/renderer/src/features/assistant/petState'
import type { FavoriteLedgerPreview, FavoriteLedgerPreviewItem } from '../../src/renderer/src/features/favorites/favoriteLedgerPreview'

const FLOATING_SEAL_VISUAL_SIZE = { width: 280, height: 352 }
const FLOATING_SEAL_SHADOW_PADDING = 28
const FLOATING_SEAL_HOST_PADDING = {
  top: 0,
  right: FLOATING_SEAL_SHADOW_PADDING,
  bottom: FLOATING_SEAL_SHADOW_PADDING,
  left: FLOATING_SEAL_SHADOW_PADDING
}
const FLOATING_SEAL_MARGIN = 12
const FLOATING_SEAL_QUERY = { window: 'floating-seal' }
const FLOATING_MENU_VISUAL_SIZE = { width: 184, height: 248 }
const FLOATING_MENU_SHADOW_PADDING = 28
const FLOATING_MENU_QUERY = { window: 'floating-menu' }
const FLOATING_ASSISTANT_SIZE = { width: 460, height: 680 }
const FLOATING_ASSISTANT_QUERY = { window: 'floating-assistant' }

let mainWindow: BrowserWindow | null = null
let floatingSealWindow: BrowserWindow | null = null
let enforceFloatingSealWindowBounds: (() => void) | null = null
let assistantPetState: AssistantPetState = 'idle'

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
    void win.loadFile(createRendererFilePath(__dirname), {
      search
    })
  }
}

function getFloatingSealBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  const visualBounds = createInitialFloatingSealVisualBounds({
    workArea,
    visualSize: FLOATING_SEAL_VISUAL_SIZE,
    rightMargin: FLOATING_SEAL_MARGIN
  })

  return createFloatingHostBounds({
    visualBounds,
    padding: FLOATING_SEAL_HOST_PADDING
  })
}

function getFloatingMenuBounds() {
  const sealHostBounds = floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealHostBounds)
  const sealVisualBounds = createFloatingVisualBounds({
    hostBounds: sealHostBounds,
    padding: FLOATING_SEAL_HOST_PADDING
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

function getFloatingAssistantBounds(anchor?: FloatingAssistantWorkspaceRequest['anchor']) {
  const sealHostBounds = anchor
    ? { x: anchor.screenX, y: anchor.screenY, width: 0, height: 0 }
    : floatingSealWindow?.getBounds() ?? getFloatingSealBounds()
  const display = screen.getDisplayMatching(sealHostBounds)
  const sealVisualBounds = anchor
    ? sealHostBounds
    : createFloatingVisualBounds({
        hostBounds: sealHostBounds,
        padding: FLOATING_SEAL_HOST_PADDING
      })

  return createFloatingAssistantBounds({
    sealBounds: sealVisualBounds,
    workspaceSize: FLOATING_ASSISTANT_SIZE,
    workArea: display.workArea
  })
}

function positionFloatingAssistantWindow(
  assistant: BrowserWindow,
  anchor?: FloatingAssistantWorkspaceRequest['anchor']
) {
  if (assistant.isDestroyed()) {
    return
  }

  assistant.setBounds(getFloatingAssistantBounds(anchor))
}

function createFloatingSealWindow() {
  const seal = new BrowserWindow(
    createFloatingSealWindowOptions(getFloatingSealBounds(), createPreloadScriptPath(__dirname))
  )
  const enforceSealBounds = installFixedFloatingSealBoundsGuard(seal)

  seal.setAlwaysOnTop(true, 'floating')
  seal.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  setFloatingSealMouseTransparency(seal, true)
  seal.removeMenu()

  // Windows 透明窗口失活�?DWM 会把原生帧渲染成白条，移动窗口可强制重新合成�?
  const disposeWhiteStripFix =
    process.platform === 'win32' ? installFloatingSealWhiteStripFix(seal) : null

  // 源头修：剥掉 WS_CAPTION，让 DWM 不进�?inactive frame 绘制路径，并�?
  // DWMWA_NCRENDERING_POLICY 设为 DWMNCRP_DISABLED 作纵深防御�?
  // 本窗口已无任何依赖标题栏的功能（resizable/hasShadow/min/max/thickFrame 全关），
  // 剥它在功能上零损失。nudge 仍兜底直到确认稳定�?
  if (process.platform === 'win32') {
    installFloatingSealCaptionStrip(seal, {
      // node:child_process spawn 的多重载在我们的窄接口下不直接命中，做一次显式擦除�?
      spawn: spawn as unknown as NonNullable<
        Parameters<typeof installFloatingSealCaptionStrip>[1]
      >['spawn'],
      // 暂时把日志接�?console，方便实测期确认 PS 调用真的在跑、有�?spawn 错误�?
      // 稳定后再换回 noop�?
      logger: (message, error) => {
        if (error) {
          console.warn('[floatingSeal]', message, error)
        } else {
          console.warn('[floatingSeal]', message)
        }
      }
    })
  }

  seal.on('closed', () => {
    disposeWhiteStripFix?.()
    floatingSealWindow = null
    enforceFloatingSealWindowBounds = null
  })

  loadRendererWindow(seal, FLOATING_SEAL_QUERY)
  seal.webContents.once('did-finish-load', () => {
    sendAssistantPetState()
    enforceSealBounds()
    seal.show()
  })
  floatingSealWindow = seal
  enforceFloatingSealWindowBounds = enforceSealBounds

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

function sendAssistantPetHint(hint: AssistantPetHint) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  floatingSealWindow.webContents.send('assistant-pet:hint-changed', hint)
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

const floatingAssistantController = new FloatingMenuController(createFloatingAssistantWindow, {
  prepareWindow: positionFloatingAssistantWindow
})

function sendFloatingAssistantWorkspaceWhenReady(
  target: BrowserWindow,
  payload: FloatingAssistantWorkspaceRequest
) {
  const sendWorkspaceSignal = () => {
    if (!target.isDestroyed()) {
      target.webContents.send('floating-assistant:open-workspace', payload)
    }
  }

  if (target.webContents.isLoading()) {
    target.webContents.once('did-finish-load', sendWorkspaceSignal)
    return
  }

  sendWorkspaceSignal()
}

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

function resetFloatingSealWindowBounds() {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  enforceFloatingSealWindowBounds?.()
}

function closeFloatingMenuWindow() {
  floatingMenuController.close()
}

function closeFloatingAssistantWindow() {
  floatingAssistantController.hide()
}

function closeAssistantPetWindow() {
  closeFloatingMenuWindow()
  closeFloatingAssistantWindow()

  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  floatingSealWindow.close()
}

function setFloatingSealWindowMouseTransparent(transparent: boolean) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  setFloatingSealMouseTransparency(floatingSealWindow, transparent)
}

function wakeAssistantPetWindow() {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    createFloatingSealWindow()
    return
  }

  resetFloatingSealWindowBounds()
  floatingSealWindow.show()
  floatingSealWindow.focus()
}

function notifyFloatingAssistantSnapshotChanged() {
  const assistant = floatingAssistantController.getWindow()

  sendAssistantSnapshotChangedToTargets([mainWindow, assistant])
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
  resetFloatingSealWindowBounds()
  floatingSealDragController.start({ x: screenX, y: screenY })
}

function resizeFloatingSealByStep(step: number) {
  if (!floatingSealWindow || floatingSealWindow.isDestroyed()) {
    return
  }

  const resizeStep = Number.isFinite(step) ? Math.sign(step) : 0

  if (resizeStep === 0) {
    return
  }

  closeFloatingMenuWindow()
  closeFloatingAssistantWindow()
  floatingSealDragController.finish()
  resetFloatingSealWindowBounds()
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
}

function restoreMainWindowForPet() {
  mainWindow = restoreMainWindowFromPet({
    createMainWindow,
    mainWindow
  })
  sendAssistantOpenWhenReady(mainWindow)
}

let assistantRuntimeRequestIndex = 0
let videoTranscriptionQueue:
  | ReturnType<typeof createVideoTranscriptionQueue>
  | null = null

async function testDeepSeekConnectionForPreferences(preferences: AssistantPreferences) {
  try {
    await generateDeepSeekResult({
      config: {
        enabled: preferences.deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore()),
        model: preferences.deepseekModel,
        baseUrl: preferences.deepseekBaseUrl
      },
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'Reply with OK.' }]
      }
    })

    return { ok: true, message: 'DeepSeek connection succeeded.' }
  } catch (error) {
    if (error instanceof DeepSeekServiceError) {
      return { ok: false, message: error.message }
    }

    return { ok: false, message: 'DeepSeek connection failed.' }
  }
}

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
  const { workAreaSize } = screen.getPrimaryDisplay()
  const win = new BrowserWindow(
    createMainWindowOptions(createPreloadScriptPath(__dirname), workAreaSize)
  )

  mainWindow = win
  keepMainWindowTitle(win)
  installMainWindowControlReactions({
    closeAssistantPet: closeAssistantPetWindow,
    sendPetHint: sendAssistantPetHint,
    window: win
  })
  installWindowOpenRouting(win)
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
    }
  })

  loadRendererWindow(win)

  return win
}

function sendVideoAudioTranscriptionQueueChanged(snapshot: VideoAudioTranscriptionQueueSnapshot) {
  const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]

  for (const target of targets) {
    if (!target || target.isDestroyed()) {
      continue
    }

    target.webContents.send('video-audio:transcription-queue-changed', snapshot)
  }
}

function getVideoTranscriptionQueue() {
  if (!videoTranscriptionQueue) {
    videoTranscriptionQueue = createVideoTranscriptionQueue({
      loadItems: () => loadVideoAudioTranscriptionQueue(getDesktopStore()),
      saveItems: (items) => {
        saveVideoAudioTranscriptionQueue(getDesktopStore(), items)
      },
      transcribe: async (request, progress) => {
        const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-transcribe-'))
        const sourceSession = session.fromPartition(BILIMI_SESSION_PARTITION)
        const preferences = loadAssistantPreferences(getDesktopStore())

        return transcribeCurrentVideoAudio({
          request,
          session: sourceSession,
          tempDir,
          progress,
          threadLimit: preferences.videoAudioTranscriptionThreadLimit
        })
      },
      summarizeNote: async (note) => {
        const preferences = loadAssistantPreferences(getDesktopStore())
        const result = await generateDeepSeekResult({
          config: {
            enabled: preferences.deepseekEnabled,
            apiKey: loadDeepSeekApiKey(getDesktopStore()),
            model: preferences.deepseekModel,
            baseUrl: preferences.deepseekBaseUrl
          },
          request: { kind: 'note-poster', note }
        })

        if (result.kind !== 'note-poster') {
          throw new Error('DeepSeek summary failed.')
        }

        return createNotePosterText(result.poster)
      },
      saveArchiveVersion: (note, summaryText) =>
        saveVideoNoteArchiveVersion(getDesktopStore(), note, undefined, summaryText),
      onSnapshot: sendVideoAudioTranscriptionQueueChanged
    })
  }

  return videoTranscriptionQueue
}

function registerAssistantPreferenceHandlers() {
  ipcMain.handle('assistant:load-preferences', () => loadAssistantPreferences())
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('assistant:save-preferences', (_event, preferences: AssistantPreferences) => {
    const saved = saveAssistantPreferences(getDesktopStore(), preferences)
    sendAssistantPreferencesChanged(saved)
    return saved
  })
  ipcMain.handle('startup:diagnose', () =>
    runStartupDiagnostics({
      resolveMediaToolPaths,
      loadDeepSeekApiKeyStatus: () => loadDeepSeekApiKeyStatus(getDesktopStore()),
      testDeepSeekConnection: () =>
        testDeepSeekConnectionForPreferences(loadAssistantPreferences(getDesktopStore()))
    })
  )
  ipcMain.handle('pending-favorite-queue:load', () => loadPendingFavoriteQueue(getDesktopStore()))
  ipcMain.handle('pending-favorite-queue:clear', () => clearPendingFavoriteQueue(getDesktopStore()))
  ipcMain.handle('pending-favorite-queue:upsert', (_event, items: PendingFavoriteQueueItem[]) =>
    upsertPendingFavoriteQueueItems(getDesktopStore(), items)
  )
  ipcMain.handle(
    'pending-favorite-queue:update-status',
    (_event, aid: number, status: PendingFavoriteQueueStatus) =>
      updatePendingFavoriteQueueItemStatus(getDesktopStore(), aid, status)
  )
  ipcMain.handle('deepseek:key-status', () => loadDeepSeekApiKeyStatus(getDesktopStore()))
  ipcMain.handle('deepseek:save-key', (_event, apiKey: string) => {
    const status = saveDeepSeekApiKey(getDesktopStore(), apiKey)
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    return status
  })
  ipcMain.handle('deepseek:clear-key', () => {
    const status = clearDeepSeekApiKey(getDesktopStore())
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    return status
  })
  ipcMain.handle('deepseek:generate', (_event, request: DeepSeekGenerateRequest) => {
    const preferences = loadAssistantPreferences(getDesktopStore())

    return generateDeepSeekResult({
      config: {
        enabled: preferences.deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore()),
        model: preferences.deepseekModel,
        baseUrl: preferences.deepseekBaseUrl
      },
      request
    })
  })
  ipcMain.handle('deepseek:test-connection', async () =>
    testDeepSeekConnectionForPreferences(loadAssistantPreferences(getDesktopStore()))
  )
  ipcMain.handle('video-notes:load', () => loadVideoNotes(getDesktopStore()))
  ipcMain.handle('video-notes:save', (_event, note: VideoNote) =>
    saveVideoNote(getDesktopStore(), note)
  )
  ipcMain.handle('video-note-archives:load', () => loadVideoNoteArchives(getDesktopStore()))
  ipcMain.handle('video-note-archives:save-version', (_event, note: VideoNote, summaryText = '') =>
    saveVideoNoteArchiveVersion(getDesktopStore(), note, undefined, summaryText)
  )
  ipcMain.handle(
    'video-note-archives:update-version',
    (_event, archiveId: string, versionId: string, note: VideoNote) =>
      updateVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId, note)
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
      const preferences = loadAssistantPreferences(getDesktopStore())

      return transcribeCurrentVideoAudio({
        request,
        session: sourceSession,
        tempDir,
        threadLimit: preferences.videoAudioTranscriptionThreadLimit,
        progress: (progress) => {
          event.sender.send('video-audio:transcription-progress', progress)
        }
      })
    }
  )
  ipcMain.handle('video-audio:transcription-queue-load', () =>
    getVideoTranscriptionQueue().getSnapshot()
  )
  ipcMain.handle(
    'video-audio:transcription-queue-enqueue',
    (_event, request: VideoAudioTranscriptionRequest) =>
      getVideoTranscriptionQueue().enqueue(request)
  )
  ipcMain.handle('video-audio:transcription-queue-cancel', (_event, id: string) =>
    getVideoTranscriptionQueue().cancel(id)
  )
  ipcMain.handle('video-audio:transcription-queue-retry', (_event, id: string) =>
    getVideoTranscriptionQueue().retry(id)
  )
  ipcMain.handle('assistant-pet:restore-main-window', () => {
    restoreMainWindowForPet()
  })
  ipcMain.on('assistant-pet:close', () => {
    closeAssistantPetWindow()
  })
  ipcMain.on('assistant-pet:set-state', (_event, state: AssistantPetState) => {
    setAssistantPetState(state)
  })
  ipcMain.on('assistant-pet:set-hint', (_event, hint: AssistantPetHint) => {
    if (!hint || typeof hint.message !== 'string') {
      return
    }

    const tone = hint.tone === 'working' || hint.tone === 'error' ? hint.tone : 'hint'
    sendAssistantPetHint({ tone, message: hint.message })
  })
  ipcMain.handle('assistant-pet:wake', () => {
    wakeAssistantPetWindow()
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
    mainWindow = toggleFloatingAssistantFromSeal({
      createMainWindow,
      mainWindow,
      toggleFloatingAssistant: () => floatingAssistantController.toggle()
    })
  })
  ipcMain.handle(
    'floating-assistant:open-workspace',
    (_event, payload: FloatingAssistantWorkspaceRequest) => {
      const assistant = floatingAssistantController.open()
      positionFloatingAssistantWindow(assistant, payload.anchor)
      sendFloatingAssistantWorkspaceWhenReady(assistant, payload)

      if (mainWindow && !mainWindow.isDestroyed()) {
        sendFloatingAssistantWorkspaceWhenReady(mainWindow, payload)
      }
    }
  )
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
  ipcMain.handle('floating-assistant:enqueue-current-video-audio', (_event, options?: { summarizeWithDeepSeek?: boolean }) =>
    requestMainAssistantRuntime<VideoAudioTranscriptionQueueSnapshot | null>({
      type: 'enqueue-current-video-audio',
      summarizeWithDeepSeek: Boolean(options?.summarizeWithDeepSeek)
    })
  )
  ipcMain.handle('floating-assistant:ensure-ledgers', () =>
    requestMainAssistantRuntime<AssistantAutomationResult>({ type: 'ensure-ledgers' })
  )
  ipcMain.handle(
    'floating-assistant:save-ledgers',
    (_event, ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) =>
    requestMainAssistantRuntime<AssistantAutomationResult>({
      type: 'save-ledgers',
      ledgers,
      options
    })
  )
  ipcMain.handle('floating-assistant:open-bilibili-favorites', () =>
    requestMainAssistantRuntime<AssistantAutomationResult>({
      type: 'open-bilibili-favorites'
    })
  )
  ipcMain.handle('floating-assistant:scan-old-favorites', (_event, options = {}) =>
    requestMainAssistantRuntime<FavoriteLedgerPreview>({ type: 'scan-old-favorites', ...options })
  )
  ipcMain.handle('floating-assistant:rejudge-old-favorite', (_event, item: FavoriteLedgerPreviewItem) =>
    requestMainAssistantRuntime<FavoriteLedgerPreviewItem>({
      type: 'rejudge-old-favorite',
      item
    })
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
  ipcMain.on('floating-seal:resize-step', (_event, step: number) => {
    resizeFloatingSealByStep(step)
  })
  ipcMain.on('floating-seal:set-mouse-transparent', (_event, transparent: boolean) => {
    setFloatingSealWindowMouseTransparent(Boolean(transparent))
  })
  ipcMain.handle('floating-seal:move-by', (_event, deltaX: number, deltaY: number) => {
    moveFloatingSealBy(deltaX, deltaY)
  })
}

configureAppIdentity(app)

app.whenReady().then(() => {
  registerAssistantPreferenceHandlers()
  createMainWindow()
  createFloatingSealWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
