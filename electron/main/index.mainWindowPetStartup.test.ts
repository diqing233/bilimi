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
    expect(readyHandler).toContain('scheduleAutomaticFloatingSealWake()')
    expect(readyHandler).toContain('event.sender.id !== mainWindow.webContents.id')
    expect(preloadSource).toContain("notifyMainWindowInteractive: () => ipcRenderer.send('main-window:interactive-ready')")
    expect(rendererSource).toContain('window.bilimiDesktop?.notifyMainWindowInteractive?.()')
  })
})
