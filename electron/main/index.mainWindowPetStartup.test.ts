import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'electron/main/index.ts'), 'utf8')
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

    expect(interactiveEffect).toContain('requestIdleCallback')
    expect(interactiveEffect).toContain('cancelIdleCallback')
    expect(interactiveEffect).toContain('setHomeWebviewActivated(true)')
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

  it('keeps the pet hidden until renderer loading, DWM recomposition, caption repair, and mouse recovery initialization finish in order', () => {
    const petStart = mainSource.indexOf('function createFloatingSealWindow()')
    const petEnd = mainSource.indexOf('\n}\n\nconst floatingSealWakeController', petStart)
    const petCreation = mainSource.slice(petStart, petEnd)
    const nativePolishStart = mainSource.indexOf('function scheduleFloatingSealNativePolish(')
    const nativePolishEnd = mainSource.indexOf('\n}\n\nfunction createFloatingSealWindow()', nativePolishStart)
    const nativePolish = mainSource.slice(nativePolishStart, nativePolishEnd)

    expect(petCreation).toContain('await scheduleFloatingSealNativePolish(seal')
    expect(petCreation).not.toContain('installFloatingSealWhiteStripFix(seal')
    expect(petCreation).not.toContain('installFloatingSealCaptionStrip(seal')
    expect(petCreation).toContain("seal.webContents.once('did-finish-load'")
    expect(petCreation).toContain('floatingSealMouseRecovery = createFloatingSealMouseRecoveryController')
    expect(petCreation).toContain('floatingSealWakeController.showWhenReady(seal)')
    expect(nativePolish).toContain('await new Promise<void>((resolve) => setImmediate(resolve))')
    expect(nativePolish).toContain('installFloatingSealWhiteStripFix(seal')
    expect(nativePolish).toContain('installFloatingSealCaptionStrip(seal')
    expect(nativePolish).toContain('await disposeWhiteStripFix.recomposite()')
    expect(nativePolish).toContain('await installFloatingSealCaptionStrip(seal')
  })

  it('schedules automatic pet wake through a cancellable idle task', () => {
    const startup = mainSource.slice(mainSource.indexOf('function scheduleAutomaticFloatingSealWake()'))
    expect(startup).toContain('scheduleFloatingSealIdleTask')
    expect(startup).toContain('cancelFloatingSealIdleTask')
    expect(startup).not.toContain('setImmediate(() =>')
  })
})
