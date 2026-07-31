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
  shell,
  webContents
} from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
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
  saveVideoNoteArchiveVersionWithIdentity,
  saveVideoNoteArchiveSummaryWithIdentity,
  updateVideoNoteArchiveVersion,
  saveAssistantPreferences,
  patchAssistantPreferences,
  normalizeAssistantPreferencePatch,
  writeAssistantPreferencePatch,
  writeFavoriteLedgerEnabled,
  saveFavoriteAccountPreferences,
  dismissFavoriteLibraryRemoteFolder,
  isFavoriteLibraryRemoteFolderDismissed,
  deleteVideoNoteArchiveEntry,
  deleteVideoNoteArchiveVersion,
  saveVideoNote,
  loadNoteProcessingCheckpoints,
  saveNoteProcessingCheckpoint,
  deleteNoteProcessingCheckpoint,
  type AssistantPreferences
} from './store'
import {
  assertCurrentAccountOwnsArchiveEntry,
  assertCurrentAccountOwnsArchiveVersion,
  assertArchiveVersionMatchesReplacementNote,
  assertCurrentAccountOwnsVerifiedArchiveNote,
  filterVideoNoteArchivesForAccount
} from './videoNoteArchiveIdentityGuard'
import {
  installAssistantRuntimeReadinessLifecycle,
  requestAssistantRuntimeWhenReady
} from './assistantRuntimeSignal'
import { sendAssistantSnapshotChangedToTargets } from './assistantSnapshotSignal'
import { sendAssistantOpenWhenReady } from './assistantOpenSignal'
import { FloatingMenuController } from './floatingMenuController'
import { FloatingSealDragController } from './floatingSealDragController'
import { createMainWindowOptions } from './mainWindowOptions'
import {
  createElectronAssistantSidebarLayoutStore,
  registerAssistantSidebarLayoutIpc
} from './assistantSidebarLayoutStore'
import { restoreMainWindowDefaultLayoutSize } from './mainWindowLayout'
import { installMainWindowDisplayLayout } from './mainWindowDisplayLayout'
import {
  createCloseConfirmationOptions,
  installMainWindowControlReactions
} from './mainWindowControlReactions'
import { restoreMainWindowFromPet } from './mainWindowRestore'
import { getMainWindowPresentationState } from './mainWindowPresentationState'
import { handleFavoriteLibraryEntry } from './favoriteLibraryEntryFlow'
import { installFixedFloatingSealBoundsGuard } from './floatingSealBoundsGuard'
import { installFloatingSealCaptionStrip } from './floatingSealCaptionStrip'
import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'
import { createFloatingSealMouseRecoveryController } from './floatingSealMouseRecovery'
import { installFloatingSealWhiteStripFix } from './floatingSealWhiteStripFix'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'
import { toggleFloatingAssistantFromSeal } from './floatingMenuToggleFlow'
import { FLOATING_ASSISTANT_SIZE } from './floatingAssistantWindowSize'
import { createFavoriteRepositoryQuitBarrier } from './favoriteRepositoryQuitBarrier'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'
import { classifyOldFavoriteItemsCooperatively, classifierLedgersForAccount, enableDefaultLedgersForOrganization, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'
import { resolveSavedOldFavoriteWorkspaceLedgerTitle } from './oldFavoriteWorkspaceLedgerTitle'
import { mergeRecoveredLedgerDrafts, reconcileRecommendedLedgers } from './oldFavoriteWorkspaceRecommendationPersistence'
import { registerOldFavoriteWorkspaceCoordinatorIpc } from './oldFavoriteWorkspaceCoordinatorIpc'
import { FavoriteRepositoryService } from './favoriteRepositoryService'
import { FavoriteRepositoryArchiveService } from './favoriteRepositoryArchiveService'
import { FavoriteRepositorySyncService } from './favoriteRepositorySyncService'
import { FavoriteRepositoryBindingService } from './favoriteRepositoryBindingService'
import { FavoriteRepositoryRuntimePageBridgeManager } from './favoriteRepositoryRuntimePageBridge'
import { registerFavoriteRepositoryIpc } from './favoriteRepositoryIpc'
import { FavoriteRepositoryBatchOperationService } from './favoriteRepositoryBatchOperationService'
import { FavoriteRepositoryManagedFolderService } from './favoriteRepositoryManagedFolderService'
import { registerFavoriteLibraryOperationsIpc } from './favoriteLibraryOperationsIpc'
import { createFavoriteLibraryRemoteUnfavorite, FavoriteLibraryCommandService, registerFavoriteLibraryCommandsIpc } from './favoriteLibraryCommands'
import { fetchFavoriteVideoMetadata } from './favoriteVideoMetadata'
import {
  createFavoriteLibraryArchiveSummary,
  createFavoriteLibraryTranscriptionSummary
} from './favoriteLibrarySummaries'
import { archiveNavigationForVideo, registerFavoriteLibraryBridgeIpc, type FavoriteLibraryAccount } from './favoriteLibraryBridge'
import { LocalDataService } from './localDataService'
import { registerLocalDataIpc } from './localDataIpc'
import { createLocalDataPersistenceAdapter } from './localDataPersistenceAdapter'
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

// Registered with the assistant IPC handlers, but cleared by account/session lifecycle handlers.
let videoNoteBatchExportIpc: {
  clearAll(): void
  clearCompletedFoldersForAccount(accountMid: string): void
} | undefined
import { createPreloadScriptPath } from './preloadPath'
import { createRendererFilePath } from './rendererPath'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'
import { createTranscriptionProviderResolver } from './transcriptionProviderResolver'
import { disposeDefaultFasterWhisperGpuSessions, disposeDefaultFasterWhisperHelperSessions } from './fasterWhisperTranscription'
import { createTranscriptionModelManager } from './transcriptionModelManager'
import { registerTranscriptionModelIpc } from './transcriptionModelIpc'
import { validateTranscriptionModelRuntime } from './transcriptionModelRuntimeValidation'
import { createVideoTranscriptionQueue, type VideoTranscriptionQueueBatchResult } from './videoTranscriptionQueue'
import { assertCurrentAccountOwnsTranscriptionQueueItems, assertCurrentAccountOwnsTranscriptionRequest, filterTranscriptionQueueSnapshotForAccount } from './transcriptionQueueAccountGuard'
import { DeepSeekServiceError, generateDeepSeekResult } from './deepseekService'
import { assertDeepSeekRequestEnabled } from './deepseekFeatureAccess'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { runStartupDiagnostics } from './startupDiagnostics'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import { classifyVideoContent } from '../../src/shared/recommendation/videoClassifier'
import { createNotePosterText } from '../../src/shared/videoNoteArchive'
import { normalizeAssistantPreferencePatchMeta } from '../../src/shared/assistantPreferencePatchMeta'
import {
  exportVideoNoteArchiveBatch
} from './videoNoteExportService'
import { registerVideoNoteBatchExportIpc } from './videoNoteExportIpc'
import { configureAppIdentity, configureDevelopmentRuntimeSwitches, configureDevelopmentUserData } from './appIdentity'
import { installSingleInstanceGuard } from './singleInstance'
import type {
  AssistantAction,
  AssistantAutomationResult,
  AssistantPreferencePatchMeta,
  DeepSeekGenerateRequest,
  FavoriteLedger,
  FavoriteLedgerEnabledPatch,
  FavoriteLedgerSaveOptions,
  PendingFavoriteQueueItem,
  PendingFavoriteQueueStatus,
  TranscriptionModelId,
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

function portableSharedSettings(value: Record<string, unknown>): Partial<AssistantPreferences> {
  const next: Partial<AssistantPreferences> = {}
  if (value.theme === 'light' || value.theme === 'dark' || value.theme === 'system') next.theme = value.theme
  if (typeof value.language === 'string' && value.language.trim()) next.language = value.language.trim()
  if (value.closeBehavior === 'minimize-to-tray' || value.closeBehavior === 'exit-launcher') next.closeBehavior = value.closeBehavior
  if (typeof value.favoritesFolderName === 'string' && value.favoritesFolderName.trim()) next.favoritesFolderName = value.favoritesFolderName.trim()
  if (value.windowBounds && typeof value.windowBounds === 'object' && !Array.isArray(value.windowBounds)) {
    const bounds = value.windowBounds as Record<string, unknown>
    if (['x', 'y', 'width', 'height'].every((key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key])) && Number(bounds.width) >= 100 && Number(bounds.height) >= 100) {
      next.windowBounds = { x: Number(bounds.x), y: Number(bounds.y), width: Number(bounds.width), height: Number(bounds.height) }
    }
  }
  return next
}
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
let floatingSealMouseRecovery: ReturnType<typeof createFloatingSealMouseRecoveryController> | null = null
let assistantPetState: AssistantPetState = 'idle'
let floatingAssistantSide: FloatingAssistantSide | undefined
const bilibiliSessionProxy = new BilibiliSessionProxy(() => session.fromPartition(BILIMI_SESSION_PARTITION))

function normalizeBilibiliConnectionMode(value: unknown): 'auto' | 'direct' {
  return value === 'direct' ? value : 'auto'
}

function readBilibiliConnectionMode() {
  return normalizeBilibiliConnectionMode(loadAssistantPreferences(getDesktopStore()).bilibiliConnectionMode)
}

function writeBilibiliConnectionMode(mode: 'auto' | 'direct') {
  const store = getDesktopStore()
  saveAssistantPreferences(store, { ...loadAssistantPreferences(store), bilibiliConnectionMode: mode })
}

function withBilibiliConnectionMode(preferences: AssistantPreferences) {
  return { ...preferences, bilibiliConnectionMode: readBilibiliConnectionMode() }
}

function requestBilibiliWebviewReload() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bilibili-session:reload-requested')
  }
}

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
  floatingSealMouseRecovery = createFloatingSealMouseRecoveryController({
    getCursorPoint: () => screen.getCursorScreenPoint(),
    schedulePoll: (callback) => setInterval(callback, 16),
    cancelPoll: (handle) => clearInterval(handle as NodeJS.Timeout),
    window: seal
  })
  floatingSealMouseRecovery.setTransparent(true)
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
    floatingSealMouseRecovery?.dispose()
    floatingSealMouseRecovery = null
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
  const withConnectionMode = withBilibiliConnectionMode(preferences)
  const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]

  for (const target of targets) {
    if (!target || target.isDestroyed()) {
      continue
    }

    target.webContents.send('assistant:preferences-changed', withConnectionMode)
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
let favoriteRepositoryBatchOperationService: FavoriteRepositoryBatchOperationService | undefined
let favoriteRepositoryManagedFolderService: FavoriteRepositoryManagedFolderService | undefined
let localDataService: LocalDataService | undefined
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

function sendAssistantPreferencePatchChanged(patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) {
  const normalizedMeta = normalizeAssistantPreferencePatchMeta(meta)
  const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
  for (const target of targets) {
    if (!target || target.isDestroyed()) continue
    target.webContents.send('assistant:preferences-patch-changed', patch, normalizedMeta)
  }
}

function sendFavoriteLedgerEnabledChanged(patch: FavoriteLedgerEnabledPatch, meta?: AssistantPreferencePatchMeta) {
  const normalizedMeta = normalizeAssistantPreferencePatchMeta(meta)
  const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
  for (const target of targets) {
    if (!target || target.isDestroyed()) continue
    target.webContents.send('assistant:favorite-ledger-enabled-changed', patch, normalizedMeta)
  }
}

function isTrustedOldFavoriteAssistantSender(event: { sender: { id: number } }) {
  return isTrustedOldFavoriteSessionSender(event.sender.id)
}

function assertTrustedOldFavoriteAssistantSender(event: { sender: { id: number } }) {
  if (!isTrustedOldFavoriteAssistantSender(event)) {
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

function openAssistantWorkspace(payload: FloatingAssistantWorkspaceRequest) {
  if (payload.sidebar) {
    const mainAssistant = ensureMainWindowForAssistantRuntime()
    sendFloatingAssistantWorkspaceWhenReady(mainAssistant, payload)
    return
  }

  const assistant = floatingAssistantController.open()
  positionFloatingAssistantWindow(assistant, payload.anchor)
  sendFloatingAssistantWorkspaceWhenReady(assistant, payload)
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

  if (floatingSealMouseRecovery) {
    floatingSealMouseRecovery.setTransparent(transparent)
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
  setFloatingSealWindowMouseTransparent(false)
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
  setFloatingSealWindowMouseTransparent(false)
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
  setFloatingSealWindowMouseTransparent(false)
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
  setFloatingSealWindowMouseTransparent(false)
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
const transcriptionModelManager = createTranscriptionModelManager({
  legacyWhisperModelPath: () => {
    try {
      return resolveMediaToolPaths().whisperModelPath
    } catch {
      return null
    }
  },
  developmentFasterWhisperHelperPath: () => {
    if (app.isPackaged) return null
    const helperPath = join(process.cwd(), 'tools', 'faster-whisper-runtime', 'bilimi-faster-whisper.exe')
    return existsSync(helperPath) ? helperPath : null
  },
  developmentFasterWhisperPython: () => {
    if (app.isPackaged) return null
    const scriptPath = join(process.cwd(), 'tools', 'transcribe_faster_whisper.py')
    return existsSync(scriptPath)
      ? { command: process.env.BILIMI_PYTHON_PATH?.trim() || 'python', scriptPath }
      : null
  },
  validateRuntime: validateTranscriptionModelRuntime
})

async function resolveVerifiedFasterWhisperRuntime(id: Extract<TranscriptionModelId, `faster-whisper-${string}`>) {
  const probe = await transcriptionModelManager.probeFasterWhisperGpu(id)
  return probe.status === 'available'
    ? { device: 'cuda' as const, computeType: probe.computeType }
    : { device: 'cpu' as const, computeType: 'int8' as const, fallbackMessage: `GPU unavailable; using CPU. ${probe.reason}` }
}

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

const QUEUE_PROGRESS_EVENT_THROTTLE_MS = 100
let lastPublishedQueueSnapshot: VideoAudioTranscriptionQueueSnapshot | undefined
let pendingQueueSnapshot: VideoAudioTranscriptionQueueSnapshot | undefined
let pendingQueueSnapshotTimer: NodeJS.Timeout | undefined
let queuePublishGeneration = 0

function queueLifecycleSignature(snapshot: VideoAudioTranscriptionQueueSnapshot) {
  return `${snapshot.activeItemId ?? ''}:${snapshot.sessionCompletedCount}:${snapshot.items.map((item) => `${item.id}:${item.status}:${item.archiveRegistrationStatus ?? ''}`).join('|')}`
}

function publishVideoAudioTranscriptionQueueChanged(snapshot: VideoAudioTranscriptionQueueSnapshot, notifyFavoriteLibrary: boolean) {
  const generation = ++queuePublishGeneration
  void readCurrentBilibiliAccountMid().then((accountMid) => {
    // Account reads and throttled progress publications are asynchronous.  A
    // delayed old snapshot must never overwrite a newer account-scoped one.
    if (generation !== queuePublishGeneration) return
    const scopedSnapshot = filterTranscriptionQueueSnapshotForAccount(snapshot, accountMid)
    const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]

    for (const target of targets) {
      if (!target || target.isDestroyed()) continue
      target.webContents.send('video-audio:transcription-queue-changed', scopedSnapshot)
      if (notifyFavoriteLibrary && target === mainWindow) target.webContents.send('favorite-library:transcription-changed')
    }
  })
}

function sendVideoAudioTranscriptionQueueChanged(snapshot: VideoAudioTranscriptionQueueSnapshot) {
  const isLifecycleChange = !lastPublishedQueueSnapshot ||
    queueLifecycleSignature(lastPublishedQueueSnapshot) !== queueLifecycleSignature(snapshot)
  pendingQueueSnapshot = snapshot
  if (isLifecycleChange) {
    if (pendingQueueSnapshotTimer) clearTimeout(pendingQueueSnapshotTimer)
    pendingQueueSnapshotTimer = undefined
    lastPublishedQueueSnapshot = snapshot
    publishVideoAudioTranscriptionQueueChanged(snapshot, true)
    return
  }
  if (pendingQueueSnapshotTimer) return
  pendingQueueSnapshotTimer = setTimeout(() => {
    pendingQueueSnapshotTimer = undefined
    const latest = pendingQueueSnapshot
    if (!latest) return
    lastPublishedQueueSnapshot = latest
    publishVideoAudioTranscriptionQueueChanged(latest, false)
  }, QUEUE_PROGRESS_EVENT_THROTTLE_MS)
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

        try {
          return await transcribeCurrentVideoAudio({
          request,
          session: sourceSession,
          tempDir,
          progress,
          threadLimit: preferences.videoAudioTranscriptionThreadLimit,
          resolveTranscriber: createTranscriptionProviderResolver({
            resolveSenseVoicePaths: () => transcriptionModelManager.resolveSenseVoicePaths(),
            resolveWhisperModelPath: () => transcriptionModelManager.resolveWhisperSmallPath(),
            resolveFasterWhisperPaths: (id) => transcriptionModelManager.resolveFasterWhisperPaths(id),
            resolveFasterWhisperRuntime: request.transcriptionDeviceOverride === 'cpu'
              ? async () => ({ device: 'cpu' as const, computeType: 'int8' as const })
              : resolveVerifiedFasterWhisperRuntime
          }),
            signal
          })
        } finally {
          disposeDefaultFasterWhisperGpuSessions()
        }
      },
      modelForRequest: (request) => request.accountMid
        ? loadFavoriteAccountPreferences(getDesktopStore(), request.accountMid).transcriptionModelId ?? 'whisper-small'
        : 'whisper-small',
      summarizeNote: async (note, signal, reportProgress) => {
        const preferences = loadAssistantPreferences(getDesktopStore())
        assertDeepSeekRequestEnabled(preferences, 'note-poster')
        const accountMid = note.source.accountMid ?? 'local'
        const identity = {
          accountMid,
          videoId: note.id,
          transcriptHash: createHash('sha256').update(note.transcript.map((segment) => `${segment.start}:${segment.end}:${segment.text}`).join('\n')).digest('hex'),
          promptVersion: 'faithful-v1',
          model: preferences.deepseekModel
        }
        const checkpoint = loadNoteProcessingCheckpoints(getDesktopStore())[
          [identity.accountMid, identity.videoId, identity.transcriptHash, identity.promptVersion, identity.model].join(':')
        ]
        const result = await generateDeepSeekResult({
          config: {
            enabled: preferences.deepseekEnabled,
            apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
            model: preferences.deepseekModel,
            baseUrl: preferences.deepseekBaseUrl
          },
          request: { kind: 'note-poster', note },
          signal,
          ...(checkpoint
            ? { notePosterCheckpoint: {
              proofreadingCompleted: checkpoint.proofreadingCompleted === true,
              polishedTranscriptText: checkpoint.polishedTranscriptText,
              completedBatchIds: checkpoint.completedBatchIds,
              polishedTextBySegmentId: checkpoint.polishedTextBySegmentId,
              corrections: checkpoint.corrections,
              reviewItems: checkpoint.reviewItems
            } }
            : {}),
          onNotePosterProgress: (progress) => {
            reportProgress?.({
              step: 'summarizing-deepseek',
              message: progress.stage === 'proofreading-batch'
                ? `正在保真校对 ${progress.batchIndex}/${progress.batchCount}`
                : '正在生成内容总结'
            })
          },
          onNotePosterCheckpoint: (partial) => {
            saveNoteProcessingCheckpoint(getDesktopStore(), {
              ...identity,
              ...partial,
              updatedAt: new Date().toISOString()
            })
          }
        })

        if (result.kind !== 'note-poster') {
          throw new Error('DeepSeek summary failed.')
        }

        deleteNoteProcessingCheckpoint(getDesktopStore(), identity)

        return createNotePosterText(result.poster)
      },
      saveArchiveVersion: (note, summaryText) => {
        const saved = saveVideoNoteArchiveVersionWithIdentity(getDesktopStore(), note, undefined, summaryText)
        return { archiveId: saved.archiveId, versionId: saved.versionId }
      },
      loadArchiveVersion: (archiveId, versionId) => loadVideoNoteArchives(getDesktopStore())
        .find((archive) => archive.id === archiveId)?.versions
        .find((version) => version.id === versionId)?.note,
      saveArchiveSummary: (archiveId, versionId, note, summaryText) => {
        saveVideoNoteArchiveSummaryWithIdentity(getDesktopStore(), archiveId, versionId, note, summaryText)
      },
      isAccountStillCurrent: async (accountMid) => Boolean(accountMid && accountMid === await readCurrentBilibiliAccountMid()),
      onSnapshot: sendVideoAudioTranscriptionQueueChanged
    })
  }

  return videoTranscriptionQueue
}

