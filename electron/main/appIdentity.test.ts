import { describe, expect, it, vi } from 'vitest'
import { configureAppIdentity, configureDevelopmentUserData, WINDOWS_APP_USER_MODEL_ID } from './appIdentity'

describe('configureAppIdentity', () => {
  it('sets the bilimi product name and Windows app user model id', () => {
    const app = {
      setAppUserModelId: vi.fn(),
      setName: vi.fn()
    }

    configureAppIdentity(app)

    expect(app.setName).toHaveBeenCalledWith('bilimi')
    expect(app.setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID)
  })
})

describe('configureDevelopmentUserData', () => {
  it('uses a separate directory for development builds', () => {
    const app = { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/bilimi'), setPath: vi.fn() }

    configureDevelopmentUserData(app, { isPackaged: false })

    expect(app.setPath).toHaveBeenCalledWith('userData', 'C:\\Users\\test\\AppData\\Roaming\\bilimi-dev')
  })

  it('keeps packaged builds on the normal user data directory', () => {
    const app = { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/bilimi'), setPath: vi.fn() }

    configureDevelopmentUserData(app, { isPackaged: true })

    expect(app.setPath).not.toHaveBeenCalled()
  })
})
