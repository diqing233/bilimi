import { APP_TITLE } from '../../src/shared/constants'

type AppIdentityTarget = {
  setAppUserModelId: (id: string) => void
  setName: (name: string) => void
}

export const WINDOWS_APP_USER_MODEL_ID = 'com.bilimi.desktop'

export function configureAppIdentity(app: AppIdentityTarget) {
  app.setName(APP_TITLE)
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)
}
