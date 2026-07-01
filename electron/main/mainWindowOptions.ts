import { resolve } from 'node:path'
import { APP_TITLE } from '../../src/shared/constants'

export function getMainWindowIconPath(platform = process.platform): string {
  if (platform === 'win32') {
    return resolve(__dirname, '../../build/icon.ico')
  }

  return resolve(__dirname, '../../electron/assets/bilimi-avatar.png')
}

export function createMainWindowOptions(preload: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1600,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    title: APP_TITLE,
    icon: getMainWindowIconPath(),
    show: true,
    frame: true,
    autoHideMenuBar: true,
    skipTaskbar: false,
    backgroundColor: '#1f140f',
    webPreferences: {
      preload,
      webviewTag: true,
      contextIsolation: true,
      sandbox: false
    }
  }
}
