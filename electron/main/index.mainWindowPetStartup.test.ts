import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
const idleTaskSource = readFileSync(resolve(process.cwd(), 'electron/main/floatingSealIdleTask.ts'), 'utf8')
const preloadSource = readFileSync(resolve(process.cwd(), 'electron/preload/index.ts'), 'utf8')
const rendererSource = readFileSync(resolve(process.cwd(), 'src/renderer/src/App.tsx'), 'utf8')

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

  it('shows the pet before optional native polish so caption repair cannot block input', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)
    const nativePolishStart = mainSource.indexOf('function scheduleFloatingSealNativePolish(')
    const nativePolishEnd = mainSource.indexOf('\n}\n\nfunction createFloatingSealWindow()', nativePolishStart)
    const nativePolish = mainSource.slice(nativePolishStart, nativePolishEnd)

    expect(petCreation).not.toContain('await scheduleFloatingSealNativePolish(seal')
    expect(petCreation).not.toContain('installFloatingSealWhiteStripFix(seal')
    expect(petCreation).not.toContain('installFloatingSealCaptionStrip(seal')
    expect(petCreation).toContain("seal.webContents.once('did-finish-load'")
    expect(petCreation).toContain('floatingSealMouseRecovery = createFloatingSealMouseRecoveryController')
    expect(petCreation).toContain('floatingSealWakeController.showWhenReady(seal)')
    expect(petCreation).toContain('void scheduleFloatingSealNativePolish(seal')
    expect(petCreation.indexOf('floatingSealWakeController.showWhenReady(seal)')).toBeLessThan(
      petCreation.indexOf('void scheduleFloatingSealNativePolish(seal')
    )
    expect(nativePolish).toContain('await new Promise<void>((resolve) => setImmediate(resolve))')
    expect(nativePolish).toContain('installFloatingSealWhiteStripFix(seal')
    expect(nativePolish).toContain('installFloatingSealCaptionStrip(seal')
    expect(nativePolish).toContain('await disposeWhiteStripFix.recomposite()')
    expect(nativePolish).toContain('await installFloatingSealCaptionStrip(seal')
  })

  it('keeps the cold pet show path to click-through and display before post-show native setup', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)
    const showIndex = petCreation.indexOf('floatingSealWakeController.showWhenReady(seal)')

    expect(showIndex).toBeGreaterThanOrEqual(0)
    expect(petCreation.indexOf('setFloatingSealMouseTransparency(seal, true)')).toBeLessThan(showIndex)
    expect(petCreation.indexOf('installFixedFloatingSealBoundsGuard(seal)')).toBeGreaterThan(showIndex)
    expect(petCreation.indexOf('createFloatingSealMouseRecoveryController({')).toBeGreaterThan(showIndex)
    expect(petCreation.indexOf('seal.setVisibleOnAllWorkspaces')).toBeGreaterThan(showIndex)
    expect(petCreation.indexOf('seal.removeMenu()')).toBeGreaterThan(showIndex)
    expect(petCreation).toContain('postShowSetupHandle = scheduleFloatingSealIdleTask')
    expect(petCreation).toContain('cancelFloatingSealIdleTask(postShowSetupHandle)')
  })

  it('schedules automatic pet wake through a cancellable idle task', () => {
    const startup = mainSource.slice(mainSource.indexOf('function scheduleAutomaticFloatingSealWake()'))
    expect(startup).toContain('scheduleFloatingSealIdleTask')
    expect(startup).toContain('cancelFloatingSealIdleTask')
    expect(startup).not.toContain('setImmediate(() =>')
  })

  it('keeps the main-process pet task cancellable before native pet creation', () => {
    expect(idleTaskSource).toContain('setImmediate(callback)')
    expect(idleTaskSource).toContain('clearImmediate(handle')
    expect(idleTaskSource).not.toContain('setTimeout(callback, 0)')
  })

  it('releases pet creation through a cancellable event-loop turn after renderer idle instead of a fixed grace delay', () => {
    expect(idleTaskSource).not.toContain('FLOATING_SEAL_IDLE_GRACE_MS')
    expect(idleTaskSource).toContain('setImmediate(callback)')
    expect(idleTaskSource).toContain('clearImmediate(handle')
    expect(idleTaskSource).not.toContain('setTimeout(')
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
})