async function getCurrentAccountTranscriptionQueue(ids: string[]) {
  const queue = getVideoTranscriptionQueue()
  assertCurrentAccountOwnsTranscriptionQueueItems(
    await readCurrentBilibiliAccountMid(),
    queue.getSnapshot().items,
    ids
  )
  return queue
}

function registerAssistantPreferenceHandlers() {
  const assistantSidebarLayout = createElectronAssistantSidebarLayoutStore(
    () => loadAssistantPreferences(getDesktopStore()).assistantSidebarWidthPx
  )
  registerAssistantSidebarLayoutIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    isTrustedSender: (senderId) => {
      const floatingAssistant = floatingAssistantController.getWindow()
      return senderId === mainWindow?.webContents.id || senderId === floatingAssistant?.webContents.id
    },
    layout: assistantSidebarLayout
  })
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
    const previous = bilibiliSessionProxy.snapshot()
    return favoriteRepositoryRemoteOperations.runExclusive(() => bilibiliSessionProxy.retryDirect()).then((snapshot) => {
      if (snapshot.effectiveMode !== previous.effectiveMode || snapshot.temporaryDirect !== previous.temporaryDirect) {
        requestBilibiliWebviewReload()
      }
      return snapshot
    })
  })
  ipcMain.handle('assistant:load-preferences', () =>
    withBilibiliConnectionMode(loadAssistantPreferences(getDesktopStore(), safeStorage))
  )
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('assistant:save-preferences', async (_event, preferences: AssistantPreferences) => {
    const requestedMode = (preferences as AssistantPreferences & { bilibiliConnectionMode?: unknown }).bilibiliConnectionMode
    const mode = normalizeBilibiliConnectionMode(requestedMode)
    const connectionModeChanged = requestedMode !== undefined && mode !== readBilibiliConnectionMode()
    if (connectionModeChanged) {
      await favoriteRepositoryRemoteOperations.runExclusive(() => bilibiliSessionProxy.applyPreference(mode))
      writeBilibiliConnectionMode(mode)
    }
    const saved = saveAssistantPreferences(getDesktopStore(), preferences)
    const next = withBilibiliConnectionMode(saved)
    sendAssistantPreferencesChanged(next)
    if (connectionModeChanged) requestBilibiliWebviewReload()
    return next
  })
  ipcMain.handle('assistant:patch-preferences', async (_event, patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => {
    const { bilibiliConnectionMode, ...assistantPatch } = patch
    const connectionModeChanged = bilibiliConnectionMode !== undefined &&
      normalizeBilibiliConnectionMode(bilibiliConnectionMode) !== readBilibiliConnectionMode()
    if (connectionModeChanged) {
      const mode = normalizeBilibiliConnectionMode(bilibiliConnectionMode)
      await favoriteRepositoryRemoteOperations.runExclusive(() => bilibiliSessionProxy.applyPreference(mode))
      writeBilibiliConnectionMode(mode)
    }
    const normalizedAssistantPatch = normalizeAssistantPreferencePatch(assistantPatch)
    const saved = patchAssistantPreferences(getDesktopStore(), assistantPatch)
    const next = withBilibiliConnectionMode(saved)
    if (normalizedAssistantPatch && !connectionModeChanged) {
      sendAssistantPreferencePatchChanged(normalizedAssistantPatch, meta)
    } else {
      sendAssistantPreferencesChanged(next)
    }
    if (connectionModeChanged) requestBilibiliWebviewReload()
    return next
  })
  ipcMain.handle('assistant:write-preference-patch', (_event, patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => {
    const written = writeAssistantPreferencePatch(getDesktopStore(), patch)
    if (!written) throw new Error('This preference patch requires the full save path.')
    sendAssistantPreferencePatchChanged(written, meta)
    return written
  })
  ipcMain.handle('assistant:write-favorite-ledger-enabled', async (event, accountMid: string, ledgerId: string, enabled: boolean, meta?: AssistantPreferencePatchMeta) => {
    assertTrustedOldFavoriteAssistantSender(event)
    const patch = await writeFavoriteLedgerEnabled(undefined, accountMid, ledgerId, enabled)
    sendFavoriteLedgerEnabledChanged(patch, meta)
    return patch
  })
  ipcMain.on('assistant:preview-preference-patch', (_event, patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => {
    const normalizedPatch = normalizeAssistantPreferencePatch(patch)
    if (normalizedPatch) sendAssistantPreferencePatchChanged(normalizedPatch, meta)
  })
  ipcMain.handle('layout:restore-default-size', () => {
    const win = ensureMainWindowForAssistantRuntime()
    const display = screen.getDisplayMatching(win.getBounds())

    restoreMainWindowDefaultLayoutSize(win, display.workArea)
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
  ipcMain.handle('video-note-archives:load', async (event) => {
    if (!isTrustedOldFavoriteAssistantSender(event)) throw new Error('Archive load request was not sent by a trusted renderer.')
    return filterVideoNoteArchivesForAccount(loadVideoNoteArchives(getDesktopStore()), await readCurrentBilibiliAccountMid())
  })
  ipcMain.handle('video-note-archives:open-source', (event, source: VideoNote['source'], seconds?: unknown) => {
    if (!isTrustedOldFavoriteAssistantSender(event) || !source || typeof source.url !== 'string') {
      throw new Error('Video note source is unavailable.')
    }
    const url = source.url.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Error('Video note source URL is invalid.')
    }
    if (parsed.protocol !== 'https:' || !/(^|\.)bilibili\.com$/u.test(parsed.hostname)) {
      throw new Error('Video note source URL is not a Bilibili video.')
    }
    const target = ensureMainWindowForAssistantRuntime()
    target.webContents.send('video-note-archives:open-source', {
      url,
      ...(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? { seconds } : {}),
      ...(Number.isSafeInteger(source.aid) ? { aid: source.aid } : {}),
      ...(Number.isSafeInteger(source.cid) ? { cid: source.cid } : {})
    })
  })
  ipcMain.handle('video-note-archives:save-version-verified', async (event, note: VideoNote, summaryText = '') => {
    if (!isTrustedOldFavoriteAssistantSender(event)) {
      throw new Error('Archive save request was not sent by a trusted renderer.')
    }
    assertCurrentAccountOwnsVerifiedArchiveNote(await readCurrentBilibiliAccountMid(), note)
    return saveVideoNoteArchiveVersionWithIdentity(getDesktopStore(), note, undefined, summaryText)
  })
  ipcMain.handle(
    'video-note-archives:save-summary',
    async (event, archiveId: string, versionId: string, note: VideoNote, summaryText: string) => {
      if (!isTrustedOldFavoriteAssistantSender(event)) {
        throw new Error('Archive summary save request was not sent by a trusted renderer.')
      }
      const archives = loadVideoNoteArchives(getDesktopStore())
      const existingVersion = assertCurrentAccountOwnsArchiveVersion(
        archives,
        await readCurrentBilibiliAccountMid(),
        archiveId,
        versionId
      )
      const sourceNote = existingVersion.note
      const summaryNote = {
        ...sourceNote,
        overview: note.overview,
        updatedAt: note.updatedAt
      }
      return saveVideoNoteArchiveSummaryWithIdentity(
        getDesktopStore(),
        archiveId,
        versionId,
        summaryNote,
        summaryText
      )
    }
  )
  ipcMain.handle(
    'video-note-archives:update-version',
    async (event, archiveId: string, versionId: string, note: VideoNote, summaryText?: string) => {
      if (!isTrustedOldFavoriteAssistantSender(event)) throw new Error('Archive update request was not sent by a trusted renderer.')
      const accountMid = await readCurrentBilibiliAccountMid()
      const existingVersion = assertCurrentAccountOwnsArchiveVersion(loadVideoNoteArchives(getDesktopStore()), accountMid, archiveId, versionId)
      assertCurrentAccountOwnsVerifiedArchiveNote(accountMid, note)
      assertArchiveVersionMatchesReplacementNote(existingVersion, note)
      return updateVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId, note, summaryText)
    }
  )
  ipcMain.handle('video-note-archives:delete-entry', async (event, archiveId: string) => {
    if (!isTrustedOldFavoriteAssistantSender(event)) throw new Error('Archive delete request was not sent by a trusted renderer.')
    assertCurrentAccountOwnsArchiveEntry(loadVideoNoteArchives(getDesktopStore()), await readCurrentBilibiliAccountMid(), archiveId)
    return deleteVideoNoteArchiveEntry(getDesktopStore(), archiveId)
  })
  ipcMain.handle(
    'video-note-archives:delete-version',
    async (event, archiveId: string, versionId: string) => {
      if (!isTrustedOldFavoriteAssistantSender(event)) throw new Error('Archive delete request was not sent by a trusted renderer.')
      assertCurrentAccountOwnsArchiveVersion(loadVideoNoteArchives(getDesktopStore()), await readCurrentBilibiliAccountMid(), archiveId, versionId)
      return deleteVideoNoteArchiveVersion(getDesktopStore(), archiveId, versionId)
    }
  )
  videoNoteBatchExportIpc = registerVideoNoteBatchExportIpc({
    ipcMain,
    isTrustedSender: (senderId) => isTrustedOldFavoriteAssistantSender({ sender: { id: senderId } } as never),
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    archives: () => loadVideoNoteArchives(getDesktopStore()),
    chooseParentDirectory: async () => {
      const result = await dialog.showOpenDialog({ title: '选择文稿导出目录', properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? undefined : result.filePaths[0]
    },
    start: exportVideoNoteArchiveBatch,
    openFolder: (path) => shell.openPath(path),
    send: (senderId, channel, value) => webContents.fromId(senderId)?.send(channel, value)
  })
  ipcMain.handle(
    'video-audio:transcribe-current',
    async (event, request: VideoAudioTranscriptionRequest) => {
      assertCurrentAccountOwnsTranscriptionRequest(await readCurrentBilibiliAccountMid(), request)
      const tempDir = await mkdtemp(join(tmpdir(), 'bilimi-transcribe-'))
      const sourceSession = session.fromPartition(BILIMI_SESSION_PARTITION)
      const preferences = loadAssistantPreferences(getDesktopStore())
      const transcriptionModelId = request.transcriptionModelId ?? (request.accountMid
        ? loadFavoriteAccountPreferences(getDesktopStore(), request.accountMid).transcriptionModelId ?? 'whisper-small'
        : 'whisper-small')

      try {
        return await transcribeCurrentVideoAudio({
        request: { ...request, transcriptionModelId },
        session: sourceSession,
        tempDir,
        threadLimit: preferences.videoAudioTranscriptionThreadLimit,
        resolveTranscriber: createTranscriptionProviderResolver({
          resolveSenseVoicePaths: () => transcriptionModelManager.resolveSenseVoicePaths(),
          resolveWhisperModelPath: () => transcriptionModelManager.resolveWhisperSmallPath(),
          resolveFasterWhisperPaths: (id) => transcriptionModelManager.resolveFasterWhisperPaths(id),
          resolveFasterWhisperRuntime: request.transcriptionDeviceOverride === 'cpu'
            ? async () => ({ device: 'cpu' as const, computeType: 'int8' as const })
            : resolveVerifiedFasterWhisperRuntime
        }),
        progress: (progress) => {
          event.sender.send('video-audio:transcription-progress', progress)
          }
        })
      } finally {
        disposeDefaultFasterWhisperGpuSessions()
      }
    }
  )
  ipcMain.handle('video-audio:transcription-queue-load', async () =>
    filterTranscriptionQueueSnapshotForAccount(
      getVideoTranscriptionQueue().getSnapshot(),
      await readCurrentBilibiliAccountMid()
    )
  )
  ipcMain.handle('video-audio:transcription-models-list', () => transcriptionModelManager.list())
  ipcMain.handle('video-audio:transcription-model-gpu-probe', (_event, id: TranscriptionModelId) =>
    transcriptionModelManager.probeFasterWhisperGpu(id)
  )
  registerTranscriptionModelIpc({
    ipcMain,
    manager: transcriptionModelManager,
    send: (senderId, channel, value) => webContents.fromId(senderId)?.send(channel, value),
    selectDirectory: async () => {
      const selection = await dialog.showOpenDialog({
        title: '导入已校验的转写模型文件夹',
        properties: ['openDirectory']
      })
      return selection.canceled ? undefined : selection.filePaths[0]
    }
  })
  ipcMain.handle('video-audio:transcription-model-delete', async (_event, id) => {
    const preferences = loadAssistantPreferences(getDesktopStore())
    const currentModelIsReferenced = Object.values(preferences.favoriteAccountPreferences ?? {})
      .some((account) => account.transcriptionModelId === id)
    if (currentModelIsReferenced) throw new Error('The current transcription model cannot be removed.')
    await transcriptionModelManager.remove(id, (modelId) => getVideoTranscriptionQueue().getSnapshot().items
      .some((item) => ['pending', 'running', 'waiting-restart'].includes(item.status) && item.transcriptionModelId === modelId))
    return transcriptionModelManager.list()
  })
  ipcMain.handle(
    'video-audio:transcription-queue-enqueue',
    async (_event, request: VideoAudioTranscriptionRequest) => {
      const currentAccountMid = await readCurrentBilibiliAccountMid()
      if (!request.accountMid || request.accountMid !== currentAccountMid) {
        throw new Error('当前账号已切换，无法创建原账号的转写任务。')
      }
      return getVideoTranscriptionQueue().enqueue(request)
    }
  )
  ipcMain.handle('video-audio:transcription-queue-cancel', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).cancel(id))
  ipcMain.handle('video-audio:transcription-queue-cancel-summary', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).cancelSummary(id))
  ipcMain.handle('video-audio:transcription-queue-retry', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).retry(id))
  ipcMain.handle('video-audio:transcription-queue-retry-cpu', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).retryOnCpu(id))
  ipcMain.handle('video-audio:transcription-queue-retry-archive-registration', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).retryArchiveRegistration(id))
  ipcMain.handle('video-audio:transcription-queue-retry-summary', async (_event, id: string) => (await getCurrentAccountTranscriptionQueue([id])).retrySummary(id))
  ipcMain.handle('video-audio:transcription-queue-batch-cancel-waiting', async (_event, ids: string[]) =>
    (await getCurrentAccountTranscriptionQueue(ids)).cancelWaitingBatch(ids)
  )
  ipcMain.handle('video-audio:transcription-queue-batch-retry', async (_event, ids: string[]) =>
    (await getCurrentAccountTranscriptionQueue(ids)).retryBatch(ids)
  )
  ipcMain.handle('video-audio:transcription-queue-batch-remove', async (_event, ids: string[]) =>
    (await getCurrentAccountTranscriptionQueue(ids)).removeBatch(ids)
  )
  ipcMain.handle('video-audio:transcription-queue-batch-stop-preview', async (_event, ids: string[]) =>
    (await getCurrentAccountTranscriptionQueue(ids)).createRunningStopConfirmation(ids)
  )
  ipcMain.handle('video-audio:transcription-queue-batch-stop', async (_event, ids: string[], confirmationToken: string): Promise<VideoTranscriptionQueueBatchResult> =>
    (await getCurrentAccountTranscriptionQueue(ids)).stopRunningBatch(ids, confirmationToken)
  )
  ipcMain.handle('assistant-pet:restore-main-window', () => {
    restoreMainWindowForPet()
  })
  ipcMain.on('assistant-pet:close', () => {
    closeAssistantPetWindow()
  })
  ipcMain.handle('main-window:presentation-state', () => getMainWindowPresentationState(mainWindow))
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
      openAssistantWorkspace(payload)
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
  ipcMain.on('floating-seal:set-mouse-transparent', (event, transparent: boolean) => {
    if (event.sender.id !== floatingSealWindow?.webContents.id) return
    setFloatingSealWindowMouseTransparent(Boolean(transparent))
  })
  ipcMain.on('floating-seal:update-interactive-regions', (event, regions: unknown) => {
    if (event.sender.id !== floatingSealWindow?.webContents.id || !Array.isArray(regions)) return
    floatingSealMouseRecovery?.updateInteractiveRegions(regions)
  })
  ipcMain.handle('floating-seal:move-by', (_event, deltaX: number, deltaY: number) => {
    moveFloatingSealBy(deltaX, deltaY)
  })
}

