import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
  safeStorage,
  webContents
} from 'electron'
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
  loadFavoriteAccountPreferences,
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
  patchAssistantPreferences,
  saveFavoriteAccountPreferences,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  saveVideoNote,
  type AssistantPreferences
} from './store'
import {
  installAssistantRuntimeReadinessLifecycle,
  requestAssistantRuntimeWhenReady
} from './assistantRuntimeSignal'
import { sendAssistantSnapshotChangedToTargets } from './assistantSnapshotSignal'
import { sendAssistantOpenWhenReady } from './assistantOpenSignal'
import { FloatingMenuController } from './floatingMenuController'
import { FloatingSealDragController } from './floatingSealDragController'
import { createMainWindowOptions } from './mainWindowOptions'
import { restoreMainWindowDefaultLayoutSize } from './mainWindowLayout'
import { installMainWindowDisplayLayout } from './mainWindowDisplayLayout'
import {
  createCloseConfirmationOptions,
  installMainWindowControlReactions
} from './mainWindowControlReactions'
import { restoreMainWindowFromPet } from './mainWindowRestore'
import { handleFavoriteLibraryEntry } from './favoriteLibraryEntryFlow'
import { installFixedFloatingSealBoundsGuard } from './floatingSealBoundsGuard'
import { installFloatingSealCaptionStrip } from './floatingSealCaptionStrip'
import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'
import { installFloatingSealWhiteStripFix } from './floatingSealWhiteStripFix'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'
import { toggleFloatingAssistantFromSeal } from './floatingMenuToggleFlow'
import { FLOATING_ASSISTANT_SIZE } from './floatingAssistantWindowSize'
import { createFavoriteRepositoryQuitBarrier } from './favoriteRepositoryQuitBarrier'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'
import { classifierLedgersForAccount, enableDefaultLedgersForOrganization, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'
import { resolveSavedOldFavoriteWorkspaceLedgerTitle } from './oldFavoriteWorkspaceLedgerTitle'
import { applyRecommendedLedgers, markRecommendedLedgersLocalDraft, removeRecommendedLedgers } from './oldFavoriteWorkspaceRecommendationPersistence'
import { registerOldFavoriteWorkspaceCoordinatorIpc } from './oldFavoriteWorkspaceCoordinatorIpc'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { FavoriteRepositoryRuntimePageBridgeManager } from './favoriteRepositoryRuntimePageBridge'
import { registerFavoriteRepositoryIpc } from './favoriteRepositoryIpc'
import { FavoriteLibraryCommandService, registerFavoriteLibraryCommandsIpc } from './favoriteLibraryCommands'
import {
  createFavoriteLibraryArchiveSummary,
  createFavoriteLibraryTranscriptionSummary
} from './favoriteLibrarySummaries'
import { registerFavoriteLibraryBridgeIpc, type FavoriteLibraryAccount } from './favoriteLibraryBridge'
import { FavoriteRepositoryRemoteOperationArbiter } from './favoriteRepositoryRemoteOperationArbiter'
import { BilibiliSessionProxy } from './bilibiliSessionProxy'
import {
  configureFloatingMenuWindow,
  createFloatingMenuWindowOptions
} from './floatingMenuWindowOptions'
import { keepMainWindowTitle } from './windowTitleGuard'
import {
  createFloatingAssistantBounds,
  createFloatingHostBounds,
  createFloatingHostMovementArea,
  createInitialFloatingSealVisualBounds,
  createFloatingMenuBounds,
  createFloatingSealDragPosition,
  createFloatingSealPositionInsideWorkArea,
  createFloatingVisualBounds
} from './floatingSealGeometry'
import type { FloatingAssistantSide } from './floatingSealGeometry'
import { createPreloadScriptPath } from './preloadPath'
import { createRendererFilePath } from './rendererPath'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'
import { createVideoTranscriptionQueue } from './videoTranscriptionQueue'
import { DeepSeekServiceError, generateDeepSeekResult } from './deepseekService'
import { assertDeepSeekRequestEnabled } from './deepseekFeatureAccess'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { runStartupDiagnostics } from './startupDiagnostics'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import { classifyVideoContent } from '../../src/shared/recommendation/videoClassifier'
import { createNotePosterText } from '../../src/shared/videoNoteArchive'
import { configureAppIdentity, configureDevelopmentUserData } from './appIdentity'
import { installSingleInstanceGuard } from './singleInstance'
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
  AssistantRuntimeRequestInput,
  AssistantRuntimeRequest,
  AssistantSnapshot,
  FavoriteRepositoryPageOperationResult,
  FloatingAssistantActionOptions,
  FloatingAssistantWorkspaceRequest,
  OldFavoriteBatchCommitResult
} from '../../src/renderer/src/features/assistant/assistantRuntimeTypes'
import type {
  AssistantPetHint,
  AssistantPetState
} from '../../src/renderer/src/features/assistant/petState'

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
const FLOATING_ASSISTANT_QUERY = { window: 'floating-assistant' }

