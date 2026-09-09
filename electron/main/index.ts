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
import { createHash, randomUUID } from 'node:crypto'
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
  getFavoriteLedgerEnabledOverrideStore,
  saveFavoriteAccountPreferences,
  loadFavoriteLedgerRemoteDraftRediscoveryPending,
  markFavoriteLedgerRemoteDraftRediscoveryPending,
  consumeFavoriteLedgerRemoteDraftRediscoveryPending,
  loadFavoriteLedgerRemoteDraftReminderDismissals,
  dismissFavoriteLedgerRemoteDraftReminder,
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
import { setFloatingSealMouseTransparency } from './floatingSealMouseTransparency'
import { createFloatingSealMouseRecoveryController } from './floatingSealMouseRecovery'
import { createFloatingSealWakeController } from './floatingSealWakeController'
import {
  cancelFloatingSealIdleTask,
  disposeFloatingSealIdleTaskScheduler,
  noteStartupInputActivity,
  scheduleFloatingSealIdleTask,
  type FloatingSealIdleTaskHandle
} from './floatingSealIdleTask'
import { installFloatingSealWhiteStripFix } from './floatingSealWhiteStripFix'
import { createFloatingSealWindowOptions } from './floatingSealWindowOptions'
import { toggleFloatingAssistantFromSeal } from './floatingMenuToggleFlow'
import { FLOATING_ASSISTANT_SIZE } from './floatingAssistantWindowSize'
import { createFavoriteRepositoryQuitBarrier } from './favoriteRepositoryQuitBarrier'
import { OldFavoriteWorkspaceCoordinator } from './oldFavoriteWorkspaceCoordinator'
import { OldFavoriteWorkspaceStore } from './oldFavoriteWorkspaceStore'
import { OldFavoriteWorkspaceScanService } from './oldFavoriteWorkspaceScanService'
import { OldFavoriteWorkspaceDeepSeekService } from './oldFavoriteWorkspaceDeepSeekService'
import { recordFavoriteLedgerHistoryAroundMutation } from './favoriteLedgerHistoryWiring'
import { classifyOldFavoriteItemsCooperatively, classifierLedgersForAccount, enableDefaultLedgersForOrganization, mergeOldFavoriteWorkspaceLedgers } from './oldFavoriteWorkspaceClassification'
import { resolveSavedOldFavoriteWorkspaceLedgerTitle } from './oldFavoriteWorkspaceLedgerTitle'
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
import { persistConfirmedManagedFolderDeletion } from './managedFavoriteLedgerDeletionPersistence'
import { resolveFavoriteLibraryOperationSource } from './favoriteLibraryOperationSource'
import {
  isUnsavedFavoriteLedgerDraft,
  removeLocalFavoriteLedgers,
  removeUnsavedFavoriteLedgerDraft
} from '../../src/shared/favoriteLedgerDraftDeletion'
import { projectFavoriteLedgersFromPhysicalShards } from '../../src/shared/favoriteLedgerBindingProjection'
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
import { refreshBilibiliFavoriteSpacePages, refreshBilibiliGuestPages } from './bilibiliSessionRefresh'
import { BilibiliFavoriteSpaceRefreshCoordinator } from './bilibiliFavoriteSpaceRefreshCoordinator'
import { clearCurrentAccountLocalData } from './currentAccountLocalDataClear'
import {
  configureFloatingMenuWindow,
  createFloatingMenuWindowOptions
} from './floatingMenuWindowOptions'

type FavoriteLedgerEnabledHistoryOptions = {
  mergeFavoriteRuleHistory?: true
}
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
import { disposeFasterWhisperGpuProbes } from './fasterWhisperGpu'
import { createTranscriptionModelManager } from './transcriptionModelManager'
import { registerTranscriptionModelIpc } from './transcriptionModelIpc'
import { validateTranscriptionModelRuntime } from './transcriptionModelRuntimeValidation'
import { createVideoTranscriptionQueue, type VideoTranscriptionQueueBatchResult } from './videoTranscriptionQueue'
import { assertCurrentAccountOwnsTranscriptionQueueItems, assertCurrentAccountOwnsTranscriptionRequest, filterTranscriptionQueueSnapshotForAccount } from './transcriptionQueueAccountGuard'
import { DeepSeekServiceError, generateDeepSeekResult } from './deepseekService'
import { createDeepSeekTaskQueue } from './deepSeekTaskQueue'
import { assertDeepSeekRequestEnabled } from './deepseekFeatureAccess'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { runStartupDiagnostics } from './startupDiagnostics'
import { BILIMI_SESSION_PARTITION } from '../../src/shared/constants'
import { resolveLocalFavoriteLedgerToggleAccountMid } from '../../src/shared/favoriteAccountFallback'
import { createAccountFavoriteRepositorySnapshot } from '../../src/shared/favoriteRepository'
import { classifyVideoContent } from '../../src/shared/recommendation/videoClassifier'
import { createNotePosterText } from '../../src/shared/videoNoteArchive'
import { normalizeAssistantPreferencePatchMeta } from '../../src/shared/assistantPreferencePatchMeta'
import {
  createVideoNoteBatchExportFolderName,
  exportVideoNoteArchiveBatch
} from './videoNoteExportService'
import { chooseVideoNoteExportDestination } from './videoNoteExportDestinationPicker'
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
import { DEFAULT_TRANSCRIPTION_MODEL_ID } from '../../src/shared/transcriptionModels'
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
let cancelRecompositeFloatingSealWindow: (() => void) | null = null
let whiteStripRecompositeHandle: FloatingSealIdleTaskHandle | undefined
let cancelFloatingSealStartupStages: (() => void) | null = null
let scheduleFloatingSealPostShowStartupStages: (() => void) | null = null
let floatingSealMouseRecovery: ReturnType<typeof createFloatingSealMouseRecoveryController> | null = null
let floatingSealMouseTransparent = true
let floatingSealInteractiveRegions: unknown[] = []
let assistantPetState: AssistantPetState = 'idle'
let petHiddenForVideoFullscreen = false
let floatingAssistantSide: FloatingAssistantSide | undefined
const startupTraceStartedAt = Date.now()
function traceStartupPhase(phase: string) {
  if (process.env.BILIMI_STARTUP_DIAGNOSTICS !== '1') return
  console.info(`[startup] ${phase} +${Date.now() - startupTraceStartedAt}ms`)
}
function yieldStartupEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}
const bilibiliSessionProxy = new BilibiliSessionProxy(() => session.fromPartition(BILIMI_SESSION_PARTITION))

function normalizeBilibiliConnectionMode(value: unknown): 'auto' | 'direct' {
  return value === 'direct' ? value : 'auto'
}

function readBilibiliConnectionMode() {
  return normalizeBilibiliConnectionMode(loadAssistantPreferences(getDesktopStore()).bilibiliConnectionMode)
}

function writeBilibiliConnectionMode(mode: 'auto' | 'direct') {
  const store = getDesktopStore()
  writeAssistantPreferencePatch(store, { bilibiliConnectionMode: mode })
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
  installStartupInputObservers(win)

  win.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.setWindowOpenHandler(({ url }) => routeWindowOpenToRendererTab(win, url))
    installStartupInputObserver(webContents)
    mainWindowGuestWebContentsIds.add(webContents.id)
    webContents.once('dom-ready', () => rememberHomeGuestLoadOutcome(webContents.id))
    webContents.once('did-stop-loading', () => rememberHomeGuestLoadOutcome(webContents.id))
    webContents.once('did-fail-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
      if (isMainFrame !== false) rememberHomeGuestLoadOutcome(webContents.id)
    })
    webContents.once('destroyed', () => {
      mainWindowGuestWebContentsIds.delete(webContents.id)
      settledHomeGuestIds.delete(webContents.id)
      if (homeWebviewGuestId === webContents.id) homeWebviewGuestId = undefined
    })
  })
}

function installStartupInputObservers(win: BrowserWindow) {
  installStartupInputObserver(win.webContents)
  const noteWindowInput = () => noteStartupInputActivity('foreground')
  win.on('move', noteWindowInput)
  win.on('resize', noteWindowInput)
  win.on('minimize', noteWindowInput)
  win.on('restore', noteWindowInput)
  win.on('close', noteWindowInput)
}

function isPointerMoveInput(inputType: string | undefined, modifiers: string[] | undefined = []) {
  if (inputType !== 'mouseMove' && inputType !== 'pointerMove') return false
  return !modifiers.some((modifier) => {
    const normalizedModifier = modifier.toLowerCase()
    return normalizedModifier === 'left' ||
      normalizedModifier === 'middle' ||
      normalizedModifier === 'right' ||
      normalizedModifier.endsWith('buttondown')
  })
}

