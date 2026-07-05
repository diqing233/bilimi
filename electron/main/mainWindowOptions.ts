import { resolve } from 'node:path'
import { APP_TITLE } from '../../src/shared/constants'

type MainWindowWorkAreaSize = {
  width: number
  height: number
}

const MAIN_WINDOW_PREFERRED_SIZE = { width: 1600, height: 960 }
const MAIN_WINDOW_REGULAR_MIN_SIZE = { width: 1280, height: 820 }
const MAIN_WINDOW_COMPACT_MIN_SIZE = { width: 1080, height: 660 }
const MAIN_WINDOW_ABSOLUTE_MIN_SIZE = { width: 960, height: 600 }
const MAIN_WINDOW_WORK_AREA_RATIO = 0.92

export function getMainWindowIconPath(platform = process.platform): string {
  if (platform === 'win32') {
    return resolve(__dirname, '../../build/icon.ico')
  }

  return resolve(__dirname, '../../electron/assets/bilimi-avatar.png')
}

function clampDimension(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveMinimumDimension({
  absoluteMin,
  compactMin,
  regularMin,
  workArea,
  workAreaCap
}: {
  absoluteMin: number
  compactMin: number
  regularMin: number
  workArea: number
  workAreaCap: number
}) {
  const targetMin = workArea < regularMin + 120 ? compactMin : regularMin
  const upperBound = Math.max(absoluteMin, workAreaCap)

  return clampDimension(targetMin, absoluteMin, upperBound)
}

export function resolveMainWindowSizing(workAreaSize?: MainWindowWorkAreaSize) {
  if (!workAreaSize) {
    return {
      width: MAIN_WINDOW_PREFERRED_SIZE.width,
      height: MAIN_WINDOW_PREFERRED_SIZE.height,
      minWidth: MAIN_WINDOW_REGULAR_MIN_SIZE.width,
      minHeight: MAIN_WINDOW_REGULAR_MIN_SIZE.height
    }
  }

  const workAreaCap = {
    width: Math.floor(workAreaSize.width * MAIN_WINDOW_WORK_AREA_RATIO),
    height: Math.floor(workAreaSize.height * MAIN_WINDOW_WORK_AREA_RATIO)
  }
  const minWidth = resolveMinimumDimension({
    absoluteMin: MAIN_WINDOW_ABSOLUTE_MIN_SIZE.width,
    compactMin: MAIN_WINDOW_COMPACT_MIN_SIZE.width,
    regularMin: MAIN_WINDOW_REGULAR_MIN_SIZE.width,
    workArea: workAreaSize.width,
    workAreaCap: workAreaCap.width
  })
  const minHeight = resolveMinimumDimension({
    absoluteMin: MAIN_WINDOW_ABSOLUTE_MIN_SIZE.height,
    compactMin: MAIN_WINDOW_COMPACT_MIN_SIZE.height,
    regularMin: MAIN_WINDOW_REGULAR_MIN_SIZE.height,
    workArea: workAreaSize.height,
    workAreaCap: workAreaCap.height
  })

  return {
    width: Math.max(minWidth, Math.min(MAIN_WINDOW_PREFERRED_SIZE.width, workAreaCap.width)),
    height: Math.max(minHeight, Math.min(MAIN_WINDOW_PREFERRED_SIZE.height, workAreaCap.height)),
    minWidth,
    minHeight
  }
}

export function createMainWindowOptions(
  preload: string,
  workAreaSize?: MainWindowWorkAreaSize
): Electron.BrowserWindowConstructorOptions {
  const sizing = resolveMainWindowSizing(workAreaSize)

  return {
    width: sizing.width,
    height: sizing.height,
    minWidth: sizing.minWidth,
    minHeight: sizing.minHeight,
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