let mainWindow: BrowserWindow | null = null
let floatingSealWindow: BrowserWindow | null = null
let mainTray: Tray | null = null
let appQuitting = false
let enforceFloatingSealWindowBounds: (() => void) | null = null
let recompositeFloatingSealWindow: (() => void) | null = null
let assistantPetState: AssistantPetState = 'idle'
let floatingAssistantSide: FloatingAssistantSide | undefined
const bilibiliSessionProxy = new BilibiliSessionProxy(() => session.fromPartition(BILIMI_SESSION_PARTITION))

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
  const liveSealHostBounds =
    floatingSealWindow && !floatingSealWindow.isDestroyed()
      ? floatingSealWindow.getBounds()
      : null
  const sealHostBounds = liveSealHostBounds ?? getFloatingSealBounds()
  const displayTarget =
    liveSealHostBounds ??
    (anchor ? { x: anchor.screenX, y: anchor.screenY, width: 0, height: 0 } : sealHostBounds)
  const display = screen.getDisplayMatching(displayTarget)
  const { side, ...bounds } = createFloatingAssistantBounds({
    sealBounds: sealHostBounds,
    workspaceSize: FLOATING_ASSISTANT_SIZE,
    workArea: display.workArea,
    currentSide: floatingAssistantSide
  })

  floatingAssistantSide = side
  return bounds
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

  // Moving the transparent window forces Windows DWM to recompose stale inactive frames.
  const disposeWhiteStripFix =
    process.platform === 'win32'
      ? installFloatingSealWhiteStripFix(seal, {
          getWorkArea: (bounds) =>
            createFloatingHostMovementArea({
              visualWorkArea: screen.getDisplayMatching(bounds).workArea,
              padding: FLOATING_SEAL_HOST_PADDING
            })
        })
      : null
  const handleFloatingSealDisplayChange = () => disposeWhiteStripFix?.recomposite()

  if (disposeWhiteStripFix) {
    recompositeFloatingSealWindow = disposeWhiteStripFix.recomposite
    screen.on('display-metrics-changed', handleFloatingSealDisplayChange)
    screen.on('display-added', handleFloatingSealDisplayChange)
    screen.on('display-removed', handleFloatingSealDisplayChange)
  }

  // Strip WS_CAPTION and disable DWM non-client rendering to avoid the inactive-frame path.
  // The pet window does not rely on title-bar behavior; the nudge remains as a fallback.
  if (process.platform === 'win32') {
    installFloatingSealCaptionStrip(seal, {
      // Erase overloaded child_process.spawn signatures for the narrow caption-strip interface.
      spawn: spawn as unknown as NonNullable<
        Parameters<typeof installFloatingSealCaptionStrip>[1]
      >['spawn'],
      // Keep diagnostics visible while the PowerShell caption-strip path is validated.
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
    screen.off('display-metrics-changed', handleFloatingSealDisplayChange)
    screen.off('display-added', handleFloatingSealDisplayChange)
    screen.off('display-removed', handleFloatingSealDisplayChange)
    floatingSealWindow = null
    enforceFloatingSealWindowBounds = null
    recompositeFloatingSealWindow = null
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
    floatingAssistantSide = undefined
  })

  loadRendererWindow(assistant, FLOATING_ASSISTANT_QUERY)

  return assistant
}

