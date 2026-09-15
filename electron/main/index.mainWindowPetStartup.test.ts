import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const idleTaskSource = readFileSync(resolve(process.cwd(), 'electron/main/floatingSealIdleTask.ts'), 'utf8')
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const rendererSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')
const rendererEntrySource = readFileSync(resolve(process.cwd(), 'src/renderer/src/main.tsx'), 'utf8')

describe('main-window first pet startup wiring', () => {
  it('starts the automatic pet wake only after the main renderer reports an interactive frame', () => {
    const startup = mainSource.slice(mainSource.indexOf('if (singleInstanceGuard) app.whenReady()'))
    const readyHandlerStart = mainSource.indexOf("ipcMain.on('main-window:interactive-ready'")
    const readyHandler = mainSource.slice(readyHandlerStart, mainSource.indexOf("ipcMain.handle('", readyHandlerStart))

    expect(startup).not.toContain('void floatingSealWakeController.wake()')
    expect(readyHandler).toContain('maybeScheduleAutomaticFloatingSealWake()')
    expect(readyHandler).toContain('event.sender.id !== mainWindow.webContents.id')
    expect(preloadSource).toContain("notifyMainWindowInteractive: () => ipcRenderer.send('main-window:interactive-ready')")
    expect(rendererSource).toContain('window.bilimiDesktop?.notifyMainWindowInteractive?.()')
    expect(readyHandler).toContain('mainRendererInteractiveReady = true')
    expect(readyHandler).toContain('maybeScheduleAutomaticFloatingSealWake()')
    expect(startup).toContain('startupServicesReady = true')
  })

  it('records a dedicated first-frame signal before interactive readiness', () => {
    const firstFrameHandlerStart = mainSource.indexOf("ipcMain.on('main-window:first-frame'")
    const firstFrameHandler = mainSource.slice(firstFrameHandlerStart, mainSource.indexOf("ipcMain.on('main-window:interactive-ready'", firstFrameHandlerStart))

    expect(preloadSource).toContain("notifyMainWindowFirstFrame: () => ipcRenderer.send('main-window:first-frame')")
    expect(rendererSource).toContain('notifyMainWindowFirstFrame?.()')
    expect(firstFrameHandlerStart).toBeGreaterThanOrEqual(0)
    expect(firstFrameHandler).toContain('event.sender.id !== mainWindow.webContents.id')
    expect(firstFrameHandler).toContain("traceStartupPhase('main-window:first-frame')")
  })

  it('reports interactivity from a browser idle task so pet creation cannot compete with first-frame input', () => {
    const notifyIndex = rendererSource.indexOf('window.bilimiDesktop?.notifyMainWindowInteractive?.()')
    const interactiveEffect = rendererSource.slice(rendererSource.lastIndexOf('useEffect(() => {', notifyIndex), notifyIndex + 120)
    const notifyFunctionStart = rendererSource.lastIndexOf('const notifyInteractive =', notifyIndex)
    const notifyFunction = rendererSource.slice(notifyFunctionStart, notifyIndex)

    expect(interactiveEffect).toContain('requestIdleCallback')
    expect(interactiveEffect).toContain('cancelIdleCallback')
    expect(notifyFunction).not.toContain('setHomeWebviewActivated(true)')
    expect(rendererSource).toContain('onInitialLoadSettled')
    expect(rendererSource).toContain('notifyHomeWebviewLoadSettled')
  })

  it('releases automatic pet wake only after the home Bilibili guest settles', () => {
    const gateSource = mainSource.slice(mainSource.indexOf('let mainRendererInteractiveReady'))
    const readyHandlerStart = mainSource.indexOf("ipcMain.on('main-window:interactive-ready'")
    const readyHandler = mainSource.slice(readyHandlerStart, mainSource.indexOf("ipcMain.handle('", readyHandlerStart))

    expect(gateSource).toContain('homeWebviewLoadSettled')
    expect(gateSource).toContain('if (!mainRendererInteractiveReady || !startupServicesReady || !homeWebviewLoadSettled) return')
    expect(readyHandler).toContain('mainRendererInteractiveReady = true')
    expect(mainSource).toContain("ipcMain.on('home-webview:load-settled'")
    expect(mainSource).toContain('homeWebviewLoadSettled = true')
  })

  it('requires the persisted automatic pet startup preference before scheduling wake', () => {
    const gateStart = mainSource.indexOf('function maybeScheduleAutomaticFloatingSealWake()')
    const gateEnd = mainSource.indexOf('\n}\n\nfunction cancelAutomaticFloatingSealWake()', gateStart)
    const gate = mainSource.slice(gateStart, gateEnd)

    expect(mainSource).toContain('let automaticPetStartupEnabledForThisLaunch = false')
    expect(mainSource).toContain('automaticPetStartupEnabledForThisLaunch = loadAssistantPreferences(getDesktopStore()).autoShowPetOnStartup')
    expect(gate).toContain('if (!automaticPetStartupEnabledForThisLaunch) return')
    expect(gate.indexOf('automaticPetStartupEnabledForThisLaunch')).toBeLessThan(gate.indexOf('scheduleAutomaticFloatingSealWake()'))
  })

  it('persists close as startup suppression and explicit wake as startup opt-in', () => {
    const closeStart = mainSource.indexOf('function closeAssistantPetWindow(')
    const closeEnd = mainSource.indexOf('\n}\n\nfunction restoreMainWindowFromTray()', closeStart)
    const closeSource = mainSource.slice(closeStart, closeEnd)
    const wakeStart = mainSource.indexOf('function wakeAssistantPetWindow(')
    const wakeEnd = mainSource.indexOf('function notifyFloatingAssistantSnapshotChanged', wakeStart)
    const wakeSource = mainSource.slice(wakeStart, wakeEnd)

    expect(closeSource).toContain('persistStartupPreference !== false && !options.temporarilyForVideoFullscreen')
    expect(closeSource).toContain('saveAssistantPreferencePatch({ autoShowPetOnStartup: false })')
    expect(mainSource).toContain("ipcMain.handle('assistant-pet:close', (event, requestedOptions: unknown) =>")
    expect(mainSource).toContain('assertTrustedAssistantPetSender(event)')
    expect(mainSource).toContain('return closeAssistantPetWindow({ temporarilyForVideoFullscreen })')
    expect(wakeSource).toContain('persistStartupPreference !== false')
    expect(wakeSource).toContain('saveAssistantPreferencePatch({ autoShowPetOnStartup: true })')
    expect(wakeSource).toContain('floatingSealWakeController.wakeImmediately()')
    expect(mainSource).toContain("ipcMain.handle('assistant-pet:wake', (event, requestedOptions: unknown) =>")
  })

  it('keeps fullscreen recovery to one main-process visible-pet marker without a session lifecycle', () => {
    const closeStart = mainSource.indexOf('function closeAssistantPetWindow(')
    const closeEnd = mainSource.indexOf('\n}\n\nfunction restoreMainWindowFromTray()', closeStart)
    const closeSource = mainSource.slice(closeStart, closeEnd)
    const wakeStart = mainSource.indexOf('async function wakeAssistantPetWindow(')
    const wakeEnd = mainSource.indexOf('function notifyFloatingAssistantSnapshotChanged', wakeStart)
    const wakeSource = mainSource.slice(wakeStart, wakeEnd)

    expect(mainSource).toContain('let petHiddenForVideoFullscreen = false')
    expect(closeSource).toContain('const wasVisible = Boolean(')
    expect(closeSource).toContain('if (options.temporarilyForVideoFullscreen)')
    expect(closeSource).toContain('cancelAutomaticFloatingSealWake()')
    expect(closeSource).toContain('if (!wasVisible) {')
    expect(closeSource).toContain('floatingSealWakeController.cancelPendingWake()')
    expect(closeSource).toContain('petHiddenForVideoFullscreen = true')
    expect(closeSource).toContain('petHiddenForVideoFullscreen = false')
    expect(wakeSource).toContain('if (options.restoreAfterVideoFullscreen)')
    expect(wakeSource).toContain('if (!petHiddenForVideoFullscreen) return false')
    expect(wakeSource).toContain('petHiddenForVideoFullscreen = false')
    expect(wakeSource).toContain('!options.restoreAfterVideoFullscreen')
    expect(rendererSource).toContain('closeAssistantPet?.({ temporarilyForVideoFullscreen: true })')
    expect(rendererSource).toContain('wakeAssistantPet?.({ restoreAfterVideoFullscreen: true })')
    expect(mainSource).not.toContain('videoFullscreenPetLifecycle')
    expect(mainSource).not.toContain('begin-video-fullscreen')
    expect(mainSource).not.toContain('hide-for-video-fullscreen')
    expect(mainSource).not.toContain('restore-after-video-fullscreen')
    expect(preloadSource).not.toContain('beginAssistantPetVideoFullscreen')
    expect(preloadSource).not.toContain('hideAssistantPetForVideoFullscreen')
    expect(preloadSource).not.toContain('restoreAssistantPetAfterVideoFullscreen')
    expect(mainSource).toContain('event.sender.id === mainWindow?.webContents.id')
  })

  it('keeps home guest loading independent from the main interactive notification', () => {
    const notifyIndex = rendererSource.indexOf('window.bilimiDesktop?.notifyMainWindowInteractive?.()')
    const notifyFunctionStart = rendererSource.lastIndexOf('const notifyInteractive =', notifyIndex)
    const notifyFunction = rendererSource.slice(notifyFunctionStart, notifyIndex)

    expect(notifyFunction).not.toContain('setHomeWebviewActivated(true)')
    expect(rendererSource).toContain('const activateHomeWebview')
    expect(rendererSource).toContain('onInitialLoadSettled={')
  })

  it('bounds renderer idle waits so startup interactivity cannot be postponed indefinitely', () => {
    const notifyIndex = rendererSource.indexOf('window.bilimiDesktop?.notifyMainWindowInteractive?.()')
    const effectStart = rendererSource.lastIndexOf('useEffect(() => {', notifyIndex)
    const startupEffect = rendererSource.slice(effectStart, rendererSource.indexOf('}, [])', notifyIndex) + 6)

    expect(startupEffect).toContain('requestIdleCallback?.(notifyInteractive, { timeout: 1000 })')
    expect(startupEffect).toContain('requestIdleCallback?.(activateHomeWebview, { timeout: 3000 })')
  })

  it('settles a stalled home guest through a bounded network fallback', () => {
    expect(rendererSource).toContain('HOME_WEBVIEW_LOAD_SETTLE_TIMEOUT_MS')
    expect(rendererSource).toContain('notifyHomeWebviewLoadSettled')
    expect(rendererSource).toContain('homeWebviewLoadSettledRef.current')
  })

  it('does not let the home load watchdog impersonate a real load-settled event', () => {
    const watchdogStart = rendererSource.indexOf('homeWebviewLoadSettleTimeoutRef.current = window.setTimeout')
    const watchdogEnd = rendererSource.indexOf('\n    }, HOME_WEBVIEW_LOAD_SETTLE_TIMEOUT_MS)', watchdogStart) +
      '\n    }, HOME_WEBVIEW_LOAD_SETTLE_TIMEOUT_MS)'.length
    const watchdog = rendererSource.slice(watchdogStart, watchdogEnd)

    expect(watchdog).toContain('notifyHomeWebviewLoadTimeout')
    expect(watchdog).not.toContain('notifyHomeWebviewLoadSettled()')
  })

  it('does not auto-mount the home guest webview on a startup timeout', () => {
    expect(rendererSource).not.toContain('const activate = () => setHomeWebviewActivated(true)')
    expect(rendererSource).not.toContain('requestIdleCallback?.(activate, { timeout: 1200 })')
    expect(rendererSource).not.toContain('window.setTimeout(activate, 320)')
  })

  it('yields the event loop after creating the visible shell before startup session work', () => {
    const startup = mainSource.slice(mainSource.indexOf('if (singleInstanceGuard) app.whenReady()'))
    const createIndex = startup.indexOf('createMainWindow()')
    const proxyIndex = startup.indexOf('await bilibiliSessionProxy.applyPreference')
    const yieldIndex = startup.indexOf('await yieldStartupEventLoop()')

    expect(createIndex).toBeGreaterThanOrEqual(0)
    expect(yieldIndex).toBeGreaterThan(createIndex)
    expect(yieldIndex).toBeLessThan(proxyIndex)
  })

  it('shows the pet before deferred white-strip polish so native repair cannot block input', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)
    const nativePolishStart = mainSource.indexOf('function installFloatingSealWhiteStripPolish(')
    const nativePolishEnd = mainSource.indexOf('\n}\n\nfunction createFloatingSealWindow()', nativePolishStart)
    const nativePolish = mainSource.slice(nativePolishStart, nativePolishEnd)

    expect(petCreation).toContain("scheduleFloatingSealIdleTask(async () =>")
    expect(petCreation).not.toContain('installFloatingSealWhiteStripFix(seal')
    expect(petCreation).not.toContain('await installFloatingSealCaptionStrip(seal')
    expect(petCreation).toContain("seal.webContents.once('did-finish-load'")
    expect(petCreation).toContain('floatingSealMouseRecovery = createFloatingSealMouseRecoveryController')
    expect(petCreation).toContain('floatingSealWakeController.showWhenReady(seal)')
    const readyShow = petCreation.slice(petCreation.indexOf("seal.webContents.once('did-finish-load'"))
    expect(readyShow).toContain('schedulePostShowStartupStages()')
    expect(readyShow).not.toContain('installFloatingSealWhiteStripPolish(seal')
    expect(nativePolish).toContain('installFloatingSealWhiteStripFix(seal')
    expect(mainSource).toContain("'floating-seal:white-strip-recomposite'")
    expect(mainSource).not.toContain("'floating-seal:caption-polish'")
    expect(mainSource).not.toContain('function scheduleFloatingSealCaptionPolish(seal: BrowserWindow)')
    expect(mainSource).not.toContain('await installFloatingSealCaptionStrip(seal')
  })

  it('permanently skips caption polish without an environment switch', () => {
    expect(mainSource).not.toContain('BILIMI_SKIP_PET_CAPTION_POLISH')
    expect(mainSource).toContain("traceStartupPhase('pet-native-polish:caption-skipped')")
    expect(mainSource).not.toContain('scheduleFloatingSealCaptionPolish(seal)')
  })

  it('keeps the cold pet show path to click-through and display before post-show native setup', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)
    const showIndex = petCreation.indexOf('floatingSealWakeController.showWhenReady(seal)')

    expect(showIndex).toBeGreaterThanOrEqual(0)
    expect(petCreation.indexOf('setFloatingSealMouseTransparency(seal, true)')).toBeLessThan(showIndex)
    const readyShow = petCreation.slice(showIndex)
    expect(readyShow).toContain('schedulePostShowStartupStages()')
    expect(readyShow).not.toContain('installFixedFloatingSealBoundsGuard(seal)')
    expect(readyShow).not.toContain('createFloatingSealMouseRecoveryController({')
    expect(readyShow).not.toContain('seal.setVisibleOnAllWorkspaces')
    expect(readyShow).not.toContain('seal.removeMenu()')
    expect(petCreation).toContain("scheduleFloatingSealIdleTask(() =>")
    expect(petCreation).toContain('const cancelStartupStages = () =>')
    expect(petCreation).toContain('const schedulePostShowStartupStages = () =>')
    expect(petCreation).toContain('schedulePostShowStartupStages()')
  })

  it('cancels all queued pet startup stages when the pet is hidden or closed', () => {
    expect(mainSource).toContain('let cancelFloatingSealStartupStages')
    expect(mainSource).toContain('cancelFloatingSealStartupStages?.()')
    expect(mainSource).toContain('const cancelStartupStages = () =>')
  })

  it('schedules automatic pet wake through a cancellable idle task', () => {
    const startup = mainSource.slice(mainSource.indexOf('function scheduleAutomaticFloatingSealWake()'))
    expect(startup).toContain('scheduleFloatingSealIdleTask')
    expect(startup).toContain('ignorePointerMove: true')
    expect(startup).toContain('cancelFloatingSealIdleTask')
    expect(startup).not.toContain('setImmediate(() =>')
  })

  it('routes native pet creation through the same cancellable grace scheduler', () => {
    const controllerStart = mainSource.indexOf('const floatingSealWakeController')
    const controller = mainSource.slice(controllerStart, mainSource.indexOf('let automaticFloatingSealWakeScheduled', controllerStart))
    expect(controller).toContain("'floating-seal:create'")
    expect(controller).toContain('minimumQuietWindowMs: 600')
    expect(controller).toContain('ignorePointerMove: true')
    expect(controller).toContain('cancelCreate: (handle) => cancelFloatingSealIdleTask(handle as FloatingSealIdleTaskHandle)')
  })

  it('keeps the main-process pet task cancellable before native pet creation', () => {
    expect(idleTaskSource).toContain('createStartupInputScheduler')
    expect(idleTaskSource).toContain('handle.cancel()')
    expect(idleTaskSource).toContain('noteStartupInputActivity')
  })

  it('keeps automatic pet wake behind a 600ms real-interaction grace period while continuous pointer movement is tolerated', () => {
    expect(idleTaskSource).toContain('quietWindowMs: 160')
    expect(idleTaskSource).toContain('startupInputScheduler.schedule')
    expect(idleTaskSource).not.toContain('FLOATING_SEAL_IDLE_GRACE_MS')
    const startup = mainSource.slice(mainSource.indexOf('function scheduleAutomaticFloatingSealWake()'))
    expect(startup).toContain('minimumQuietWindowMs: 600')
    expect(startup).toContain('minimumDelayMs: 600')
    expect(startup).toContain('ignorePointerMove: true')
    expect(idleTaskSource).not.toContain('setImmediate(() =>')
  })

  it('waits for a browser idle boundary after the home page settles before releasing the pet gate', () => {
    const notifyStart = rendererSource.indexOf('const notifyHomeWebviewLoadSettled = useCallback')
    const notifyEnd = rendererSource.indexOf('\n\n  useEffect(() => {', notifyStart)
    const notification = rendererSource.slice(notifyStart, notifyEnd)

    expect(notification).toContain('idleWindow.requestIdleCallback?.(')
    expect(notification).toContain('notifyHomeWebviewLoadSettledWhenIdle')
    expect(notification).toContain('cancelIdleCallback')
    expect(notification).toContain('homeWebviewIdleNotificationHandleRef')
  })

  it('lets trusted main and guest input defer automatic pet startup without observing input content', () => {
    expect(mainSource).toContain('function isPointerMoveInput(inputType: string | undefined, modifiers: string[] | undefined = [])')
    expect(mainSource).toContain("inputType !== 'mouseMove'")
    expect(mainSource).toContain("inputType !== 'pointerMove'")
    expect(mainSource).toContain("normalizedModifier === 'left'")
    expect(mainSource).toContain("normalizedModifier === 'middle'")
    expect(mainSource).toContain("normalizedModifier === 'right'")
    expect(mainSource).toContain("normalizedModifier.endsWith('buttondown')")
    expect(mainSource).toContain("target.on('before-input-event', (_event, input) =>")
    expect(mainSource).toContain("target.on('input-event', (_event, inputEvent) =>")
    expect(mainSource).toContain("isPointerMoveInput(input.type, input.modifiers) ? 'pointer-move' : 'foreground'")
    expect(mainSource).toContain('installStartupInputObserver(win.webContents)')
    expect(mainSource).toContain('installStartupInputObserver(webContents)')
    expect(mainSource).toContain("win.on('move', noteWindowInput)")
    expect(mainSource).not.toContain("for (const eventName of ['move', 'resize', 'minimize', 'restore', 'close'])")
    expect(mainSource).toContain("ipcMain.on('startup:input-activity'")
    expect(mainSource).toContain("traceStartupPhase(activity === 'pointer-move' ? 'input:pointer-move' : 'input:foreground')")
    expect(mainSource).toContain("activity === 'pointer-move' ? 'pointer-move' : 'foreground'")
    expect(preloadSource).toContain("notifyStartupInputActivity: (activity: 'pointer-move' | 'foreground' = 'foreground') => ipcRenderer.send('startup:input-activity', activity)")
    expect(rendererEntrySource).toContain("window.addEventListener('pointermove', (event) => {")
    expect(rendererEntrySource).toContain("event.buttons === 0 ? 'pointer-move' : 'foreground'")
    expect(rendererEntrySource).toContain("notifyStartupInputActivity('foreground')")
  })

  it('keeps a real home guest load outcome when the renderer identifies the WebView after its event fires', () => {
    const routingStart = mainSource.indexOf('function installWindowOpenRouting(win: BrowserWindow)')
    const routing = mainSource.slice(routingStart, mainSource.indexOf('\n}\n\nfunction installStartupInputObservers', routingStart))
    const homeGateStart = mainSource.indexOf('let mainRendererInteractiveReady = false')
    const homeGate = mainSource.slice(homeGateStart, mainSource.indexOf('\nfunction scheduleAutomaticFloatingSealWake()', homeGateStart))

    expect(routing).toContain("webContents.once('dom-ready'")
    expect(routing).toContain("webContents.once('did-stop-loading'")
    expect(routing).toContain("webContents.once('did-fail-load'")
    expect(routing).toContain('rememberHomeGuestLoadOutcome(webContents.id)')
    expect(homeGate).toContain('homeWebviewGuestId')
    expect(homeGate).toContain('settledHomeGuestIds')
    expect(homeGate).toContain('registerHomeWebviewGuest')
    expect(mainSource).toContain("ipcMain.on('home-webview:guest-attached'")
    expect(preloadSource).toContain("notifyHomeWebviewGuestAttached: (webContentsId: number) => ipcRenderer.send('home-webview:guest-attached', webContentsId)")
    expect(rendererSource).toContain('window.bilimiDesktop?.notifyHomeWebviewGuestAttached?.(state.webContentsId)')
  })

  it('cancels queued pet stages when the window is hidden, not only when it is destroyed', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)

    expect(petCreation).toContain("seal.on('hide'")
    expect(petCreation).toContain('cancelStartupStages()')
    expect(petCreation).toContain('removeDisplayChangeListeners()')
    expect(petCreation).toContain("screen.off('display-metrics-changed', handleFloatingSealDisplayChange)")
    expect(petCreation).toContain('if (seal.isDestroyed() || floatingSealWindow !== seal || !seal.isVisible()) return')
  })

  it('requeues post-show setup when an already-ready pet is shown again without forcing opacity', () => {
    const controllerStart = mainSource.indexOf('const floatingSealWakeController')
    const controller = mainSource.slice(controllerStart, mainSource.indexOf('let automaticFloatingSealWakeScheduled', controllerStart))
    expect(controller).toContain('scheduleFloatingSealPostShowStartupStages?.()')
    expect(controller).not.toContain('setFloatingSealWindowMouseTransparent(false)')
  })

  it('loads only the current window renderer module at startup', () => {
    expect(rendererEntrySource).toMatch(/^import App from '\.\/App'/mu)
    expect(rendererEntrySource).not.toMatch(/^import \{ FloatingAssistantApp/mu)
    expect(rendererEntrySource).not.toMatch(/^import \{ FloatingMenuApp/mu)
    expect(rendererEntrySource).not.toMatch(/^import \{ PalaceMaidPetApp/mu)
    expect(rendererEntrySource).not.toContain("lazy(() => import('./App')")
    expect(rendererEntrySource).not.toContain("import('./App?startup-retry')")
    expect(rendererEntrySource).toContain("lazy(() => loadStartupModuleWithRetry(")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/FloatingAssistantApp')")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/FloatingAssistantApp?startup-retry')")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/FloatingMenuApp')")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/FloatingMenuApp?startup-retry')")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/PalaceMaidPetApp')")
    expect(rendererEntrySource).toContain("() => import('./features/assistant/PalaceMaidPetApp?startup-retry')")
  })
})