function installStartupInputObserver(target: Electron.WebContents) {
  target.on('before-input-event', (_event, input) => {
    noteStartupInputActivity(
      isPointerMoveInput(input.type, input.modifiers) ? 'pointer-move' : 'foreground'
    )
  })
  target.on('input-event', (_event, inputEvent) => {
    noteStartupInputActivity(
      isPointerMoveInput(inputEvent.type, inputEvent.modifiers) ? 'pointer-move' : 'foreground'
    )
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

function installFloatingSealWhiteStripPolish(
  seal: BrowserWindow,
  onWhiteStripFixReady: (
    dispose: ReturnType<typeof installFloatingSealWhiteStripFix>,
    handleDisplayChange: () => void
  ) => void
) {
  if (process.platform !== 'win32') return
  traceStartupPhase('pet-native-polish:start')
  if (seal.isDestroyed() || floatingSealWindow !== seal) return
  const disposeWhiteStripFix = installFloatingSealWhiteStripFix(seal, {
    getWorkArea: (bounds) =>
      createFloatingHostMovementArea({
        visualWorkArea: screen.getDisplayMatching(bounds).workArea,
        padding: FLOATING_SEAL_HOST_PADDING
      })
  })
  const handleFloatingSealDisplayChange = () => {
    if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
    if (whiteStripRecompositeHandle) cancelFloatingSealIdleTask(whiteStripRecompositeHandle)
    whiteStripRecompositeHandle = scheduleFloatingSealIdleTask(async () => {
      whiteStripRecompositeHandle = undefined
      if (seal.isDestroyed() || floatingSealWindow !== seal) return
      await disposeWhiteStripFix.recomposite()
    }, 'floating-seal:white-strip-recomposite')
  }
  onWhiteStripFixReady(disposeWhiteStripFix, handleFloatingSealDisplayChange)
}

function createFloatingSealWindow() {
  traceStartupPhase('pet-window:create')
  const seal = new BrowserWindow(
    createFloatingSealWindowOptions(getFloatingSealBounds(), createPreloadScriptPath(__dirname))
  )
  installStartupInputObservers(seal)
  let enforceSealBounds: (() => void) | null = null
  let disposeWhiteStripFix: ReturnType<typeof installFloatingSealWhiteStripFix> | null = null
  let handleFloatingSealDisplayChange: (() => void) | null = null
  let postShowSetupHandle: FloatingSealIdleTaskHandle | undefined
  let windowSetupHandle: FloatingSealIdleTaskHandle | undefined
  let mouseRecoverySetupHandle: FloatingSealIdleTaskHandle | undefined
  let nativePolishHandle: FloatingSealIdleTaskHandle | undefined
  let postShowSetupQueued = false

  const removeDisplayChangeListeners = () => {
    if (!handleFloatingSealDisplayChange) return
    screen.off('display-metrics-changed', handleFloatingSealDisplayChange)
    screen.off('display-added', handleFloatingSealDisplayChange)
    screen.off('display-removed', handleFloatingSealDisplayChange)
    handleFloatingSealDisplayChange = null
  }

  const cancelStartupStages = () => {
    for (const handle of [postShowSetupHandle, windowSetupHandle, mouseRecoverySetupHandle, whiteStripRecompositeHandle, nativePolishHandle]) {
      if (handle) cancelFloatingSealIdleTask(handle)
    }
    postShowSetupHandle = undefined
    windowSetupHandle = undefined
    mouseRecoverySetupHandle = undefined
    whiteStripRecompositeHandle = undefined
    nativePolishHandle = undefined
    postShowSetupQueued = false
    disposeWhiteStripFix?.()
    disposeWhiteStripFix = null
    removeDisplayChangeListeners()
    recompositeFloatingSealWindow = null
    cancelRecompositeFloatingSealWindow = null
  }
  cancelFloatingSealStartupStages = cancelStartupStages

  const schedulePostShowStartupStages = () => {
    if (postShowSetupQueued || seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
    postShowSetupQueued = true
    postShowSetupHandle = scheduleFloatingSealIdleTask(() => {
      postShowSetupHandle = undefined
      if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
      enforceSealBounds = installFixedFloatingSealBoundsGuard(seal)
      enforceFloatingSealWindowBounds = enforceSealBounds
      windowSetupHandle = scheduleFloatingSealIdleTask(() => {
        windowSetupHandle = undefined
        if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
        seal.setAlwaysOnTop(true, 'floating')
        seal.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        seal.removeMenu()
        mouseRecoverySetupHandle = scheduleFloatingSealIdleTask(() => {
          mouseRecoverySetupHandle = undefined
          if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
          const mouseRecoveryAlreadyExists = Boolean(floatingSealMouseRecovery)
          if (!mouseRecoveryAlreadyExists) {
            floatingSealMouseRecovery = createFloatingSealMouseRecoveryController({
              getCursorPoint: () => screen.getCursorScreenPoint(),
              schedulePoll: (callback, delayMs) => scheduleFloatingSealIdleTask(
                callback,
                'floating-seal:mouse-recovery-poll',
                {
                  minimumDelayMs: delayMs,
                  ignorePointerMove: true,
                  allowConcurrent: true,
                  reportDiagnostics: false
                }
              ),
              cancelPoll: (handle) => cancelFloatingSealIdleTask(handle as FloatingSealIdleTaskHandle),
              window: seal
            })
          }
          floatingSealMouseRecovery.setVisible(false)
          floatingSealMouseRecovery.updateInteractiveRegions(floatingSealInteractiveRegions)
          if (!mouseRecoveryAlreadyExists) {
            floatingSealMouseRecovery.setTransparent(floatingSealMouseTransparent)
          }
          floatingSealMouseRecovery.setVisible(seal.isVisible())
          nativePolishHandle = scheduleFloatingSealIdleTask(async () => {
            nativePolishHandle = undefined
            if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
            installFloatingSealWhiteStripPolish(seal, (dispose, handleDisplayChange) => {
              if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) {
                dispose()
                return
              }
              removeDisplayChangeListeners()
              disposeWhiteStripFix?.()
              disposeWhiteStripFix = dispose
              cancelRecompositeFloatingSealWindow = dispose.cancelRecomposite
              handleFloatingSealDisplayChange = handleDisplayChange
              recompositeFloatingSealWindow = dispose.recomposite
              screen.on('display-metrics-changed', handleDisplayChange)
              screen.on('display-added', handleDisplayChange)
              screen.on('display-removed', handleDisplayChange)
              whiteStripRecompositeHandle = scheduleFloatingSealIdleTask(async () => {
                whiteStripRecompositeHandle = undefined
                if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
                await dispose.recomposite()
                if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return
                traceStartupPhase('pet-native-polish:white-strip-ready')
                traceStartupPhase('pet-native-polish:caption-skipped')
              }, 'floating-seal:white-strip-recomposite')
            })
          }, 'floating-seal:native-polish')
        }, 'floating-seal:mouse-recovery')
      }, 'floating-seal:window-setup')
    }, 'floating-seal:bounds-setup')
  }
  scheduleFloatingSealPostShowStartupStages = schedulePostShowStartupStages

  // A cold pet window must use only the click-through setup required for its
  // first visible frame. Window bounds, workspace visibility and recovery
  // polling are native work and are deliberately deferred until after show.
  setFloatingSealMouseTransparency(seal, true)

  seal.on('hide', () => {
    // `close()` keeps the reusable pet BrowserWindow alive by calling hide(),
    // so cancelled startup work must not wait for the eventual `closed` event.
    cancelStartupStages()
    floatingSealMouseRecovery?.setVisible(false)
  })

  seal.on('closed', () => {
    cancelStartupStages()
    floatingSealMouseRecovery?.dispose()
    floatingSealMouseRecovery = null
    floatingSealInteractiveRegions = []
    floatingSealMouseTransparent = true
    disposeWhiteStripFix?.()
    if (handleFloatingSealDisplayChange) {
      screen.off('display-metrics-changed', handleFloatingSealDisplayChange)
      screen.off('display-added', handleFloatingSealDisplayChange)
      screen.off('display-removed', handleFloatingSealDisplayChange)
    }
    floatingSealWindow = null
    enforceFloatingSealWindowBounds = null
    recompositeFloatingSealWindow = null
    cancelRecompositeFloatingSealWindow = null
    if (cancelFloatingSealStartupStages === cancelStartupStages) cancelFloatingSealStartupStages = null
  })

  floatingSealWindow = seal

  loadRendererWindow(seal, FLOATING_SEAL_QUERY)
  seal.webContents.once('did-finish-load', () => {
    if (seal.isDestroyed() || floatingSealWindow !== seal) return
    traceStartupPhase('pet-renderer:ready')
    sendAssistantPetState()
    floatingSealWakeController.showWhenReady(seal)
    traceStartupPhase('pet-window:shown')

    schedulePostShowStartupStages()
  })

  return seal
}

const floatingSealWakeController = createFloatingSealWakeController({
  createWindow: createFloatingSealWindow,
  getWindow: () => floatingSealWindow,
  prepareWindow: () => {
    resetFloatingSealWindowBounds()
    floatingSealMouseRecovery?.setVisible(true)
  },
  onShown: () => scheduleFloatingSealPostShowStartupStages?.(),
  scheduleCreate: (callback) => scheduleFloatingSealIdleTask(
    callback,
    'floating-seal:create',
    {
      // A foreground interaction can arrive after auto-wake has released but
      // before BrowserWindow construction. Preserve the full create guard at
      // this second boundary; wakeImmediately() intentionally bypasses it.
      minimumQuietWindowMs: 600,
      ignorePointerMove: true
    }
  ),
  cancelCreate: (handle) => cancelFloatingSealIdleTask(handle as FloatingSealIdleTaskHandle)
})

let automaticFloatingSealWakeScheduled = false
let automaticFloatingSealWakeHandle: FloatingSealIdleTaskHandle | undefined
let automaticPetStartupEnabledForThisLaunch = false
let mainRendererInteractiveReady = false
let startupServicesReady = false
let homeWebviewLoadSettled = false
let homeWebviewGuestId: number | undefined
const mainWindowGuestWebContentsIds = new Set<number>()
const settledHomeGuestIds = new Set<number>()

function markHomeWebviewLoadSettled() {
  if (homeWebviewLoadSettled) return
  homeWebviewLoadSettled = true
  traceStartupPhase('home-webview:load-settled')
  maybeScheduleAutomaticFloatingSealWake()
}

function rememberHomeGuestLoadOutcome(webContentsId: number) {
  if (!mainWindowGuestWebContentsIds.has(webContentsId)) return
  settledHomeGuestIds.add(webContentsId)
  if (homeWebviewGuestId === webContentsId) markHomeWebviewLoadSettled()
}

function registerHomeWebviewGuest(webContentsId: number) {
  if (!mainWindowGuestWebContentsIds.has(webContentsId)) return
  homeWebviewGuestId = webContentsId
  if (settledHomeGuestIds.has(webContentsId)) markHomeWebviewLoadSettled()
}

function scheduleAutomaticFloatingSealWake() {
  if (automaticFloatingSealWakeScheduled || appQuitting) return
  traceStartupPhase('pet-wake:scheduled')
  automaticFloatingSealWakeScheduled = true
  automaticFloatingSealWakeHandle = scheduleFloatingSealIdleTask(() => {
    automaticFloatingSealWakeScheduled = false
    automaticFloatingSealWakeHandle = undefined
    if (appQuitting) return
    void floatingSealWakeController.wake()
  }, 'floating-seal:auto-wake', {
    // The first hidden/click-through window is deliberately separated from
    // real foreground work, but ordinary pointer movement must not postpone it
    // forever. Keep a longer guard after a click, scroll, key, or window
    // gesture so stopping input cannot immediately trigger native creation.
    minimumQuietWindowMs: 600,
    minimumDelayMs: 600,
    ignorePointerMove: true
  })
}

function maybeScheduleAutomaticFloatingSealWake() {
  if (!automaticPetStartupEnabledForThisLaunch) return
  if (!mainRendererInteractiveReady || !startupServicesReady || !homeWebviewLoadSettled) return
  scheduleAutomaticFloatingSealWake()
}

function cancelAutomaticFloatingSealWake() {
  if (automaticFloatingSealWakeHandle) cancelFloatingSealIdleTask(automaticFloatingSealWakeHandle)
  automaticFloatingSealWakeHandle = undefined
  automaticFloatingSealWakeScheduled = false
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
  installStartupInputObservers(menu)

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
  installStartupInputObservers(assistant)

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
let bilibiliFavoriteSpaceRefreshCoordinator: BilibiliFavoriteSpaceRefreshCoordinator | undefined
let favoriteLibraryCommandService: FavoriteLibraryCommandService | undefined
let favoriteRepositoryBatchOperationService: FavoriteRepositoryBatchOperationService | undefined
let favoriteRepositoryManagedFolderService: FavoriteRepositoryManagedFolderService | undefined
let localDataService: LocalDataService | undefined
const favoriteRepositoryRemoteOperations = new FavoriteRepositoryRemoteOperationArbiter()
let oldFavoriteWorkspaceCoordinator: OldFavoriteWorkspaceCoordinator | undefined
let oldFavoriteWorkspaceScanService: OldFavoriteWorkspaceScanService | undefined
let oldFavoriteWorkspaceDeepSeekService: OldFavoriteWorkspaceDeepSeekService | undefined
// Note summaries and old-favorite organization use one process-wide DeepSeek
// lane so their external requests cannot contend with each other.
const deepSeekTaskQueue = createDeepSeekTaskQueue()
function isTrustedOldFavoriteSessionSender(senderId: number): boolean {
  const floatingAssistant = floatingAssistantController.getWindow()
  return [mainWindow?.webContents.id, floatingAssistant?.webContents.id]
    .filter((id): id is number => typeof id === 'number')
    .includes(senderId)
}

function assertTrustedAssistantPetSender(event: { sender: { id: number } }) {
  const floatingAssistant = floatingAssistantController.getWindow()
  const trustedIds = [
    mainWindow?.webContents.id,
    floatingSealWindow?.webContents.id,
    floatingAssistant?.webContents.id
  ].filter((id): id is number => typeof id === 'number')
  if (!trustedIds.includes(event.sender.id)) {
    throw new Error('Assistant pet request came from an untrusted renderer.')
  }
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

function closeAssistantPetWindow(options: {
  persistStartupPreference?: boolean
  temporarilyForVideoFullscreen?: boolean
} = {}) {
  const wasVisible = Boolean(
    floatingSealWindow &&
    !floatingSealWindow.isDestroyed() &&
    floatingSealWindow.isVisible()
  )

  if (options.temporarilyForVideoFullscreen) {
    // Fullscreen must also cancel an automatic wake that has not reached native
    // window creation yet, but only a visible pet earns a later restoration.
    cancelAutomaticFloatingSealWake()
    if (!wasVisible) {
      floatingSealWakeController.cancelPendingWake()
    } else {
      petHiddenForVideoFullscreen = true
    }
  } else {
    petHiddenForVideoFullscreen = false
  }

  if (options.persistStartupPreference !== false && !options.temporarilyForVideoFullscreen) {
    saveAssistantPreferencePatch({ autoShowPetOnStartup: false })
  }
  cancelAutomaticFloatingSealWake()
  closeFloatingMenuWindow()
  closeFloatingAssistantWindow()
  cancelFloatingSealStartupStages?.()
  floatingSealWakeController.close()
  cancelRecompositeFloatingSealWindow?.()
  floatingSealMouseRecovery?.setVisible(false)
  return wasVisible
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

  floatingSealMouseTransparent = transparent
  if (floatingSealMouseRecovery) {
    floatingSealMouseRecovery.setTransparent(transparent)
    return
  }

  setFloatingSealMouseTransparency(floatingSealWindow, transparent)
}

async function wakeAssistantPetWindow(options: {
  persistStartupPreference?: boolean
  restoreAfterVideoFullscreen?: boolean
} = {}) {
  if (options.restoreAfterVideoFullscreen) {
    if (!petHiddenForVideoFullscreen) return false
    petHiddenForVideoFullscreen = false
  } else {
    petHiddenForVideoFullscreen = false
  }

  if (options.persistStartupPreference !== false && !options.restoreAfterVideoFullscreen) {
    saveAssistantPreferencePatch({ autoShowPetOnStartup: true })
  }
  cancelAutomaticFloatingSealWake()
  await floatingSealWakeController.wakeImmediately()
  return true
}

function notifyFloatingAssistantSnapshotChanged() {
  const assistant = floatingAssistantController.getWindow()

  sendAssistantSnapshotChangedToTargets([mainWindow, assistant])
}

async function reconcileFavoriteLedgerBindingProjection(accountMid: string) {
  const store = getDesktopStore()
  const current = loadFavoriteAccountPreferences(store, accountMid)
  const repositorySnapshot = await favoriteRepositoryService?.getSnapshot(accountMid).catch(() => null)
  if (!repositorySnapshot) return false
  const projectedLedgers = projectFavoriteLedgersFromPhysicalShards(current.favoriteLedgers, repositorySnapshot.physicalShards)
  const favoriteLedgers = projectedLedgers
  if (JSON.stringify(favoriteLedgers) === JSON.stringify(current.favoriteLedgers)) return false
  saveFavoriteAccountPreferences(store, accountMid, { ...current, favoriteLedgers })
  sendAssistantPreferencesChanged(loadAssistantPreferences(store))
  notifyFloatingAssistantSnapshotChanged()
  return true
}

/** Refreshes the account rule projection after any automatic shard mutation. */
async function refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid: string) {
  await reconcileFavoriteLedgerBindingProjection(accountMid)
  notifyFloatingAssistantSnapshotChanged()
}

/**
 * A successful Bilibili folder create, rename, or delete has two independent
 * UI consequences: the local managed-folder projection must converge, and
 * Bilibili's favourite-list SPA must discard its stale directory cache. Keep
 * both account-scoped and never let a page reload failure undo a confirmed
 * remote mutation.
 */
async function refreshConfirmedBilibiliFavoriteFolderMutation(accountMid: string) {
  await bilibiliFavoriteSpaceRefreshCoordinator?.refresh(accountMid)
}

function favoriteLedgerPreferencePatchTouchesRules(patch: Partial<AssistantPreferences>) {
  return Object.prototype.hasOwnProperty.call(patch, 'favoriteLedgers') ||
    Object.prototype.hasOwnProperty.call(patch, 'favoriteAccountPreferences')
}

function favoriteLedgerHistoryWiring() {
  const coordinator = oldFavoriteWorkspaceCoordinator
  if (!coordinator) return undefined
  return {
    get: (accountMid: string) => coordinator.getFavoriteLedgerHistoryState(accountMid),
    record: (accountMid: string, transition: Parameters<typeof coordinator.recordFavoriteLedgerHistoryChange>[1]) =>
      coordinator.recordFavoriteLedgerHistoryChange(accountMid, transition)
  }
}

/** Local rule changes must refresh the actual preview workspace, never a renderer mirror. */
async function reclassifyFavoriteWorkspaceIfPreviewing(accountMid: string) {
  const coordinator = oldFavoriteWorkspaceCoordinator
  if (!coordinator) return
  const snapshot = await coordinator.getSnapshot(accountMid)
  if (!snapshot || 'recovery' in snapshot || snapshot.status !== 'previewing') return
  await coordinator.reclassifyForFavoriteConfiguration(accountMid)
}

/** Remote-only draft projection changes do not alter local classification rules. */
async function refreshFavoriteWorkspaceRelationshipProjectionIfPresent(accountMid: string) {
  const coordinator = oldFavoriteWorkspaceCoordinator
  if (!coordinator) return
  const snapshot = await coordinator.getSnapshot(accountMid)
  if (!snapshot || 'recovery' in snapshot) return
  await coordinator.refreshRelationshipProjection(accountMid)
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

function restoreMainWindowOnly() {
  mainWindow = restoreMainWindowFromPet({
    createMainWindow,
    mainWindow
  })
  return mainWindow
}

function restoreMainWindowForPet() {
  const restoredWindow = restoreMainWindowOnly()
  sendAssistantOpenWhenReady(restoredWindow)
  return restoredWindow
}

let assistantRuntimeRequestIndex = 0
let videoTranscriptionQueue:
  | ReturnType<typeof createVideoTranscriptionQueue>
  | null = null
const transcriptionModelManager = createTranscriptionModelManager({
  bundledRoot: join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    'tools',
    process.platform,
    'transcription-models'
  ),
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
  homeWebviewLoadSettled = false
  homeWebviewGuestId = undefined
  mainWindowGuestWebContentsIds.clear()
  settledHomeGuestIds.clear()
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
    closeAssistantPet: () => closeAssistantPetWindow({ persistStartupPreference: false }),
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
        ? loadFavoriteAccountPreferences(getDesktopStore(), request.accountMid).transcriptionModelId ?? DEFAULT_TRANSCRIPTION_MODEL_ID
        : DEFAULT_TRANSCRIPTION_MODEL_ID,
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
        const result = await deepSeekTaskQueue.run((taskSignal) => generateDeepSeekResult({
          config: {
            enabled: preferences.deepseekEnabled,
            apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
            model: preferences.deepseekModel,
            baseUrl: preferences.deepseekBaseUrl
          },
          request: { kind: 'note-poster', note },
          signal: taskSignal,
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
        }), signal)

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
  ipcMain.on('startup:input-activity', (event, activity: unknown) => {
    const floatingAssistant = floatingAssistantController.getWindow()
    const floatingMenu = floatingMenuController.getWindow()
    const trustedIds = [
      mainWindow?.webContents.id,
      floatingSealWindow?.webContents.id,
      floatingAssistant?.webContents.id,
      floatingMenu?.webContents.id
    ].filter((id): id is number => typeof id === 'number')
    if (!trustedIds.includes(event.sender.id)) return
    traceStartupPhase(activity === 'pointer-move' ? 'input:pointer-move' : 'input:foreground')
    cancelRecompositeFloatingSealWindow?.()
    noteStartupInputActivity(activity === 'pointer-move' ? 'pointer-move' : 'foreground')
  })
  ipcMain.on('main-window:first-frame', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return
    }
    traceStartupPhase('main-window:first-frame')
  })
  ipcMain.on('main-window:interactive-ready', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return
    }
    mainRendererInteractiveReady = true
    traceStartupPhase('main-window:interactive-ready')
    maybeScheduleAutomaticFloatingSealWake()
  })
  ipcMain.on('home-webview:load-settled', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return
    }
    markHomeWebviewLoadSettled()
  })
  ipcMain.on('home-webview:guest-attached', (event, webContentsId: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id ||
      !Number.isInteger(webContentsId)) {
      return
    }
    registerHomeWebviewGuest(webContentsId)
  })
  ipcMain.on('home-webview:load-timeout', (event) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      return
    }
    traceStartupPhase('home-webview:load-timeout')
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
  ipcMain.handle('bilibili-favorite-space-refresh:status', async (event, requestedAccountMid: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Bilibili favorite-space refresh request came from an untrusted renderer.')
    }
    const accountMid = typeof requestedAccountMid === 'string' ? requestedAccountMid.trim() : ''
    if (!accountMid || accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Bilibili favorite-space refresh request does not match the current account.')
    }
    return bilibiliFavoriteSpaceRefreshCoordinator?.getStatus(accountMid) ?? { status: 'idle' as const }
  })
  ipcMain.handle('bilibili-favorite-space-refresh:retry', async (event, requestedAccountMid: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) {
      throw new Error('Bilibili favorite-space refresh request came from an untrusted renderer.')
    }
    const accountMid = typeof requestedAccountMid === 'string' ? requestedAccountMid.trim() : ''
    if (!accountMid || accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Bilibili favorite-space refresh request does not match the current account.')
    }
    return bilibiliFavoriteSpaceRefreshCoordinator?.retry(accountMid) ?? { status: 'idle' as const }
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
    const currentPreferences = loadAssistantPreferences(getDesktopStore())
    const favoriteRulesChanged = JSON.stringify(currentPreferences.favoriteLedgers) !== JSON.stringify(preferences.favoriteLedgers) ||
      JSON.stringify(currentPreferences.favoriteAccountPreferences) !== JSON.stringify(preferences.favoriteAccountPreferences)
    const historyAccountMid = favoriteRulesChanged ? await readCurrentBilibiliAccountMid() : null
    const saved = await recordFavoriteLedgerHistoryAroundMutation(
      historyAccountMid ?? undefined,
      favoriteLedgerHistoryWiring(),
      async () => saveAssistantPreferences(getDesktopStore(), preferences)
    )
    const next = withBilibiliConnectionMode(saved)
    sendAssistantPreferencesChanged(next)
    if (historyAccountMid && favoriteLedgerHistoryWiring()) notifyFloatingAssistantSnapshotChanged()
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
    const capturesFavoriteHistory = favoriteLedgerPreferencePatchTouchesRules(assistantPatch)
    const historyAccountMid = capturesFavoriteHistory ? await readCurrentBilibiliAccountMid() : null
    const saved = await recordFavoriteLedgerHistoryAroundMutation(
      historyAccountMid ?? undefined,
      favoriteLedgerHistoryWiring(),
      async () => patchAssistantPreferences(getDesktopStore(), assistantPatch)
    )
    const next = withBilibiliConnectionMode(saved)
    if (normalizedAssistantPatch || bilibiliConnectionMode !== undefined) {
      sendAssistantPreferencePatchChanged({
        ...(normalizedAssistantPatch ?? {}),
        ...(bilibiliConnectionMode === undefined ? {} : {
          bilibiliConnectionMode: normalizeBilibiliConnectionMode(bilibiliConnectionMode)
        })
      }, meta)
    } else {
      sendAssistantPreferencesChanged(next)
    }
    if (historyAccountMid && favoriteLedgerHistoryWiring()) notifyFloatingAssistantSnapshotChanged()
    if (connectionModeChanged) requestBilibiliWebviewReload()
    return next
  })
  ipcMain.handle('assistant:write-preference-patch', (_event, patch: Partial<AssistantPreferences>, meta?: AssistantPreferencePatchMeta) => {
    const written = writeAssistantPreferencePatch(getDesktopStore(), patch)
    if (!written) throw new Error('This preference patch requires the full save path.')
    sendAssistantPreferencePatchChanged(written, meta)
    return written
  })
  ipcMain.handle('assistant:write-favorite-ledger-rules', async (event, accountMid: string, favoriteLedgers: FavoriteLedger[]) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (!accountMid || accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Favorite ledger account is no longer current.')
    }
    const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
    const saved = saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
      ...current,
      favoriteLedgers
    })
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    notifyFloatingAssistantSnapshotChanged()
    return { accountMid, favoriteLedgers: saved.favoriteLedgers }
  })
  ipcMain.handle('assistant:write-favorite-ledger-enabled', async (
    event,
    accountMid: string,
    ledgerId: string,
    enabled: boolean,
    meta?: AssistantPreferencePatchMeta,
    historyOptions?: FavoriteLedgerEnabledHistoryOptions
  ) => {
    assertTrustedOldFavoriteAssistantSender(event)
    const mergeFavoriteRuleHistory = historyOptions !== undefined &&
      typeof historyOptions === 'object' &&
      historyOptions !== null &&
      historyOptions.mergeFavoriteRuleHistory === true &&
      Object.keys(historyOptions).length === 1 &&
      Object.keys(historyOptions)[0] === 'mergeFavoriteRuleHistory'
    if (historyOptions !== undefined && !mergeFavoriteRuleHistory) {
      throw new Error('Favorite ledger history merge options are invalid.')
    }
    // The narrow enabled-state path is account-scoped. When a Bilibili
    // account is present, reject a stale renderer snapshot after a switch;
    // a signed-out Bilibili session must not block a local-only rule toggle.
    const currentAccountMid = await readCurrentBilibiliAccountMid()
    if (!accountMid) {
      throw new Error('Favorite ledger account is no longer current.')
    }
    if (currentAccountMid && accountMid !== currentAccountMid) {
      throw new Error('Favorite ledger account is no longer current.')
    }
    const localToggleAccountMid = resolveLocalFavoriteLedgerToggleAccountMid(
      loadAssistantPreferences(getDesktopStore()).favoriteAccountPreferences,
      ledgerId
    )
    if (!currentAccountMid && accountMid !== localToggleAccountMid) {
      throw new Error('Favorite ledger account is no longer current.')
    }
    // History is optional: a user may toggle a local rule before ever starting
    // the organize workspace. Preserve other coordinator failures, but do not
    // make that absent workspace block the durable local override.
    const beforeHistoryState = await oldFavoriteWorkspaceCoordinator?.getFavoriteLedgerHistoryState(accountMid)
      .catch((error) => {
        if (error instanceof Error && error.message === 'Old favorite workspace has not been started.') {
          return undefined
        }
        throw error
      })
    const patch = await writeFavoriteLedgerEnabled(undefined, accountMid, ledgerId, enabled)
    // In-round participation is projected through the coordinator's
    // recommendation/exclusion commands. Reclassifying here would queue a
    // second full pass behind the same click and visibly stall the controls.
    if (beforeHistoryState && oldFavoriteWorkspaceCoordinator) {
      const afterHistoryState = await oldFavoriteWorkspaceCoordinator.getFavoriteLedgerHistoryState(accountMid)
      if (afterHistoryState) {
        await oldFavoriteWorkspaceCoordinator.recordFavoriteLedgerHistoryChange(accountMid, {
          before: beforeHistoryState,
          after: afterHistoryState,
          ...(mergeFavoriteRuleHistory ? { mergeWithLatestClassification: true } : {})
        })
      }
    }
    sendFavoriteLedgerEnabledChanged(patch, meta)
    notifyFloatingAssistantSnapshotChanged()
    return patch
  })
  ipcMain.handle('assistant:delete-favorite-ledger-draft', async (event, accountMid: unknown, ledgerId: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (
      typeof accountMid !== 'string' ||
      typeof ledgerId !== 'string' ||
      accountMid !== await readCurrentBilibiliAccountMid()
    ) {
      throw new Error('Favorite ledger draft is unavailable.')
    }

    const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
    const draft = current.favoriteLedgers.find((ledger) => ledger.id === ledgerId)
    const remoteDraftRemoved = removeUnsavedFavoriteLedgerDraft(current.favoriteLedgers, ledgerId)
    const favoriteLedgers = remoteDraftRemoved
    if (favoriteLedgers === current.favoriteLedgers) {
      throw new Error('Favorite ledger draft is unavailable.')
    }

    const deletedRecords = draft
      ? [...(current.deletedFavoriteLedgerRecords ?? []).filter((record) => record.logicalLedgerId !== draft.id), {
        logicalLedgerId: draft.id,
        deletedAt: new Date().toISOString(),
        ledger: draft
      }]
      : current.deletedFavoriteLedgerRecords
    saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
      ...current,
      favoriteLedgers,
      ...(deletedRecords ? { deletedFavoriteLedgerRecords: deletedRecords } : {})
    })
    const remoteFolderIds = [...new Set([
      draft?.bilibiliFolderId,
      ...(draft?.bilibiliFolderIds ?? [])
    ].map((remoteFolderId) => remoteFolderId?.trim()).filter((remoteFolderId): remoteFolderId is string => Boolean(remoteFolderId)))]
    markFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid, remoteFolderIds)
    await refreshFavoriteWorkspaceRelationshipProjectionIfPresent(accountMid)
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    notifyFloatingAssistantSnapshotChanged()
    return { status: 'succeeded' as const, ledgerId }
  })
  ipcMain.handle('assistant:delete-favorite-ledgers-local', async (event, accountMid: unknown, requestedLedgerIds: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (
      typeof accountMid !== 'string' ||
      !Array.isArray(requestedLedgerIds) ||
      requestedLedgerIds.length === 0 ||
      requestedLedgerIds.some((ledgerId) => typeof ledgerId !== 'string' || !ledgerId.trim()) ||
      accountMid !== await readCurrentBilibiliAccountMid()
    ) {
      throw new Error('Favorite ledger local deletion is unavailable.')
    }

    const ledgerIds = [...new Set(requestedLedgerIds.map((ledgerId) => ledgerId.trim()))]
    const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
    const removedLedgers = current.favoriteLedgers.filter((ledger) => ledgerIds.includes(ledger.id) && !ledger.isDefault)
    const favoriteLedgers = removeLocalFavoriteLedgers(current.favoriteLedgers, ledgerIds)
    if (favoriteLedgers === current.favoriteLedgers) {
      throw new Error('Favorite ledger local deletion is unavailable.')
    }

    const deletedRecords = removedLedgers.length
      ? [
        ...(current.deletedFavoriteLedgerRecords ?? []).filter((record) => !removedLedgers.some((ledger) => ledger.id === record.logicalLedgerId)),
        ...removedLedgers.map((ledger) => ({
          logicalLedgerId: ledger.id,
          deletedAt: new Date().toISOString(),
          ledger
        }))
      ]
      : current.deletedFavoriteLedgerRecords

    let workspaceSnapshot: Awaited<ReturnType<NonNullable<typeof oldFavoriteWorkspaceCoordinator>['getSnapshot']>> | null = null
    try {
      workspaceSnapshot = await oldFavoriteWorkspaceCoordinator?.getSnapshot(accountMid) ?? null
    } catch {
      // A missing/unreadable workspace is not evidence of an active preview;
      // the local deletion remains authoritative and must not be rolled back.
    }
    const previewingWorkspace = workspaceSnapshot && !('recovery' in workspaceSnapshot) && workspaceSnapshot.status === 'previewing'
    saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
      ...current,
      favoriteLedgers,
      ...(deletedRecords ? { deletedFavoriteLedgerRecords: deletedRecords } : {})
    })
    if (previewingWorkspace) {
      try {
        if (oldFavoriteWorkspaceCoordinator) {
          await oldFavoriteWorkspaceCoordinator.reconcileDeletedFavoriteLedgerRules(accountMid, removedLedgers)
        } else {
          await reclassifyFavoriteWorkspaceIfPreviewing(accountMid)
        }
      } catch (error) {
        // Reconcile before deleting the repository projection, so a failed
        // preview transaction can restore the exact account directory without
        // leaving a locally deleted managed folder behind.
        saveFavoriteAccountPreferences(getDesktopStore(), accountMid, current)
        throw error
      }
    }
    try {
      if (!favoriteRepositoryService) throw new Error('Favorite repository is unavailable.')
      const removedLedgerIds = new Set(removedLedgers.map((ledger) => ledger.id))
      const repositorySnapshot = await favoriteRepositoryService.getSnapshot(accountMid)
      const managedLogicalFolderIds = repositorySnapshot.folders
        .filter((folder) => folder.kind === 'bilimi-logical' && folder.logicalLedgerId && removedLedgerIds.has(folder.logicalLedgerId))
        .map((folder) => folder.id)
      if (managedLogicalFolderIds.length) {
        await favoriteRepositoryService.commit(accountMid, {
          id: `favorite-delete-local-managed-folders:${randomUUID()}`,
          accountMid,
          issuedAt: new Date().toISOString(),
          type: 'delete-local-managed-folders',
          payload: { logicalFolderIds: managedLogicalFolderIds }
        })
      }
    } catch (error) {
      // The account rule remains the source of truth for the repository
      // projection. Do not leave a deleted rule persisted when its matching
      // managed folders could not be removed through the existing command.
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, current)
      if (previewingWorkspace) await reclassifyFavoriteWorkspaceIfPreviewing(accountMid).catch(() => undefined)
      throw error
    }
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    notifyFloatingAssistantSnapshotChanged()
    return { status: 'succeeded' as const, ledgerIds: removedLedgers.map((ledger) => ledger.id) }
  })
  ipcMain.handle('assistant:restore-favorite-ledgers-local', async (event, accountMid: unknown, requestedLedgerIds: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (typeof accountMid !== 'string' || !Array.isArray(requestedLedgerIds) || requestedLedgerIds.length === 0 ||
      requestedLedgerIds.some((ledgerId) => typeof ledgerId !== 'string' || !ledgerId.trim()) ||
      accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Favorite ledger local recovery is unavailable.')
    }
    const ledgerIds = [...new Set(requestedLedgerIds.map((ledgerId) => ledgerId.trim()))]
    const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
    const records = current.deletedFavoriteLedgerRecords ?? []
    const selected = records.filter((record) => ledgerIds.includes(record.logicalLedgerId))
    if (!selected.length) throw new Error('Favorite ledger local recovery is unavailable.')
    const activeIds = new Set(current.favoriteLedgers.map((ledger) => ledger.id))
    const restored = selected.map((record) => record.ledger).filter((ledger) => !activeIds.has(ledger.id))
    saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
      ...current,
      favoriteLedgers: [...current.favoriteLedgers, ...restored],
      deletedFavoriteLedgerRecords: records.filter((record) => !ledgerIds.includes(record.logicalLedgerId))
    })
    await reclassifyFavoriteWorkspaceIfPreviewing(accountMid)
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    notifyFloatingAssistantSnapshotChanged()
    return { status: 'succeeded' as const, ledgerIds: restored.map((ledger) => ledger.id) }
  })
  ipcMain.handle('assistant:release-default-favorite-ledger-bindings', async (event, accountMid: unknown, requestedLedgerIds: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (
      typeof accountMid !== 'string' ||
      !Array.isArray(requestedLedgerIds) ||
      requestedLedgerIds.length === 0 ||
      requestedLedgerIds.some((ledgerId) => typeof ledgerId !== 'string' || !ledgerId.trim()) ||
      accountMid !== await readCurrentBilibiliAccountMid()
    ) {
      throw new Error('Default favorite ledger binding release is unavailable.')
    }

    const requestedIds = new Set(requestedLedgerIds.map((ledgerId) => ledgerId.trim()))
    const selectedLedgerIds = loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => ledger.isDefault && requestedIds.has(ledger.id))
      .map((ledger) => ledger.id)
    if (!selectedLedgerIds.length || !favoriteRepositoryService) {
      throw new Error('Default favorite ledger binding release is unavailable.')
    }

    const selectedIds = new Set(selectedLedgerIds)
    const snapshot = await favoriteRepositoryService!.getSnapshot(accountMid)
    const remoteFolderIds = [...new Set(snapshot.physicalShards
      .filter((shard) => selectedIds.has(shard.logicalLedgerId) && shard.bindingState === 'bound' && shard.remoteFolderId)
      .map((shard) => shard.remoteFolderId!))]
    for (const remoteFolderId of remoteFolderIds) {
      await favoriteRepositoryService!.commit(accountMid, {
        id: `favorite-release-default-binding:${randomUUID()}`,
        accountMid,
        issuedAt: new Date().toISOString(),
        type: 'remove-physical-shard-binding',
        payload: { remoteFolderId }
      })
    }
    await refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid)
    notifyFloatingAssistantSnapshotChanged()
    return { status: 'succeeded' as const, ledgerIds: selectedLedgerIds, remoteFolderIds }
  })
  ipcMain.handle('assistant:write-default-favorite-system-enabled', async (event, accountMid: string, enabled: boolean) => {
    assertTrustedOldFavoriteAssistantSender(event)
    const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
    const saved = saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
      ...current,
      defaultFavoriteSystemEnabled: Boolean(enabled)
    })
    await reclassifyFavoriteWorkspaceIfPreviewing(accountMid)
    sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    notifyFloatingAssistantSnapshotChanged()
    return saved.defaultFavoriteSystemEnabled
  })
  ipcMain.handle('assistant:consume-favorite-ledger-remote-draft-rediscovery-pending', async (event, accountMid: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (typeof accountMid !== 'string' || accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Favorite ledger remote draft rediscovery is unavailable.')
    }
    return consumeFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)
  })
  ipcMain.handle('assistant:get-favorite-ledger-remote-draft-rediscovery-pending', async (event, accountMid: unknown) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (typeof accountMid !== 'string' || accountMid !== await readCurrentBilibiliAccountMid()) {
      throw new Error('Favorite ledger remote draft rediscovery is unavailable.')
    }
    return loadFavoriteLedgerRemoteDraftRediscoveryPending(getDesktopStore(), accountMid)
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
    sendAssistantPreferencePatchChanged({ deepseekApiKeyStored: status.configured })
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
    chooseParentDirectory: (suggestedFolderName) => chooseVideoNoteExportDestination({
      desktopDirectory: app.getPath('desktop'),
      suggestedFolderName,
      chooseDestination: (defaultPath) => dialog.showSaveDialog({
        title: '选择文稿导出目录',
        buttonLabel: '选择文件夹',
        defaultPath,
        properties: ['createDirectory']
      })
    }),
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
        ? loadFavoriteAccountPreferences(getDesktopStore(), request.accountMid).transcriptionModelId ?? DEFAULT_TRANSCRIPTION_MODEL_ID
        : DEFAULT_TRANSCRIPTION_MODEL_ID)

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
  ipcMain.handle('assistant-pet:close', (event, requestedOptions: unknown) => {
    assertTrustedAssistantPetSender(event)
    const temporarilyForVideoFullscreen = event.sender.id === mainWindow?.webContents.id &&
      Boolean(
        requestedOptions &&
        typeof requestedOptions === 'object' &&
        !Array.isArray(requestedOptions) &&
        (requestedOptions as { temporarilyForVideoFullscreen?: unknown }).temporarilyForVideoFullscreen === true
      )
    return closeAssistantPetWindow({ temporarilyForVideoFullscreen })
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
  ipcMain.handle('assistant-pet:wake', (event, requestedOptions: unknown) => {
    assertTrustedAssistantPetSender(event)
    const restoreAfterVideoFullscreen = event.sender.id === mainWindow?.webContents.id &&
      Boolean(
        requestedOptions &&
        typeof requestedOptions === 'object' &&
        !Array.isArray(requestedOptions) &&
        (requestedOptions as { restoreAfterVideoFullscreen?: unknown }).restoreAfterVideoFullscreen === true
      )
    return wakeAssistantPetWindow({ restoreAfterVideoFullscreen })
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
  ipcMain.handle('floating-assistant:read-current-video-multipart', () =>
    requestMainAssistantRuntime<import('../../src/renderer/src/features/notes/videoNoteMultipart').MultipartVideoSnapshot | null>({
      type: 'read-current-video-multipart'
    })
  )
  ipcMain.handle('floating-assistant:ensure-ledgers', (event) => {
    assertTrustedOldFavoriteAssistantSender(event)
    return requestMainAssistantRuntime<AssistantAutomationResult>({ type: 'ensure-ledgers' })
  })
  ipcMain.handle('floating-assistant:ensure-ledger', (event, logicalFolderId: string, options?: FavoriteLedgerSaveOptions) => {
    assertTrustedOldFavoriteAssistantSender(event)
    if (typeof logicalFolderId !== 'string' || !logicalFolderId.trim()) throw new Error('Favorite ledger id is required.')
    return requestMainAssistantRuntime<AssistantAutomationResult>({ type: 'ensure-ledger', logicalFolderId: logicalFolderId.trim(), options })
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
    floatingSealInteractiveRegions = regions
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
automaticPetStartupEnabledForThisLaunch = loadAssistantPreferences(getDesktopStore()).autoShowPetOnStartup

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
  // Create the responsive shell before disk/network recovery. The renderer
  // readiness gate keeps actions queued until the services below are ready,
  // while the native window remains movable and closable during startup.
  registerAssistantPreferenceHandlers()
  createMainWindow()
  traceStartupPhase('main-window:create')
  // Give Chromium one event-loop turn to commit the visible shell before
  // applying session/proxy settings and constructing the remaining services.
  // This keeps launch-time native work from monopolizing mouse input.
  await yieldStartupEventLoop()
  traceStartupPhase('main-window:first-yield')
  await bilibiliSessionProxy.applyPreference(readBilibiliConnectionMode()).catch(() => undefined)
  traceStartupPhase('session:preference-ready')
  await yieldStartupEventLoop()
  favoriteRepositoryService = new FavoriteRepositoryService({
    root: join(app.getPath('userData'), 'favorites', 'repository-v1'),
    getTranscriptionRevision: () => queuePublishGeneration,
    getTranscriptionItems: () => getVideoTranscriptionQueue().getSnapshot().items,
    getTranscriptionArchives: () => loadVideoNoteArchives(getDesktopStore())
  })
  traceStartupPhase('repository:create')
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
  traceStartupPhase('repository:recovery-ready')
  await yieldStartupEventLoop()
  favoriteRepositoryPageBridgeManager = new FavoriteRepositoryRuntimePageBridgeManager(
    (request) => requestMainAssistantRuntime<FavoriteRepositoryPageOperationResult>(request)
  )
  bilibiliFavoriteSpaceRefreshCoordinator = new BilibiliFavoriteSpaceRefreshCoordinator({
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    refreshProjection: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard,
    refreshFavoriteSpacePages: (accountMid) => refreshBilibiliFavoriteSpacePages({
      getAllWebContents: () => webContents.getAllWebContents(),
      targetSession: session.fromPartition(BILIMI_SESSION_PARTITION),
      accountMid
    }),
    onStatusChange: (accountMid, status) => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      mainWindow.webContents.send('bilibili-favorite-space-refresh:status-changed', { accountMid, status: status.status })
    }
  })
  favoriteRepositorySyncService = new FavoriteRepositorySyncService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations,
    ensurePhysicalShard: (accountMid, input) => favoriteRepositoryBindingService!.ensurePhysicalShard(accountMid, input),
    onPhysicalShardProvisioned: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard,
    onConfirmedRemoteFolderMutation: refreshConfirmedBilibiliFavoriteFolderMutation
  })
  favoriteRepositoryBindingService = new FavoriteRepositoryBindingService({
    repository: favoriteRepositoryService,
    pageBridgeManager: favoriteRepositoryPageBridgeManager,
    remoteOperations: favoriteRepositoryRemoteOperations,
    onConfirmedRemoteFolderMutation: refreshConfirmedBilibiliFavoriteFolderMutation
  })
  favoriteLibraryCommandService = new FavoriteLibraryCommandService({
    repository: favoriteRepositoryService,
    transcriptionQueue: getVideoTranscriptionQueue(),
    refreshVideo: refreshFavoriteLibraryVideo,
    placementSync: favoriteRepositorySyncService,
    placementRunController: favoriteRepositorySyncService,
    remoteUnfavorite: createFavoriteLibraryRemoteUnfavorite({
      pageBridgeManager: favoriteRepositoryPageBridgeManager!,
      remoteOperations: favoriteRepositoryRemoteOperations
    })
  })
  favoriteRepositoryBatchOperationService = new FavoriteRepositoryBatchOperationService({
    repository: favoriteRepositoryService,
    placementSync: favoriteRepositorySyncService,
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
      },
      async areManagedPlacementsRemoved(accountMid, targets) {
        const account = createAccountFavoriteRepositorySnapshot({
          accountMid,
          now: '1970-01-01T00:00:00.000Z'
        }).accountMid
        const runId = `favorite-managed-placement-reconcile:${Date.now()}:${randomUUID()}`
        await favoriteRepositoryPageBridgeManager!.bind(account, runId)
        try {
          const bridge = favoriteRepositoryPageBridgeManager!.pageBridge(account, runId)
          for (const target of targets) {
            const folderIds = [...new Set(target.folderIds.map((id) => id.trim()).filter(Boolean))].sort()
            if (!folderIds.length) return 'unknown' as const
            const result = await bridge.readMembers({
              accountMid: account,
              operationKey: `${runId}:${target.aid}`,
              aid: target.aid,
              folderIds
            })
            if (createAccountFavoriteRepositorySnapshot({ accountMid: result.observedAccountMid, now: '1970-01-01T00:00:00.000Z' }).accountMid !== account) {
              return 'unknown' as const
            }
            if (!folderIds.every((folderId) => Array.isArray(result.members[folderId]))) {
              return 'unknown' as const
            }
            if (folderIds.some((folderId) => result.members[folderId].includes(target.aid))) {
              return 'present' as const
            }
          }
          return 'removed' as const
        } catch {
          return 'unknown' as const
        } finally {
          favoriteRepositoryPageBridgeManager!.release(account, runId)
        }
      }
    }
  })
  favoriteRepositoryManagedFolderService = new FavoriteRepositoryManagedFolderService({
    repository: favoriteRepositoryService,
    remoteArbiter: favoriteRepositoryRemoteOperations,
    onManagedFolderDeleted: async (accountMid, deletions) => {
      await persistConfirmedManagedFolderDeletion(accountMid, deletions, {
        load: (targetAccountMid) => loadFavoriteAccountPreferences(getDesktopStore(), targetAccountMid),
        save: (targetAccountMid, preferences) => saveFavoriteAccountPreferences(getDesktopStore(), targetAccountMid, preferences),
        publish: () => sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore())),
      })
      notifyFloatingAssistantSnapshotChanged()
      if (deletions.some((deletion) => deletion.remoteDeleted)) {
        await refreshConfirmedBilibiliFavoriteFolderMutation(accountMid)
      }
    },
    remote: {
      async removeRemoteFolder(accountMid, remoteFolderId) {
        const runId = `favorite-managed-folder-delete:${Date.now()}:${remoteFolderId}`
        await favoriteRepositoryPageBridgeManager!.bind(accountMid, runId)
        try {
          return await favoriteRepositoryPageBridgeManager!.pageBridge(accountMid, runId).deleteFolder({
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
  traceStartupPhase('repository-services:ready')
  await yieldStartupEventLoop()
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
  traceStartupPhase('local-data:ready')
  await yieldStartupEventLoop()
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
    cleanupFailed: () => {
      favoriteRepositoryRemoteOperations.resumeAfterFailedMaintenance()
      oldFavoriteWorkspaceScanService?.resumeAfterDestructiveMaintenance()
      oldFavoriteWorkspaceDeepSeekService?.resumeAfterDestructiveMaintenance()
    },
    clearLoginSessions: () => session.fromPartition(BILIMI_SESSION_PARTITION).clearStorageData({ storages: ['cookies'] }),
    clearRuntimeStorage: async () => {
      const rendererTargets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
      await Promise.all(rendererTargets.map(async (target) => {
        if (!target || target.isDestroyed()) return
        await target.webContents.executeJavaScript('localStorage.clear(); sessionStorage.clear();', true).catch(() => undefined)
      }))
      await Promise.all([
        session.defaultSession.clearCache(),
        session.fromPartition(BILIMI_SESSION_PARTITION).clearStorageData({
          storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'websql', 'shadercache', 'cachestorage']
        })
      ])
    },
    rebuildEmptyRuntime: () => {
      favoriteRepositoryService?.resetAfterFullLocalDataClear()
      oldFavoriteWorkspaceCoordinator?.resetAfterFullLocalDataClear()
      oldFavoriteWorkspaceScanService?.resumeAfterDestructiveMaintenance()
      oldFavoriteWorkspaceDeepSeekService?.resumeAfterDestructiveMaintenance()
      favoriteRepositoryRemoteOperations.resumeAfterFailedMaintenance()
      videoNoteBatchExportIpc?.clearAll()
      getDesktopStore().clear()
      getFavoriteLedgerEnabledOverrideStore().clear()
      videoTranscriptionQueue = null
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
    },
    cleanupCompleted: async () => {
      await refreshBilibiliGuestPages({
        getAllWebContents: () => webContents.getAllWebContents(),
        targetSession: session.fromPartition(BILIMI_SESSION_PARTITION)
      })
      const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
      for (const target of targets) {
        if (!target || target.isDestroyed()) continue
        target.webContents.send('local-data:reset')
        target.webContents.send('bilibili:account-changed')
      }
      publishVideoAudioTranscriptionQueueChanged(getVideoTranscriptionQueue().getSnapshot(), false)
      notifyFloatingAssistantSnapshotChanged()
    },
    yieldToEventLoop: () => new Promise<void>((resolve) => setImmediate(resolve))
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
  const recoveryPreparationAccounts = new Set<string>()
  oldFavoriteWorkspaceCoordinator = new OldFavoriteWorkspaceCoordinator({
    repository: favoriteRepositoryService,
    segmentSize: () => loadAssistantPreferences(getDesktopStore()).oldFavoriteWorkspaceSegmentSize,
    onSegmentsReady: async (accountMid, segmentIds) => {
      if (recoveryPreparationAccounts.has(accountMid)) return
      const workspace = await oldFavoriteWorkspaceCoordinator?.getSnapshot(accountMid)
      const workspaceId = workspace && !('recovery' in workspace) ? workspace.workspaceId : undefined
      await oldFavoriteWorkspaceDeepSeekService?.resumePendingAllSegments(accountMid, segmentIds, (progress) => {
        if (!workspaceId) return
        const targets = [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
          .filter((target): target is BrowserWindow => Boolean(target && !target.isDestroyed()))
        for (const target of targets) {
          target.webContents.send('old-favorite-workspace-v1:deepseek-progress', { accountMid, workspaceId, ...progress })
        }
      })
      await oldFavoriteWorkspaceCoordinator?.continueExecutionIntent(accountMid)
    },
    refreshSelectedVideoMetadata: refreshFavoriteLibraryVideo,
    syncService: favoriteRepositorySyncService,
    bindingService: favoriteRepositoryBindingService,
    onPhysicalShardProvisioned: refreshFavoriteLedgerBindingProjectionAfterPhysicalShard,
    getFavoriteLedgersForScanProjection: async (accountMid) =>
      loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers,
    getUserDeletedDefaultLedgerIds: (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => ledger.isDefault && ledger.managedFolderDeletedByUser)
      .map((ledger) => ledger.id),
    getConfirmedDeletedRemoteFolderIds: (accountMid) => [
      ...loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
        .flatMap((ledger) => ledger.confirmedDeletedRemoteFolderIds ?? [])
    ]
      .map((folderId) => folderId.trim())
      .filter(Boolean),
    onManagedFolderDeletion: async (accountMid, deletions) => {
      await persistConfirmedManagedFolderDeletion(accountMid, deletions, {
        load: (targetAccountMid) => loadFavoriteAccountPreferences(getDesktopStore(), targetAccountMid),
        save: (targetAccountMid, preferences) => saveFavoriteAccountPreferences(getDesktopStore(), targetAccountMid, preferences),
        publish: () => sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
      })
      notifyFloatingAssistantSnapshotChanged()
    },
    classifyCurrentItems: (items, recommendedLedgers = [], accountMid, options) => {
      // Capture the saved rules once per workspace command, then classify its segment in memory.
      const accountPreferences = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const participatingSavedLedgerIds = options?.participatingSavedLedgerIds
      const participatingSavedLedgerIdSet = participatingSavedLedgerIds === undefined
        ? undefined
        : new Set(participatingSavedLedgerIds)
      const favoriteLedgers = participatingSavedLedgerIdSet
        ? accountPreferences.favoriteLedgers.map((ledger) => {
            const isSavedRule = ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule'
            return isSavedRule ? { ...ledger, enabled: participatingSavedLedgerIdSet.has(ledger.id) } : ledger
          })
        : accountPreferences.favoriteLedgers
      const ledgers = mergeOldFavoriteWorkspaceLedgers(
        classifierLedgersForAccount(
          favoriteLedgers,
          accountPreferences.defaultFavoriteSystemEnabled
        ),
        recommendedLedgers,
        options?.excludedRecommendedLedgers
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
      const remoteFolderId = ledger?.bilibiliFolderId?.trim()
      if (ledger?.bindingState !== 'bound' || !remoteFolderId) return undefined
      return {
        remoteFolderId,
        ...(ledger.bilibiliFolderTitle?.trim() ? { remoteDisplayTitle: ledger.bilibiliFolderTitle.trim() } : {})
      }
    },
    listSavedEnabledLedgers: async (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => {
        if (!ledger.enabled) return false
        return ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule'
      })
      .map((ledger) => ({ id: ledger.id, title: ledger.displayName })),
    listSavedLedgers: async (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => {
        return ledger.syncState !== 'local-draft' || ledger.ruleOrigin === 'saved-rule'
      })
      .map((ledger) => ({ id: ledger.id, title: ledger.displayName })),
    resolveSavedLedgerRule: async (accountMid, logicalLedgerId) => {
      const ledger = loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
        .find((candidate) => candidate.id === logicalLedgerId &&
          (candidate.syncState !== 'local-draft' || candidate.ruleOrigin === 'saved-rule'))
      if (!ledger) return undefined
      const ruleType = ledger.ruleType ?? 'keyword'
      if (ruleType === 'deepseek') return undefined
      return {
        id: ledger.id,
        title: ledger.displayName.replace(/^bilimi·/, ''),
        keywords: [...ledger.keywords],
        ruleType,
        enabled: ledger.enabled
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
    listSavedFavoriteLedgers: async (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => !isUnsavedFavoriteLedgerDraft(ledger))
      .map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })),
    applyFavoriteRecommendationRuleChanges: async (accountMid, changes) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const before = current.favoriteLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      const ledgersById = new Map(before.map((ledger) => [ledger.id, ledger]))
      for (const ledger of changes.upserts) ledgersById.set(ledger.id, { ...ledger, keywords: [...ledger.keywords] })
      for (const { ledgerId, enabled } of changes.enabled) {
        const ledger = ledgersById.get(ledgerId)
        if (ledger) ledgersById.set(ledgerId, { ...ledger, enabled })
      }
      const favoriteLedgers = [...ledgersById.values()]
      if (JSON.stringify(favoriteLedgers) !== JSON.stringify(current.favoriteLedgers)) {
        saveFavoriteAccountPreferences(getDesktopStore(), accountMid, { ...current, favoriteLedgers })
        sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
        notifyFloatingAssistantSnapshotChanged()
      }
      return { before, after: favoriteLedgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] })) }
    },
    restoreFavoriteRuleDirectory: async (accountMid, ledgers) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        favoriteLedgers: ledgers.map((ledger) => ({ ...ledger, keywords: [...ledger.keywords] }))
      })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
      notifyFloatingAssistantSnapshotChanged()
    },
    loadFavoriteLedgerHistoryLedgers: async (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => !isUnsavedFavoriteLedgerDraft(ledger)),
    restoreFavoriteLedgerHistoryState: async (accountMid, state) => {
      const current = loadFavoriteAccountPreferences(getDesktopStore(), accountMid)
      const remoteDrafts = current.favoriteLedgers.filter(isUnsavedFavoriteLedgerDraft)
      const remoteDraftIds = new Set(remoteDrafts.map((ledger) => ledger.id))
      const restoredLedgers = state.ledgers
        .filter((ledger) => !isUnsavedFavoriteLedgerDraft(ledger) && !remoteDraftIds.has(ledger.id))
      saveFavoriteAccountPreferences(getDesktopStore(), accountMid, {
        ...current,
        // Remote-only drafts are observations, not a user-rule undo target.
        // Keep their exact IDs and binding state while restoring local rules.
        favoriteLedgers: [...restoredLedgers, ...remoteDrafts]
      })
      sendAssistantPreferencesChanged(loadAssistantPreferences(getDesktopStore()))
      notifyFloatingAssistantSnapshotChanged()
    },
    workspaceStore: new OldFavoriteWorkspaceStore({
      root: join(app.getPath('userData'), 'favorites', 'repository-v1')
    })
  })
  traceStartupPhase('workspace-coordinator:ready')
  await yieldStartupEventLoop()
  oldFavoriteWorkspaceScanService = new OldFavoriteWorkspaceScanService({
    coordinator: oldFavoriteWorkspaceCoordinator,
    getFavoriteLedgers: async (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers,
    requestRuntime: (request) => requestMainAssistantRuntime(request),
    remoteOperations: favoriteRepositoryRemoteOperations,
    cancelDeepSeek: (accountMid) => oldFavoriteWorkspaceDeepSeekService?.cancelCurrentSegment(accountMid) ?? false,
    recoveryStabilizationDelayMs: 3_000,
    sourcePageDelayMinMs: 800,
    sourcePageDelayMaxMs: 1_500,
    sourcePageBatchSize: 20,
    sourcePageBatchPauseMs: 4_000
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
    generate: (request, signal) => deepSeekTaskQueue.run((taskSignal) => generateDeepSeekResult({
      config: {
        enabled: loadAssistantPreferences(getDesktopStore()).deepseekEnabled,
        apiKey: loadDeepSeekApiKey(getDesktopStore(), safeStorage),
        model: loadAssistantPreferences(getDesktopStore()).deepseekModel,
        baseUrl: loadAssistantPreferences(getDesktopStore()).deepseekBaseUrl
      },
      request,
      signal: taskSignal
    }), signal)
  })
  registerOldFavoriteWorkspaceCoordinatorIpc({
    ipcMain,
    coordinator: oldFavoriteWorkspaceCoordinator,
    deepSeekService: oldFavoriteWorkspaceDeepSeekService,
    isTrustedSender: isTrustedOldFavoriteSessionSender,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    resolveSelection: (accountMid, selection) => favoriteRepositoryService!.resolveLibrarySelection(
      accountMid, selection.scope, selection.options, selection.excludedAids
    ),
    startScan: (accountMid, mode, options) => oldFavoriteWorkspaceScanService!.start(accountMid, mode, options),
    resumeScan: (accountMid) => oldFavoriteWorkspaceScanService!.resume(accountMid),
    pauseScan: (accountMid) => oldFavoriteWorkspaceScanService!.pause(accountMid),
    resumeTagEnrichment: (accountMid) => oldFavoriteWorkspaceScanService!.resumeTagEnrichment(accountMid),
    retryFailedTagEnrichment: (accountMid) => oldFavoriteWorkspaceScanService!.retryFailedTagEnrichment(accountMid),
    prepareRecovery: async (accountMid) => {
      recoveryPreparationAccounts.add(accountMid)
      try {
        const before = await oldFavoriteWorkspaceCoordinator!.getSnapshot(accountMid)
        if (!before) return null
        // A recovery snapshot does not have a complete workspace to pause. Returning
        // its structured summary keeps the renderer on the established recovery or
        // rebuild path instead of asking DeepSeek to read a corrupt mirror.
        if ('recovery' in before) {
          return oldFavoriteWorkspaceCoordinator!.getRecoverySummary(accountMid)
        }
        await oldFavoriteWorkspaceScanService!.pauseForRecovery(accountMid)
        await oldFavoriteWorkspaceDeepSeekService!.pauseForRecovery(accountMid)
        await oldFavoriteWorkspaceCoordinator!.settleExecutionIntentForRecovery(accountMid)
        const after = await oldFavoriteWorkspaceCoordinator!.getSnapshot(accountMid)
        if (after && 'recovery' in after) {
          return oldFavoriteWorkspaceCoordinator!.getRecoverySummary(accountMid)
        }
        if (after && !('recovery' in after) && after.status === 'executing') {
          await oldFavoriteWorkspaceCoordinator!.pauseBilibiliSync(accountMid)
        }
        return oldFavoriteWorkspaceCoordinator!.getRecoverySummary(accountMid)
      } finally {
        recoveryPreparationAccounts.delete(accountMid)
      }
    },
    rebuildAndStartScan: async (accountMid) => {
      await oldFavoriteWorkspaceCoordinator!.rebuildAfterRecovery(accountMid)
      return oldFavoriteWorkspaceScanService!.start(accountMid, 'incremental')
    }
  })
  registerFavoriteRepositoryIpc({
    ipcMain,
    service: favoriteRepositoryService,
    bindingService: favoriteRepositoryBindingService,
    onLedgerBindingAdopted: async (accountMid, logicalLedgerId) => {
      // Binding success changes the authoritative repository even when the
      // account preference shape was already current; always invalidate the
      // assistant snapshot so the right-side count reads every formal shard.
      await refreshFavoriteLedgerBindingProjectionAfterPhysicalShard(accountMid)
    },
    isTrustedSender: isTrustedOldFavoriteSessionSender,
    isTrustedReader: isTrustedFavoriteLibraryReader,
    getCurrentAccountMid: readCurrentBilibiliAccountMid,
    getLocalDraftLedgerIds: (accountMid) => loadFavoriteAccountPreferences(getDesktopStore(), accountMid).favoriteLedgers
      .filter((ledger) => ledger.syncState === 'local-draft' && !ledger.bilibiliFolderId)
      .map((ledger) => ledger.id),
    send: (senderId, channel, payload) => {
      const target = webContents.fromId(senderId)
      if (target && !target.isDestroyed()) target.send(channel, payload)
    },
    getArchiveSummary: (accountMid, aid) => createFavoriteLibraryArchiveSummary(accountMid, aid, loadVideoNoteArchives(getDesktopStore())),
    getTranscriptionSummary: (accountMid, aid) =>
      createFavoriteLibraryTranscriptionSummary(accountMid, aid, getVideoTranscriptionQueue().getSnapshot().items),
    // Project durable formal physical shards before returning the first drawer
    // summary. Remote inventory is read only by an explicit backup workflow;
    // account opening must never turn an observation into a library shard.
    onAccountOpenLocal: async (accountMid) => {
      await reconcileFavoriteLedgerBindingProjection(accountMid)
    },
    // A user-local deletion is not the same as choosing “不再提醒”. The
    // former must not hide a still-existing remote bilimi folder from the
    // next inventory projection; only the explicit reminder dismissal does.
    getRemoteDraftReminderDismissed: (accountMid) =>
      loadFavoriteLedgerRemoteDraftReminderDismissals(getDesktopStore(), accountMid),
    dismissRemoteDraftReminder: (accountMid, remoteFolderId) => {
      dismissFavoriteLedgerRemoteDraftReminder(getDesktopStore(), accountMid, remoteFolderId)
      return { status: 'succeeded' as const, remoteFolderId }
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
      return resolveFavoriteLibraryOperationSource(snapshot, source, requestedAids)
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
      mainWindow: mainWindow && !mainWindow.isDestroyed()
        ? createAssistantRuntimeTarget(mainWindow)
        : null,
      restoreMainWindow: () => createAssistantRuntimeTarget(restoreMainWindowOnly())
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
    onCurrentAccountDataClear: async (accountMid, clearLocalData) => {
      const notifyTargets = () => [mainWindow, floatingSealWindow, floatingAssistantController.getWindow()]
        .filter((target): target is BrowserWindow => Boolean(target && !target.isDestroyed()))
      await clearCurrentAccountLocalData(accountMid, clearLocalData, {
        stopTranscription: async () => { await getVideoTranscriptionQueue().cancelAllAndWait() },
        stopScan: async () => { await oldFavoriteWorkspaceScanService?.quiesceForDestructiveMaintenance() },
        stopDeepSeek: async () => { await oldFavoriteWorkspaceDeepSeekService?.quiesceForDestructiveMaintenance() },
        runRemoteMaintenance: async (operation) => { await favoriteRepositoryRemoteOperations.runDestructiveMaintenance(operation) },
        flushRepository: async () => { await favoriteRepositoryService?.flush() },
        clearLoginSession: async () => {
          await session.fromPartition(BILIMI_SESSION_PARTITION).clearStorageData({ storages: ['cookies'] })
          lastBilibiliAccountMid = ''
        },
        clearRuntimeAccount: () => {
          getVideoTranscriptionQueue().clearAccount(accountMid)
          oldFavoriteWorkspaceCoordinator?.resetAfterAccountLocalDataClear(accountMid)
          videoNoteBatchExportIpc?.clearCompletedFoldersForAccount(accountMid)
          getFavoriteLedgerEnabledOverrideStore().clear(accountMid)
        },
        refreshGuestPages: () => refreshBilibiliGuestPages({
          getAllWebContents: () => webContents.getAllWebContents(),
          targetSession: session.fromPartition(BILIMI_SESSION_PARTITION)
        }),
        notifyLocalDataReset: () => {
          for (const target of notifyTargets()) target.webContents.send('local-data:reset')
          publishVideoAudioTranscriptionQueueChanged(getVideoTranscriptionQueue().getSnapshot(), false)
          notifyFloatingAssistantSnapshotChanged()
        },
        notifyAccountChanged: () => {
          for (const target of notifyTargets()) target.webContents.send('bilibili:account-changed')
        },
        resumeServices: () => {
          oldFavoriteWorkspaceScanService?.resumeAfterDestructiveMaintenance()
          oldFavoriteWorkspaceDeepSeekService?.resumeAfterDestructiveMaintenance()
          favoriteRepositoryRemoteOperations.resumeAfterFailedMaintenance()
        }
      })
    },
    onAccountDataCleared: (accountMid) => {
      videoNoteBatchExportIpc?.clearCompletedFoldersForAccount(accountMid)
      getVideoTranscriptionQueue().clearAccount(accountMid)
      oldFavoriteWorkspaceCoordinator?.resetAfterAccountLocalDataClear(accountMid)
      getFavoriteLedgerEnabledOverrideStore().clear(accountMid)
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
  // Do not create the non-critical pet while account/session recovery and
  // service registration are still occupying startup. The renderer may report
  // interactivity earlier; the two gates converge here without blocking it.
  startupServicesReady = true
  maybeScheduleAutomaticFloatingSealWake()
  if (singleInstanceGuard.hasPendingFocus()) singleInstanceGuard.focusMainWindow()
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
app.on('before-quit', cancelAutomaticFloatingSealWake)
app.on('before-quit', disposeFloatingSealIdleTaskScheduler)
app.on('before-quit', disposeDefaultFasterWhisperHelperSessions)
app.on('before-quit', disposeFasterWhisperGpuProbes)

app.on('window-all-closed', () => {
  if (appQuitting && process.platform !== 'darwin') app.quit()
})
