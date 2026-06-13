import { APP_TITLE } from '../../src/shared/constants'

export function createMainWindowOptions(preload: string): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 1280,
    minHeight: 820,
    title: APP_TITLE,
    show: true,
    frame: true,
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
