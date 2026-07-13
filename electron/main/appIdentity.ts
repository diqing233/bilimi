import { APP_TITLE } from '../../src/shared/constants'
import { win32 } from 'node:path'

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
  options: { isPackaged: boolean }
) {
  if (options.isPackaged) {
    return
  }

  const currentPath = app.getPath('userData')
  const parent = win32.dirname(currentPath)
  const directory = win32.basename(currentPath)
  app.setPath('userData', win32.join(parent, `${directory}-dev`))
}