configureDevelopmentUserData(app, {
  isPackaged: app.isPackaged,
  // E2E runs can opt into a disposable absolute profile; normal development
  // and every packaged build retain their existing user-data locations.
  userDataOverride: process.env.BILIMI_TEST_USER_DATA
})
configureDevelopmentRuntimeSwitches(app, {
  isPackaged: app.isPackaged,
  deviceScaleFactor: process.env.BILIMI_TEST_DEVICE_SCALE_FACTOR,
  reducedMotion: process.env.BILIMI_TEST_REDUCED_MOTION === '1'
})
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
  return fetchFavoriteVideoMetadata({
    accountMid,
    aid,
    readCurrentAccountMid: readCurrentBilibiliAccountMid,
    fetch: (url) => session.fromPartition(BILIMI_SESSION_PARTITION).fetch(url.toString())
  })
}

function isTrustedFavoriteLibraryReader(senderId: number): boolean {
  return senderId === mainWindow?.webContents.id
}

if (singleInstanceGuard) app.whenReady().then(async () => {
  await bilibiliSessionProxy.applyPreference(readBilibiliConnectionMode()).catch(() => undefined)
  favoriteRepositoryService = new FavoriteRepositoryService({
    root: join(app.getPath('userData'), 'favorites', 'repository-v1'),
    getTranscriptionRevision: () => queuePublishGeneration,
    getTranscriptionItems: () => getVideoTranscriptionQueue().getSnapshot().items,
    getTranscriptionArchives: () => loadVideoNoteArchives(getDesktopStore())
  })
  const recoveredPortableImport = await favoriteRepositoryService.recoverPortableImportTransaction()
  if (recoveredPortableImport) {
    const recovery = recoveredPortableImport.recoveryState as Partial<{
      archives: ReturnType<typeof loadVideoNoteArchives>
      transcription: ReturnType<typeof getVideoTranscriptionQueue>['getSnapshot']['items']
      preferences: ReturnType<typeof loadAssistantPreferences>
    }> | undefined
    if (!recovery || !Array.isArray(recovery.archives) || !Array.isArray(recovery.transcription) || !recovery.preferences) {
      throw new Error('Portable import recovery state is invalid.')
    }
    const store = getDesktopStore()
    store.set('videoNoteArchives', recovery.archives)
    saveVideoAudioTranscriptionQueue(store, recovery.transcription)
    store.set('favoriteAccountPreferences', recovery.preferences.favoriteAccountPreferences)
    patchAssistantPreferences(store, portableSharedSettings(recovery.preferences))
    await favoriteRepositoryService.finalizePortableImportRecovery()
  }
  favoriteRepositoryPageBridgeManager = new FavoriteRepositoryRuntimePageBridgeManager(
    (request) => requestMainAssistantRuntime<FavoriteRepositoryPageOperationResult>(request)
  )
  favoriteRepositorySyncService = new FavoriteRepositorySyncService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations,
    ensurePhysicalShard: (accountMid, input) => favoriteRepositoryBindingService!.ensurePhysicalShard(accountMid, input)
  })
  favoriteRepositoryBindingService = new FavoriteRepositoryBindingService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations
  })
  favoriteLibraryCommandService = new FavoriteLibraryCommandService({
    repository: favoriteRepositoryService,
    transcriptionQueue: getVideoTranscriptionQueue(),
    refreshVideo: refreshFavoriteLibraryVideo,
    placementSync: favoriteRepositorySyncService,
    remoteUnfavorite: createFavoriteLibraryRemoteUnfavorite({
      pageBridgeManager: favoriteRepositoryPageBridgeManager!,
      remoteOperations: favoriteRepositoryRemoteOperations
    })
  })
  favoriteRepositoryBatchOperationService = new FavoriteRepositoryBatchOperationService({
    repository: favoriteRepositoryService,
    remoteUnfavorite: createFavoriteLibraryRemoteUnfavorite({
      pageBridgeManager: favoriteRepositoryPageBridgeManager!,
      remoteOperations: favoriteRepositoryRemoteOperations
    }),
    remoteArbiter: favoriteRepositoryRemoteOperations,
    remoteObserver: {
      async areUnfavorited(accountMid, aids) {
        // The page bridge cannot prove membership across every Bilibili folder,
        // so a partial inventory must never resolve an ambiguous global write.
        void accountMid
        void aids
        return 'unknown' as const
      }
    }
  })
  favoriteRepositoryManagedFolderService = new FavoriteRepositoryManagedFolderService({
    repository: favoriteRepositoryService,
    remoteArbiter: favoriteRepositoryRemoteOperations,
    dismissRemoteFolder: (accountMid, remoteFolderId) =>
      dismissFavoriteLibraryRemoteFolder(getDesktopStore(), accountMid, remoteFolderId),
    remote: {
      async removeRemoteFolder(accountMid, remoteFolderId) {
        const runId = `favorite-managed-folder-delete:${Date.now()}:${remoteFolderId}`
        await favoriteRepositoryPageBridgeManager!.bind(accountMid, runId)
        try {
          await favoriteRepositoryPageBridgeManager!.pageBridge(accountMid, runId).deleteFolder({
            accountMid, operationKey: `${runId}:delete`, folderId: remoteFolderId
          })
        } finally {
          favoriteRepositoryPageBridgeManager!.release(accountMid, runId)
        }
      }
    },
    remoteObserver: {
      async remoteFolderExists(accountMid, remoteFolderId) {
        const runId = `favorite-managed-folder-reconcile:${Date.now()}:${remoteFolderId}`
        await favoriteRepositoryPageBridgeManager!.bind(accountMid, runId)
        try {
          const inventory = await favoriteRepositoryPageBridgeManager!.pageBridge(accountMid, runId).readFolderInventory({
            accountMid, operationKey: `${runId}:inventory`
          })
          return inventory.folders.some((folder) => folder.id === remoteFolderId) ? 'present' : 'absent'
        } finally {
          favoriteRepositoryPageBridgeManager!.release(accountMid, runId)
        }
      }
    }
  })
  localDataService = new LocalDataService({
    root: app.getPath('userData'),
    appVersion: app.getVersion(),
    persistence: createLocalDataPersistenceAdapter({
      listAccountUids: async () => {
        const preferences = loadAssistantPreferences(getDesktopStore())
        return Object.keys(preferences.favoriteAccountPreferences)
      },
      listRetainedAccountUids: async () => favoriteRepositoryService!.listRetainedAccountUids(),
      getRepository: (uid) => favoriteRepositoryService!.getSnapshot(uid),
      getAccountSettings: (uid) => loadFavoriteAccountPreferences(getDesktopStore(), uid),
      getArchives: () => loadVideoNoteArchives(getDesktopStore()),
      getTranscriptionItems: () => getVideoTranscriptionQueue().getSnapshot().items,
      getAuditEvents: (uid) => favoriteRepositoryService!.getPortableAuditEvents(uid),
      getWorkspaces: (uid) => favoriteRepositoryService!.getPortableWorkspaceRecovery(uid),
      getRemoteOperations: (uid) => favoriteRepositoryService!.getPortableRemoteRecoveries(uid),
      applyPortableBatch: async (batch) => {
        const retainedUids = new Set(Object.keys(batch.repositoryArchives))
        const existingUids = Object.keys(loadAssistantPreferences(getDesktopStore()).favoriteAccountPreferences)
        for (const uid of existingUids.filter((uid) => !retainedUids.has(uid))) {
          await favoriteRepositoryService!.deleteAccountLocalData(uid)
        }
        for (const [uid, archive] of Object.entries(batch.repositoryArchives)) {
          await favoriteRepositoryService!.applyArchiveImport(uid, { validate: () => archive })
          const settings = batch.settingsByUid[uid]
          if (settings) {
            const current = loadFavoriteAccountPreferences(getDesktopStore(), uid)
            const candidate = settings as Partial<typeof current>
            if (typeof candidate.defaultFavoriteSystemEnabled !== 'boolean' || !Array.isArray(candidate.favoriteLedgers)) {
              throw new Error('Portable account settings are invalid.')
            }
            saveFavoriteAccountPreferences(getDesktopStore(), uid, {
              defaultFavoriteSystemEnabled: candidate.defaultFavoriteSystemEnabled,
              favoriteLedgers: candidate.favoriteLedgers,
              ...(candidate.transcriptionModelId ? { transcriptionModelId: candidate.transcriptionModelId } : {}),
              ...(typeof candidate.updatedAt === 'string' ? { updatedAt: candidate.updatedAt } : {}),
              ...(candidate.favoriteLibraryCollapsedGroups && typeof candidate.favoriteLibraryCollapsedGroups === 'object'
                ? { favoriteLibraryCollapsedGroups: candidate.favoriteLibraryCollapsedGroups } : {})
            })
          }
        }
        const importedArchives = Object.values(batch.archivesByUid).flat()
        const retainedArchives = loadVideoNoteArchives(getDesktopStore()).filter((archive) => !Object.hasOwn(batch.archivesByUid, archive.source.accountMid))
        getDesktopStore().set('videoNoteArchives', [...retainedArchives, ...importedArchives])
        const importedTranscription = Object.values(batch.transcriptionByUid).flat()
        const retainedTranscription = getVideoTranscriptionQueue().getSnapshot().items.filter((item) => !item.accountMid || !Object.hasOwn(batch.transcriptionByUid, item.accountMid))
        saveVideoAudioTranscriptionQueue(getDesktopStore(), [...retainedTranscription, ...importedTranscription])
        const preferences = loadAssistantPreferences(getDesktopStore())
        getDesktopStore().set('favoriteAccountPreferences', Object.fromEntries(
          Object.entries(preferences.favoriteAccountPreferences).filter(([uid]) => retainedUids.has(uid))
        ))
      },
      applyPortableState: async (batch, sharedSettings, options) => {
        // The store update is published only after all repository generations have validated.
        const selectedUids = new Set(options.selectedUids)
        const store = getDesktopStore()
        const previous = {
          archives: loadVideoNoteArchives(store),
          transcription: getVideoTranscriptionQueue().getSnapshot().items,
          preferences: loadAssistantPreferences(store)
        }
        let transactionStarted = false
        try {
          await favoriteRepositoryService!.beginPortableImportTransaction([...selectedUids], previous)
          transactionStarted = true
          for (const uid of selectedUids) {
            const archive = batch.repositoryArchives[uid]
            if (!archive) {
              // A rollback can include a newly imported UID that did not exist
              // in the pre-import snapshot. Its absent projection is an
              // intentional account-scoped deletion, not malformed input.
              await favoriteRepositoryService!.deleteAccountLocalData(uid)
              continue
            }
            await favoriteRepositoryService!.applyArchiveImport(uid, { validate: () => archive, mode: options.mode })
          }
          const accountPreferences = { ...previous.preferences.favoriteAccountPreferences }
          for (const uid of selectedUids) if (!Object.hasOwn(batch.settingsByUid, uid)) delete accountPreferences[uid]
          for (const [uid, settings] of Object.entries(batch.settingsByUid).filter(([uid]) => selectedUids.has(uid))) {
            const current = loadFavoriteAccountPreferences(store, uid)
            const candidate = settings as Partial<typeof current>
            if (typeof candidate.defaultFavoriteSystemEnabled !== 'boolean' || !Array.isArray(candidate.favoriteLedgers)) {
              throw new Error('Portable account settings are invalid.')
            }
            // `staged` already chose merge-vs-overwrite by its durable record
            // timestamp. Apply that selected account projection verbatim so an
            // explicit false cannot be accidentally retained as local true.
            accountPreferences[uid] = {
              defaultFavoriteSystemEnabled: candidate.defaultFavoriteSystemEnabled,
              favoriteLedgers: candidate.favoriteLedgers,
              ...(candidate.transcriptionModelId ? { transcriptionModelId: candidate.transcriptionModelId } : {}),
              ...(typeof candidate.updatedAt === 'string' ? { updatedAt: candidate.updatedAt } : {}),
              ...(candidate.favoriteLibraryCollapsedGroups && typeof candidate.favoriteLibraryCollapsedGroups === 'object'
                ? { favoriteLibraryCollapsedGroups: candidate.favoriteLibraryCollapsedGroups } : {})
            }
          }
          const selectedArchiveValues = Object.entries(batch.archivesByUid).filter(([uid]) => selectedUids.has(uid)).flatMap(([, archives]) => archives)
          store.set('videoNoteArchives', [...previous.archives.filter((archive) => !selectedUids.has(archive.source.accountMid ?? '')), ...selectedArchiveValues])
          const selectedTranscription = Object.entries(batch.transcriptionByUid).filter(([uid]) => selectedUids.has(uid)).flatMap(([, items]) => items)
          saveVideoAudioTranscriptionQueue(store, [...previous.transcription.filter((item) => !item.accountMid || !selectedUids.has(item.accountMid)), ...selectedTranscription])
          store.set('favoriteAccountPreferences', accountPreferences)
          patchAssistantPreferences(store, portableSharedSettings(sharedSettings))
          await favoriteRepositoryService!.commitPortableImportTransaction()
        } catch (error) {
          if (transactionStarted) {
            const recovered = await favoriteRepositoryService!.abortPortableImportTransaction()
            const recovery = recovered?.recoveryState as typeof previous | undefined
            if (recovery) {
              store.set('videoNoteArchives', recovery.archives)
              saveVideoAudioTranscriptionQueue(store, recovery.transcription)
              store.set('favoriteAccountPreferences', recovery.preferences.favoriteAccountPreferences)
              patchAssistantPreferences(store, portableSharedSettings(recovery.preferences))
              await favoriteRepositoryService!.finalizePortableImportRecovery()
            }
          }
          store.set('videoNoteArchives', previous.archives)
          saveVideoAudioTranscriptionQueue(store, previous.transcription)
          store.set('favoriteAccountPreferences', previous.preferences.favoriteAccountPreferences)
          throw error
        }
      },
      readSharedSettings: () => {
        const preferences = loadAssistantPreferences(getDesktopStore())
        return {
          theme: preferences.theme, language: preferences.language, windowBounds: preferences.windowBounds,
          closeBehavior: preferences.closeBehavior, favoritesFolderName: preferences.favoritesFolderName
        }
      },
      writeSharedSettings: (settings) => {
        patchAssistantPreferences(getDesktopStore(), portableSharedSettings(settings))
      }
    })
  })
  localDataService.setDestructiveHooks({
    stopActiveWork: async () => {
      // Do not clear state while a task can still publish durable local or remote results.
      await getVideoTranscriptionQueue().cancelAllAndWait()
      await oldFavoriteWorkspaceScanService?.quiesceForDestructiveMaintenance()
      await oldFavoriteWorkspaceDeepSeekService?.quiesceForDestructiveMaintenance()
      await favoriteRepositoryRemoteOperations.runDestructiveMaintenance(async () => {
        await favoriteRepositoryService?.flush()
      })
    },
    cleanupFailed: () => favoriteRepositoryRemoteOperations.resumeAfterFailedMaintenance(),
    clearLoginSessions: () => session.fromPartition(BILIMI_SESSION_PARTITION).clearStorageData({ storages: ['cookies'] }),
    exitApp: () => app.quit()
  })
  const favoriteRepositoryArchiveService = new FavoriteRepositoryArchiveService({
    repository: favoriteRepositoryService,
    remoteOperations: favoriteRepositoryRemoteOperations,
    loadArchiveIndex: async (accountMid) => loadVideoNoteArchives(getDesktopStore()).flatMap((archive) =>
      archive.source.accountMid === accountMid
        ? archive.versions.flatMap((version) => {
            const match = version.note.id.match(/^account:\d+:aid:(\d+)(?::cid:\d+)?$/)
            return match ? [{ aid: Number(match[1]), archiveId: archive.id, registeredAt: version.createdAt }] : []
          })
        : []
    ),
    applyImportedArchive: (archive) => favoriteRepositoryService!.applyArchiveImport(archive.accountMid, {
      validate: () => archive
    })
  })
  oldFavoriteWorkspaceCoordinator = new OldFavoriteWorkspaceCoordinator({
    repository: favoriteRepositoryService,
    syncService: favoriteRepositorySyncService,
    bindingService: favoriteRepositoryBindingService,
    classifyCurrentItems: (items, recommendedLedgers = [], accountMid, options) => {
      // Capture the saved rules once per workspace command, then classify its segment in memory.
      const accountPreferences = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const ledgers = mergeOldFavoriteWorkspaceLedgers(
        classifierLedgersForAccount(
          accountPreferences.favoriteLedgers,
          accountPreferences.defaultFavoriteSystemEnabled
        ),
        recommendedLedgers
      )
      return classifyOldFavoriteItemsCooperatively(items, (batch) => batch.map((item) => {
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
      }), options)
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
    resolveRecoveryConfiguration: (accountMid) => {
      const preferences = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const ledgers = classifierLedgersForAccount(
        preferences.favoriteLedgers,
        preferences.defaultFavoriteSystemEnabled
      ).map((ledger) => ({
        id: ledger.id,
        displayName: ledger.displayName,
        enabled: ledger.enabled,
        priority: ledger.priority,
        ruleType: ledger.ruleType ?? 'keyword',
        keywords: [...ledger.keywords].sort(),
        isDefault: ledger.isDefault
      })).sort((left, right) => left.id.localeCompare(right.id))
      return {
        metadata: ledgers.map(({ id, displayName, enabled, priority, isDefault }) => ({ id, displayName, enabled, priority, isDefault })),
        rules: ledgers.map(({ id, ruleType }) => ({ id, ruleType })),
        keywords: ledgers.map(({ id, keywords }) => ({ id, keywords })),
        defaultSettings: { defaultFavoriteSystemEnabled: preferences.defaultFavoriteSystemEnabled }
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
    saveRecommendedLedgers: async (accountMid, ledgers, adoptedLedgerIds = ledgers.map((ledger) => ledger.id)) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const favoriteLedgers = reconcileRecommendedLedgers(current.favoriteLedgers, ledgers, adoptedLedgerIds)
      if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers
      })
      return true
    },
    notifyRecommendedLedgersChanged: () => {
      sendAssistantPreferencePatchChanged({
        favoriteAccountPreferences: loadAssistantPreferences(getDesktopStore()).favoriteAccountPreferences
      })
    },
    saveRecoveredLedgerDrafts: async (accountMid, ledgers) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const favoriteLedgers = mergeRecoveredLedgerDrafts(current.favoriteLedgers, ledgers)
      if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers
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
    resumeScan: (accountMid) => oldFavoriteWorkspaceScanService!.resume(accountMid),
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
      createFavoriteLibraryTranscriptionSummary(accountMid, aid, getVideoTranscriptionQueue().getSnapshot().items),
    onAccountOpen: async (accountMid) => {
      // A previous complete scan already contains the full remote inventory.
      // Restore only its unique, complete Bilimi bindings before the drawer
      // projects folders, so old managed folders do not reappear as ordinary.
      await oldFavoriteWorkspaceCoordinator!.recoverPersistedManagedBindings(accountMid)
      const ledger = loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
        .find((candidate) => candidate.id === 'inbox' && candidate.bilibiliFolderId?.trim())
      if (!ledger?.bilibiliFolderId) return
      const snapshot = await favoriteRepositoryService!.getSnapshot(accountMid)
      const existing = snapshot.physicalShards.find((shard) => shard.logicalLedgerId === ledger.id && shard.shardNumber === 1)
      if (existing?.bindingState === 'bound' && existing.remoteFolderId === ledger.bilibiliFolderId) return
      if (isFavoriteLibraryRemoteFolderDismissed(getDesktopStore(), accountMid, ledger.bilibiliFolderId)) return
      const mirror = snapshot.folders.find((folder) => folder.kind === 'bilibili' && folder.remoteFolderId === ledger.bilibiliFolderId)
      if (!mirror) return
      await favoriteRepositoryBindingService!.adoptExistingPhysicalShard(accountMid, {
        logicalLedgerId: ledger.id,
        logicalTitle: mirror.title,
        expectedRemoteTitle: mirror.title,
        remoteFolderId: ledger.bilibiliFolderId,
        shardNumber: 1,
        memberAids: snapshot.memberships[`bilibili:${ledger.bilibiliFolderId}`] ?? []
      })
    },
    commandService: favoriteLibraryCommandService,
    archiveService: favoriteRepositoryArchiveService,
    archiveRestoreWriter: favoriteRepositorySyncService.createArchiveRestoreWriter()
  })
  registerFavoriteLibraryCommandsIpc({
    ipcMain,
    commands: favoriteLibraryCommandService,
    isTrustedLibrarySender: isTrustedFavoriteLibraryReader,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    resolveSelection: (accountMid, selection) => favoriteRepositoryService.resolveLibrarySelection(
      accountMid, selection.scope, selection.options, selection.excludedAids
    ),
    async resolveDocumentExportSelection(accountMid, aids) {
      const snapshot = await favoriteRepositoryService.getSnapshot(accountMid)
      const archives = loadVideoNoteArchives(getDesktopStore())
      const selections = new Map<string, { archiveId: string; versionId: string }>()
      const skippedAids: number[] = []
      for (const aid of aids) {
        const video = snapshot.videos[String(aid)]
        if (!video) {
          skippedAids.push(aid)
          continue
        }
        try {
          const selection = archiveNavigationForVideo(archives, accountMid, aid, video.cid)
          selections.set(`${selection.archiveId}:${selection.versionId}`, selection)
        } catch {
          // A video can be filtered by completed queue state while its archive is still unavailable.
          skippedAids.push(aid)
        }
      }
      return { selections: [...selections.values()], skippedAids }
    }
  })
  registerFavoriteLibraryOperationsIpc({
    ipcMain,
    batch: favoriteRepositoryBatchOperationService,
    managed: favoriteRepositoryManagedFolderService,
    isTrustedSender: isTrustedFavoriteLibraryReader,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    async resolveSelection(accountMid, selection) {
      return favoriteRepositoryService!.resolveLibrarySelection(accountMid, selection.scope, selection.options, selection.excludedAids)
    },
    async resolveSourceScope(accountMid, source, requestedAids) {
      const snapshot = await favoriteRepositoryService!.getSnapshot(accountMid)
      if (source.kind === 'folder') {
        const folder = snapshot.folders.find((candidate) => candidate.id === source.folderId)
        if (!folder) throw new Error('Favorite operation source was not found.')
        if (folder.kind === 'bilimi-logical') return { kind: 'bilimi-logical', folderId: folder.id }
        if (folder.kind === 'bilibili') return {
          kind: folder.remoteFolderId === '1' ? 'bilibili-default' : 'bilibili-user', folderId: folder.id
        }
        throw new Error('Favorite operation source does not support batch actions.')
      }
      const eligible = new Set(source.eligibleAids)
      const skipped = new Set(source.skippedAids)
      if (eligible.size !== source.eligibleAids.length || skipped.size !== source.skippedAids.length ||
        [...eligible].some((aid) => skipped.has(aid)) || requestedAids.some((aid) => !eligible.has(aid))) {
        throw new Error('Favorite virtual source eligibility evidence is invalid.')
      }
      return { kind: 'virtual', eligibleAids: [...eligible].sort((left, right) => left - right), skippedAids: [...skipped].sort((left, right) => left - right) }
    }
  })
  registerFavoriteLibraryBridgeIpc({
    ipcMain,
    isTrustedLibrarySender: isTrustedFavoriteLibraryReader,
    readAccount: readCurrentBilibiliAccount,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    getSnapshot: (accountMid) => favoriteRepositoryService!.getSnapshot(accountMid),
    loadArchives: () => loadVideoNoteArchives(getDesktopStore()),
    updateArchiveVersion: async (archiveId, versionId, note) => {
      const accountMid = await readCurrentBilibiliAccountMid()
      const existingVersion = assertCurrentAccountOwnsArchiveVersion(loadVideoNoteArchives(getDesktopStore()), accountMid, archiveId, versionId)
      assertCurrentAccountOwnsVerifiedArchiveNote(accountMid, note)
      assertArchiveVersionMatchesReplacementNote(existingVersion, note)
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
  registerLocalDataIpc({
    ipcMain,
    service: localDataService,
    isTrustedSender: isTrustedOldFavoriteSessionSender,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    getCurrentAccount: readCurrentBilibiliAccount,
    userDataPath: app.getPath('userData'),
    chooseExportPath: async () => {
      const result = await dialog.showSaveDialog({ defaultPath: 'bilimi-local-data.json', filters: [{ name: 'bilimi migration', extensions: ['json'] }] })
      return result.canceled ? undefined : result.filePath
    },
    chooseImportPath: async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'bilimi migration', extensions: ['json'] }] })
      return result.canceled ? undefined : result.filePaths[0]
    },
    openUserDataPath: async () => { await shell.openPath(app.getPath('userData')) },
    onAccountDataCleared: (accountMid) => {
      videoNoteBatchExportIpc?.clearCompletedFoldersForAccount(accountMid)
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('favorite-library:account-data-cleared', accountMid)
    }
  })
  ipcMain.handle('favorite-library:window-control', (event, action: unknown) => {
    if (!isTrustedFavoriteLibraryReader(event.sender.id) || !mainWindow) throw new Error('Favorite library window control is unavailable.')
    if (action === 'minimize') return mainWindow.minimize()
    if (action === 'expand-and-maximize') {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isMaximized()) mainWindow.maximize()
      return
    }
    throw new Error('Favorite library window action is invalid.')
  })
  ipcMain.handle('favorite-library:get-ui-preferences', async (event, requestedAccountMid: unknown) => {
    if (!isTrustedFavoriteLibraryReader(event.sender.id) || typeof requestedAccountMid !== 'string' || requestedAccountMid !== await readCurrentBilibiliAccountMid()) throw new Error('Favorite library preferences are unavailable.')
    return loadFavoriteAccountPreferences(getDesktopStore(), requestedAccountMid).favoriteLibraryCollapsedGroups ?? {}
  })
  ipcMain.handle('favorite-library:save-ui-preferences', async (event, requestedAccountMid: unknown, collapsedGroups: unknown) => {
    if (!isTrustedFavoriteLibraryReader(event.sender.id) || typeof requestedAccountMid !== 'string' || requestedAccountMid !== await readCurrentBilibiliAccountMid() || !collapsedGroups || typeof collapsedGroups !== 'object' || Array.isArray(collapsedGroups)) throw new Error('Favorite library preferences are invalid.')
    const current = loadFavoriteAccountPreferences(getDesktopStore(), requestedAccountMid)
    return saveFavoriteAccountPreferences(getDesktopStore(), requestedAccountMid, { ...current, favoriteLibraryCollapsedGroups: collapsedGroups as Record<string, boolean> }).favoriteLibraryCollapsedGroups ?? {}
  })
  let accountChangeTimer: NodeJS.Timeout | undefined
  let lastBilibiliAccountMid = await readCurrentBilibiliAccountMid()
  session.fromPartition(BILIMI_SESSION_PARTITION).cookies.on('changed', (_event, cookie) => {
    if (cookie.name === 'DedeUserID' || cookie.name === 'bili_jct') {
      clearTimeout(accountChangeTimer)
      accountChangeTimer = setTimeout(() => {
        void readCurrentBilibiliAccountMid().then((nextAccountMid) => {
           if (nextAccountMid !== lastBilibiliAccountMid) videoNoteBatchExportIpc?.clearAll()
           lastBilibiliAccountMid = nextAccountMid
           // Clear/provide the account-scoped queue immediately even when no
           // transcription state changes after the account switch.
           publishVideoAudioTranscriptionQueueChanged(getVideoTranscriptionQueue().getSnapshot(), false)
           notifyFloatingAssistantSnapshotChanged()
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bilibili:account-changed')
        })
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
app.on('before-quit', disposeDefaultFasterWhisperHelperSessions)

app.on('window-all-closed', () => {
  if (appQuitting && process.platform !== 'darwin') app.quit()
})
