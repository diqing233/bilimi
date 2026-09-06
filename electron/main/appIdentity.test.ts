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
    expect(appendSwitch).toHaveBeenCalledWith('disable-http-cache')
  })

  it('does not pass any development runtime switch to packaged builds', () => {
    const appendSwitch = vi.fn()

    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, { isPackaged: true, deviceScaleFactor: '1.5', reducedMotion: true })

    expect(appendSwitch).not.toHaveBeenCalled()
  })

  it('does not pass visual test runtime switches for unknown development scale values', () => {
    const appendSwitch = vi.fn()

    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, { isPackaged: false, deviceScaleFactor: '2', reducedMotion: false })

    expect(appendSwitch).toHaveBeenCalledTimes(1)
    expect(appendSwitch).toHaveBeenCalledWith('disable-http-cache')
  })

  it('disables only the development HTTP cache even without visual test switches', () => {
    const appendSwitch = vi.fn()

    configureDevelopmentRuntimeSwitches({ commandLine: { appendSwitch } }, { isPackaged: false })

    expect(appendSwitch).toHaveBeenCalledWith('disable-http-cache')
  })
})
