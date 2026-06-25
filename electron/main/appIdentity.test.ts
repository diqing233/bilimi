import { describe, expect, it, vi } from 'vitest'
import { configureAppIdentity, WINDOWS_APP_USER_MODEL_ID } from './appIdentity'

describe('configureAppIdentity', () => {
  it('sets the Bilimi product name and Windows app user model id', () => {
    const app = {
      setAppUserModelId: vi.fn(),
      setName: vi.fn()
    }

    configureAppIdentity(app)

    expect(app.setName).toHaveBeenCalledWith('Bilimi')
    expect(app.setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID)
  })
})
