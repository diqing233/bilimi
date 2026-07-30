import { describe, expect, it, vi } from 'vitest'
import { configureAppIdentity, configureDevelopmentRuntimeSwitches, configureDevelopmentUserData, WINDOWS_APP_USER_MODEL_ID } from './appIdentity'

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
  it('uses an explicit absolute development override without changing packaged user data', () => {
    const app = { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/bilimi'), setPath: vi.fn() }

    configureDevelopmentUserData(app, { isPackaged: false, userDataOverride: 'C:/temp/bilimi-e2e-profile' })

    expect(app.setPath).toHaveBeenCalledWith('userData', 'C:/temp/bilimi-e2e-profile')
  })

  it('uses a separate directory for development builds', () => {
    const app = { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/bilimi'), setPath: vi.fn() }

    configureDevelopmentUserData(app, { isPackaged: false })

    expect(app.setPath).toHaveBeenCalledWith('userData', 'C:\\Users\\test\\AppData\\Roaming\\bilimi-dev')
  })

  it('keeps packaged builds on the normal user data directory even with an override', () => {
    const app = { getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/bilimi'), setPath: vi.fn() }

    configureDevelopmentUserData(app, { isPackaged: true, userDataOverride: 'C:/temp/bilimi-e2e-profile' })

    expect(app.setPath).not.toHaveBeenCalled()
  })
})

describe('configureDevelopmentRuntimeSwitches', () => {
  it('limits isolated development scale and reduced-motion switches to known safe values', () => {
    const appendSwitch = vi.fn()

    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, {
      isPackaged: false,
      deviceScaleFactor: '1.5',
      reducedMotion: true
    })

    expect(appendSwitch).toHaveBeenCalledWith('force-device-scale-factor', '1.5')
    expect(appendSwitch).toHaveBeenCalledWith('force-prefers-reduced-motion', 'reduce')
  })

  it('does not pass test runtime switches to packaged builds or unknown scale values', () => {
    const appendSwitch = vi.fn()

    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, { isPackaged: true, deviceScaleFactor: '1.5', reducedMotion: true })
    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, { isPackaged: false, deviceScaleFactor: '2', reducedMotion: false })

    expect(appendSwitch).not.toHaveBeenCalled()
  })
})