const floatingAssistantController = new FloatingMenuController(createFloatingAssistantWindow, {
  prepareWindow: positionFloatingAssistantWindow
})

let favoriteRepositoryService: FavoriteRepositoryService | undefined
let favoriteRepositorySyncService: FavoriteRepositorySyncService | undefined
let favoriteRepositoryPageBridgeManager: FavoriteRepositoryRuntimePageBridgeManager | undefined
let favoriteRepositoryBindingService: FavoriteRepositoryBindingService | undefined
let favoriteLibraryCommandService: FavoriteLibraryCommandService | undefined
const favoriteRepositoryRemoteOperations = new FavoriteRepositoryRemoteOperationArbiter()
let oldFavoriteWorkspaceCoordinator: OldFavoriteWorkspaceCoordinator | undefined
let oldFavoriteWorkspaceScanService: OldFavoriteWorkspaceScanService | undefined
let oldFavoriteWorkspaceDeepSeekService: OldFavoriteWorkspaceDeepSeekService | undefined
function isTrustedOldFavoriteSessionSender(senderId: number): boolean {
  const floatingAssistant = floatingAssistantController.getWindow()
  return [mainWindow?.webContents.id, floatingAssistant?.webContents.id]
    .filter((id): id is number => typeof id === 'number')
    .includes(senderId)
}

function assertTrustedOldFavoriteAssistantSender(event: { sender: { id: number } }) {
  if (!isTrustedOldFavoriteSessionSender(event.sender.id)) {
    throw new Error('Old favorite assistant request came from an untrusted renderer.')
  }
}

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

    const bounds = floatingSealWindow.getBounds()
    const display = screen.getDisplayMatching({ ...position, width: bounds.width, height: bounds.height })
    const nextPosition = createFloatingSealPositionInsideWorkArea({
      position,
      hostSize: bounds,
      workArea: display.workArea,
      padding: FLOATING_SEAL_HOST_PADDING
    })

    floatingSealWindow.setPosition(nextPosition.x, nextPosition.y)
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

function restoreMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function getTrayIconPath() {
  return process.platform === 'win32'
    ? join(__dirname, '../../build/icon.ico')
    : join(__dirname, '../../electron/assets/bilimi-avatar.png')
}

function ensureMainTray() {
  if (mainTray) {
    return mainTray
  }

  const icon = nativeImage.createFromPath(getTrayIconPath())
  mainTray = new Tray(icon)
  mainTray.setToolTip('bilimi')
  mainTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '\u6253\u5f00 bilimi',
        click: restoreMainWindowFromTray
      },
      {
        label: '\u9000\u51fa bilimi',
        click: () => {
          appQuitting = true
          app.quit()
        }
      }
    ])
  )
  mainTray.on('double-click', restoreMainWindowFromTray)

  return mainTray
}

function minimizeMainWindowToTray() {
  ensureMainTray()
  mainWindow?.hide()
}

