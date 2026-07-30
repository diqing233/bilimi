import { APP_TITLE } from '../../src/shared/constants'
import { isAbsolute, win32 } from 'node:path'

type AppIdentityTarget = {
  setAppUserModelId: (id: string) => void
  setName: (name: string) => void
}

export const WINDOWS_APP_USER_MODEL_ID = 'cn.diqing.bilimi'

export function configureAppIdentity(app: AppIdentityTarget) {
  app.setName(APP_TITLE)
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}

type UserDataTarget = {
  getPath: (name: 'userData') => string
  setPath: (name: 'userData', path: string) => void
}

export function configureDevelopmentUserData(
  app: UserDataTarget,
  options: { isPackaged: boolean; userDataOverride?: string }
) {
  if (options.isPackaged) {
    return
  }

  const override = options.userDataOverride?.trim()
  if (override && isAbsolute(override)) {
    app.setPath('userData', override)
    return
  }

  const currentPath = app.getPath('userData')
  const parent = win32.dirname(currentPath)
  const directory = win32.basename(currentPath)
  app.setPath('userData', win32.join(parent, `${directory}-dev`))
}

type RuntimeSwitchTarget = {
  commandLine: { appendSwitch: (name: string, value?: string) => void }
}

/** Keeps manual accessibility checks isolated from the production launch path. */
export function configureDevelopmentRuntimeSwitches(
  app: RuntimeSwitchTarget,
  options: { isPackaged: boolean; deviceScaleFactor?: string; reducedMotion?: boolean }
) {
  if (options.isPackaged) return
  if (options.deviceScaleFactor === '1' || options.deviceScaleFactor === '1.25' || options.deviceScaleFactor === '1.5') {
    app.commandLine.appendSwitch('force-device-scale-factor', options.deviceScaleFactor)
  }
  if (options.reducedMotion) app.commandLine.appendSwitch('force-prefers-reduced-motion', 'reduce')
}