function saveAssistantPreferencePatch(patch: Partial<AssistantPreferences>) {
  const saved = patchAssistantPreferences(getDesktopStore(), patch)
  sendAssistantPreferencesChanged(saved)
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
  recompositeFloatingSealWindow?.()

  const assistant = floatingAssistantController.getWindow()

  if (assistant && !assistant.isDestroyed() && assistant.isVisible()) {
    positionFloatingAssistantWindow(assistant)
  }
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
  let responseModel: string | undefined
  try {
    await generateDeepSeekResult({
      config: {
        enabled: preferences.deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
        model: preferences.deepseekModel,
        baseUrl: preferences.deepseekBaseUrl
      },
      request: {
        kind: 'pet-chat',
        messages: [{ role: 'user', content: 'Reply with OK.' }]
      },
      onResponseMetadata: (metadata) => {
        responseModel = metadata.model
      }
    })

    return {
      ok: true,
      message: 'DeepSeek connection succeeded.',
      requestedModel: preferences.deepseekModel,
      responseModel
    }
  } catch (error) {
    if (error instanceof DeepSeekServiceError) {
      return { ok: false, message: error.message, requestedModel: preferences.deepseekModel }
    }

    return {
      ok: false,
      message: 'DeepSeek connection failed.',
      requestedModel: preferences.deepseekModel
    }
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

const assistantRuntimeReadyWebContentsIds = new Set<number>()
const assistantRuntimeReadyWaiters = new Map<number, Set<() => void>>()

function markAssistantRuntimeReady(webContentsId: number) {
  assistantRuntimeReadyWebContentsIds.add(webContentsId)
  const waiters = assistantRuntimeReadyWaiters.get(webContentsId)
  assistantRuntimeReadyWaiters.delete(webContentsId)
  for (const waiter of waiters ?? []) waiter()
}

function clearAssistantRuntimeReady(webContentsId: number) {
  assistantRuntimeReadyWebContentsIds.delete(webContentsId)
}

function createAssistantRuntimeTarget(win: BrowserWindow) {
  const webContentsId = win.webContents.id
  return {
    isDestroyed: () => win.isDestroyed(),
    isRuntimeReady: () => assistantRuntimeReadyWebContentsIds.has(webContentsId),
    onceRuntimeReady: (callback: () => void) => {
      const waiters = assistantRuntimeReadyWaiters.get(webContentsId) ?? new Set()
      waiters.add(callback)
      assistantRuntimeReadyWaiters.set(webContentsId, waiters)
    },
    removeRuntimeReadyListener: (callback: () => void) => {
      const waiters = assistantRuntimeReadyWaiters.get(webContentsId)
      waiters?.delete(callback)
      if (waiters?.size === 0) assistantRuntimeReadyWaiters.delete(webContentsId)
    },
    webContents: win.webContents
  }
}

function requestMainAssistantRuntime<TPayload>(request: AssistantRuntimeRequestInput): Promise<TPayload> {
  const win = ensureMainWindowForAssistantRuntime()
  return requestAssistantRuntimeWhenReady<TPayload>({
    createRequestId: createAssistantRuntimeRequestId,
    request,
    responseBus: ipcMain,
    target: createAssistantRuntimeTarget(win)
  })
}

function createMainWindow() {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const win = new BrowserWindow(
    createMainWindowOptions(createPreloadScriptPath(__dirname), workAreaSize)
  )
  installAssistantRuntimeReadinessLifecycle(win, {
    clearReady: clearAssistantRuntimeReady,
    clearWaiters: (webContentsId) => assistantRuntimeReadyWaiters.delete(webContentsId)
  })
  const disposeDisplayLayout = installMainWindowDisplayLayout(win, screen)

  mainWindow = win
  keepMainWindowTitle(win)
  installMainWindowControlReactions({
    closeAssistantPet: closeAssistantPetWindow,
    getPreferences: () =>
      appQuitting
        ? {
            ...loadAssistantPreferences(getDesktopStore()),
            closeBehavior: 'exit-launcher',
            rememberCloseChoice: true
          }
        : loadAssistantPreferences(getDesktopStore()),
    minimizeToTray: minimizeMainWindowToTray,
    prepareToExitLauncher: () => {
      appQuitting = true
    },
    quitApplication: () => app.quit(),
    savePreferencePatch: saveAssistantPreferencePatch,
    sendPetHint: sendAssistantPetHint,
    showCloseConfirmation: () =>
      dialog.showMessageBox(win, createCloseConfirmationOptions()).then((result) => ({
        response: result.response,
        checkboxChecked: result.checkboxChecked
      })),
    window: win
  })
  installWindowOpenRouting(win)
  win.on('closed', () => {
    disposeDisplayLayout()
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
    if (target === mainWindow) target.webContents.send('favorite-library:transcription-changed')
  }
}

function getVideoTranscriptionQueue() {
  if (!videoTranscriptionQueue) {
    videoTranscriptionQueue = createVideoTranscriptionQueue({
      loadItems: () => loadVideoAudioTranscriptionQueue(getDesktopStore()),
      saveItems: (items) => {
        saveVideoAudioTranscriptionQueue(getDesktopStore(), items)
      },
      transcribe: async (request, progress, signal) => {
        const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-transcribe-'))
        const sourceSession = session.fromPartition(BILIMI_SESSION_PARTITION)
        const preferences = loadAssistantPreferences(getDesktopStore())

        return transcribeCurrentVideoAudio({
          request,
          session: sourceSession,
          tempDir,
          progress,
          threadLimit: preferences.videoAudioTranscriptionThreadLimit,
          signal
        })
      },
      summarizeNote: async (note, signal) => {
        const preferences = loadAssistantPreferences(getDesktopStore())
        assertDeepSeekRequestEnabled(preferences, 'note-poster')
        const result = await generateDeepSeekResult({
          config: {
            enabled: preferences.deepseekEnabled,
            apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
            model: preferences.deepseekModel,
            baseUrl: preferences.deepseekBaseUrl
          },
          request: { kind: 'note-poster', note },
          signal
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
  ipcMain.on('assistant-runtime:ready', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return
    }
    markAssistantRuntimeReady(event.sender.id)
  })
  ipcMain.handle('bilibili-session:retry-direct', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Bilibili session proxy request came from an untrusted renderer.')
    }
    return bilibiliSessionProxy.retryDirect()
  })
  ipcMain.handle('assistant:load-preferences', () => loadAssistantPreferences())
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('assistant:save-preferences', (_event, preferences: AssistantPreferences) => {
    const saved = saveAssistantPreferences(getDesktopStore(), preferences)
    sendAssistantPreferencesChanged(saved)
    return saved
  })
  ipcMain.handle('assistant:patch-preferences', (_event, patch: Partial<AssistantPreferences>) => {
    const saved = patchAssistantPreferences(getDesktopStore(), patch)
    sendAssistantPreferencesChanged(saved)
    return saved
  })
  ipcMain.handle('layout:restore-default-size', () => {
    const win = ensureMainWindowForAssistantRuntime()
    const display = screen.getDisplayMatching(win.getBounds())

    restoreMainWindowDefaultLayoutSize(win, display.workAreaSize)
  })
  ipcMain.handle('startup:diagnose', () =>
    runStartupDiagnostics({
      resolveMediaToolPaths,
      loadDeepSeekApiKeyStatus: () => loadDeepSeekApiKeyStatus(getDesktopStore(), safeStorage),
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
  ipcMain.handle('deepseek:key-status', () => loadDeepSeekApiKeyStatus(getDesktopStore(), safeStorage))
  ipcMain.handle('deepseek:save-key', (_event, apiKey: string) => {
    const status = saveDeepSeekApiKey(getDesktopStore(), apiKey, safeStorage)
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

    assertDeepSeekRequestEnabled(preferences, request.kind)

    return generateDeepSeekResult({
      config: {
        enabled: preferences.deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
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
    (_event, archiveId: string, versionId: string, note: VideoNote, summaryText?: string) =>
      updateVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId, note, summaryText)
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
  ipcMain.handle('floating-assistant:ensure-ledgers', (event) => {
    assertTrustedOldFavoriteAssistantSender(event)
    return requestMainAssistantRuntime<AssistantAutomationResult>({ type: 'ensure-ledgers' })
  })
  ipcMain.handle(
    'floating-assistant:save-ledgers',
    (event, ledgers: FavoriteLedger[], options?: FavoriteLedgerSaveOptions) => {
      assertTrustedOldFavoriteAssistantSender(event)
      return requestMainAssistantRuntime<AssistantAutomationResult>({
        type: 'save-ledgers',
        ledgers,
        options
      })
    }
  )
  ipcMain.handle('floating-assistant:open-bilibili-favorites', (event) => {
    assertTrustedOldFavoriteAssistantSender(event)
    return requestMainAssistantRuntime<AssistantAutomationResult>({
      type: 'open-bilibili-favorites'
    })
  })
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

configureDevelopmentUserData(app, { isPackaged: app.isPackaged })
configureAppIdentity(app)
const singleInstanceGuard = installSingleInstanceGuard(app, () => mainWindow)

async function readCurrentBilibiliAccountMid() {
  const cookies = await session.fromPartition(BILIMI_SESSION_PARTITION).cookies.get({ name: 'DedeUserID' })
  return cookies.find((cookie) => /^\d+$/.test(cookie.value))?.value ?? ''
}

async function readCurrentBilibiliAccount(): Promise<FavoriteLibraryAccount> {
  const mid = await readCurrentBilibiliAccountMid()
  if (!mid) return { mid: '' }

  try {
    const response = await session.fromPartition(BILIMI_SESSION_PARTITION).fetch('https://api.bilibili.com/x/web-interface/nav')
    const payload = await response.json() as { code?: unknown; data?: { uname?: unknown } }
    const nickname = payload.code === 0 && typeof payload.data?.uname === 'string' ? payload.data.uname.trim() : ''
    return { mid, ...(nickname ? { nickname } : {}) }
  } catch {
    return { mid }
  }
}

/** Fetches video facts through the logged-in Electron session; this endpoint is read-only. */
async function refreshFavoriteLibraryVideo(accountMid: string, aid: number) {
  if ((await readCurrentBilibiliAccountMid()).trim() !== accountMid) throw new Error('当前账号已切换，请重新加载收藏库。')
  const url = new URL('https://api.bilibili.com/x/web-interface/view')
  url.searchParams.set('aid', String(aid))
  const response = await session.fromPartition(BILIMI_SESSION_PARTITION).fetch(url)
  const payload = await response.json() as { code?: unknown; data?: Record<string, unknown> }
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error('无法读取视频信息，请稍后重试。')
  if ((await readCurrentBilibiliAccountMid()).trim() !== accountMid) throw new Error('当前账号已切换，请重新加载收藏库。')
  const data = payload.data
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  if (!title) throw new Error('视频信息不完整，请稍后重试。')
  const owner = data.owner as Record<string, unknown> | undefined
  const pages = Array.isArray(data.pages) ? data.pages as Array<Record<string, unknown>> : []
  const firstPage = pages[0]
  return {
    aid, title, tags: [], updatedAt: new Date().toISOString(),
    ...(typeof owner?.name === 'string' && owner.name.trim() ? { author: owner.name.trim() } : {}),
    ...(typeof data.desc === 'string' && data.desc.trim() ? { description: data.desc.trim() } : {}),
    ...(typeof data.bvid === 'string' && data.bvid.trim() ? { bvid: data.bvid.trim() } : {}),
    ...(Number.isSafeInteger(data.duration) ? { durationSeconds: Number(data.duration) } : {}),
    ...(typeof data.tname === 'string' && data.tname.trim() ? { category: data.tname.trim() } : {}),
    ...(typeof data.pic === 'string' && data.pic.trim() ? { coverUrl: data.pic.trim() } : {}),
    ...(Number.isSafeInteger(firstPage?.cid) ? { cid: Number(firstPage.cid) } : {})
  }
}

function isTrustedFavoriteLibraryReader(senderId: number): boolean {
  return senderId === mainWindow?.webContents.id
}

if (singleInstanceGuard) app.whenReady().then(async () => {
  favoriteRepositoryService = new FavoriteRepositoryService({
    root: join(app.getPath('userData'), 'favorites', 'repository-v1'),
    getTranscriptionItems: () => getVideoTranscriptionQueue().getSnapshot().items
  })
  favoriteRepositoryPageBridgeManager = new FavoriteRepositoryRuntimePageBridgeManager(
    (request) => requestMainAssistantRuntime<FavoriteRepositoryPageOperationResult>(request)
  )
  favoriteRepositorySyncService = new FavoriteRepositorySyncService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations
  })
  favoriteRepositoryBindingService = new FavoriteRepositoryBindingService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations
  })
  favoriteLibraryCommandService = new FavoriteLibraryCommandService({
    repository: favoriteRepositoryService,
    transcriptionQueue: getVideoTranscriptionQueue(),
    refreshVideo: refreshFavoriteLibraryVideo
  })
  oldFavoriteWorkspaceCoordinator = new OldFavoriteWorkspaceCoordinator({
    repository: favoriteRepositoryService,
    syncService: favoriteRepositorySyncService,
    bindingService: favoriteRepositoryBindingService,
    classifyCurrentItems: (items, recommendedLedgers = [], accountMid) => {
      // Capture the saved rules once per workspace command, then classify its segment in memory.
      const accountPreferences = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const ledgers = mergeOldFavoriteWorkspaceLedgers(
        classifierLedgersForAccount(
          accountPreferences.favoriteLedgers,
          accountPreferences.defaultFavoriteSystemEnabled
        ),
        recommendedLedgers
      )
      return items.map((item) => {
        const result = classifyVideoContent({
          title: item.title,
          author: item.author,
          tags: item.tags,
          category: item.category
        }, ledgers)
        if (result.ledgerId === 'inbox') return { targetLedgerIds: [], confidence: 'low' as const }
        return {
          targetLedgerIds: [result.ledgerId],
          confidence: result.diagnostic?.confidence === 'high' ? 'high' as const : 'low' as const
        }
      })
    },
    resolveLedgerTitle: async (accountMid, logicalLedgerId) =>
      resolveSavedOldFavoriteWorkspaceLedgerTitle(
        loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers,
        logicalLedgerId
      ),
    resolveLedgerBinding: async (accountMid, logicalLedgerId) => {
      const ledger = loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
        .find((candidate) => candidate.id === logicalLedgerId)
      if (!ledger) return undefined
      return {
        ...(ledger.bilibiliFolderId ? { remoteFolderId: ledger.bilibiliFolderId } : {}),
        remoteDisplayTitle: ledger.displayName
      }
    },
    prepareForOrganization: async (accountMid) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const favoriteLedgers = enableDefaultLedgersForOrganization(
        current.favoriteLedgers,
        current.defaultFavoriteSystemEnabled
      )
      if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, { ...current, favoriteLedgers })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    },
    saveRecommendedLedgers: async (accountMid, ledgers) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers: applyRecommendedLedgers(current.favoriteLedgers, ledgers)
      })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    },
    removeRecommendedLedgers: async (accountMid, ledgerIds) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers: removeRecommendedLedgers(current.favoriteLedgers, ledgerIds)
      })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    },
    markRecommendedLedgersLocalDraft: async (accountMid, ledgerIds) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers: markRecommendedLedgersLocalDraft(current.favoriteLedgers, ledgerIds)
      })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    },
    workspaceStore: new OldFavoriteWorkspaceStore({
      root: join(app.getPath('userData'), 'favorites', 'repository-v1')
    })
  })
  oldFavoriteWorkspaceScanService = new OldFavoriteWorkspaceScanService({
    coordinator: oldFavoriteWorkspaceCoordinator,
    requestRuntime: (request) => requestMainAssistantRuntime(request),
    remoteOperations: favoriteRepositoryRemoteOperations,
    cancelDeepSeek: (accountMid) => oldFavoriteWorkspaceDeepSeekService?.cancelCurrentSegment(accountMid) ?? false
  })
  oldFavoriteWorkspaceDeepSeekService = new OldFavoriteWorkspaceDeepSeekService({
    coordinator: oldFavoriteWorkspaceCoordinator,
    preferences: () => loadAssistantPreferences(getDesktopStore()),
    ledgersForAccount: (accountMid) => {
      const accountPreferences = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      return classifierLedgersForAccount(
        accountPreferences.favoriteLedgers,
        accountPreferences.defaultFavoriteSystemEnabled
      )
    },
    generate: (request) => generateDeepSeekResult({
      config: {
        enabled: loadAssistantPreferences(getDesktopStore()).deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
        model: loadAssistantPreferences(getDesktopStore()).deepseekModel,
        baseUrl: loadAssistantPreferences(getDesktopStore()).deepseekBaseUrl
      },
      request
    })
  })
  registerOldFavoriteWorkspaceCoordinatorIpc({
    ipcMain,
    coordinator: oldFavoriteWorkspaceCoordinator,
    deepSeekService: oldFavoriteWorkspaceDeepSeekService,
    isTrustedSender: isTrustedOldFavoriteSessionSender,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    startScan: (accountMid, mode, options) => oldFavoriteWorkspaceScanService!.start(accountMid, mode, options),
    resumeTagEnrichment: (accountMid) => oldFavoriteWorkspaceScanService!.resumeTagEnrichment(accountMid),
    retryFailedTagEnrichment: (accountMid) => oldFavoriteWorkspaceScanService!.retryFailedTagEnrichment(accountMid),
    rebuildAndStartScan: async (accountMid) => {
      await oldFavoriteWorkspaceCoordinator!.rebuildAfterRecovery(accountMid)
      return oldFavoriteWorkspaceScanService!.start(accountMid, 'incremental')
    }
  })
  registerFavoriteRepositoryIpc({
    ipcMain,
    service: favoriteRepositoryService,
    isTrustedSender: isTrustedOldFavoriteSessionSender,
    isTrustedReader: isTrustedFavoriteLibraryReader,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    send: (senderId, channel, payload) => {
      const target = webContents.fromId(senderId)
      if (target && !target.isDestroyed()) target.send(channel, payload)
    },
    getArchiveSummary: (accountMid, aid) => createFavoriteLibraryArchiveSummary(accountMid, aid, loadVideoNoteArchives(getDesktopStore())),
    getTranscriptionSummary: (accountMid, aid) =>
      createFavoriteLibraryTranscriptionSummary(accountMid, aid, getVideoTranscriptionQueue().getSnapshot().items)
  })
  registerFavoriteLibraryCommandsIpc({
    ipcMain,
    commands: favoriteLibraryCommandService,
    isTrustedLibrarySender: isTrustedFavoriteLibraryReader,
    getCurrentAccountMid: readCurrentBilibiliAccountMid
  })
  registerFavoriteLibraryBridgeIpc({
    ipcMain,
    isTrustedLibrarySender: isTrustedFavoriteLibraryReader,
    readAccount: readCurrentBilibiliAccount,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    getSnapshot: (accountMid) => favoriteRepositoryService!.getSnapshot(accountMid),
    loadArchives: () => loadVideoNoteArchives(getDesktopStore()),
    updateArchiveVersion: (archiveId, versionId, note) => {
      const archives = updateVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId, note)
      sendAssistantSnapshotChangedToTargets([mainWindow, floatingAssistantController.getWindow()])
      return archives
    },
    openMainUrl: (url) => {
      const target = ensureMainWindowForAssistantRuntime()
      openUrlInRendererTab(target, url)
    }
  })
  ipcMain.handle('favorite-library:open', (event) => {
    assertTrustedOldFavoriteAssistantSender(event)
    handleFavoriteLibraryEntry({
      senderId: event.sender.id,
      mainWindow,
      restoreMainWindow: restoreMainWindowForPet
    })
  })
  let accountChangeTimer: NodeJS.Timeout | undefined
  session.fromPartition(BILIMI_SESSION_PARTITION).cookies.on('changed', (_event, cookie) => {
    if (cookie.name === 'DedeUserID' || cookie.name === 'bili_jct') {
      clearTimeout(accountChangeTimer)
      accountChangeTimer = setTimeout(() => {
        notifyFloatingAssistantSnapshotChanged()
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bilibili:account-changed')
      }, 150)
    }
  })
  ipcMain.handle('bilibili:account-mid', async () => {
    return readCurrentBilibiliAccountMid()
  })
  getVideoTranscriptionQueue()
  registerAssistantPreferenceHandlers()
  createMainWindow()
  if (singleInstanceGuard.hasPendingFocus()) singleInstanceGuard.focusMainWindow()
  createFloatingSealWindow()
})

const favoriteRepositoryQuitBarrier = createFavoriteRepositoryQuitBarrier({
  hasPendingWrites: () => favoriteRepositoryService?.hasPendingWrites() === true,
  flush: async () => {
    appQuitting = true
    await favoriteRepositoryService?.flush()
  },
  quit: () => app.quit()
})
app.on('before-quit', favoriteRepositoryQuitBarrier)

app.on('window-all-closed', () => {
  if (appQuitting && process.platform !== 'darwin') app.quit()
})
