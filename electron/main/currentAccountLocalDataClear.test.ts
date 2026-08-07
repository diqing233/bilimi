import { describe, expect, it, vi } from 'vitest'
import { clearCurrentAccountLocalData } from './currentAccountLocalDataClear'

describe('clearCurrentAccountLocalData', () => {
  it('fences work, signs out, deletes local data, refreshes guest pages, then resumes services', async () => {
    const events: string[] = []
    await clearCurrentAccountLocalData('100', async () => { events.push('delete-local') }, {
      stopTranscription: async () => { events.push('stop-transcription') },
      stopScan: async () => { events.push('stop-scan') },
      stopDeepSeek: async () => { events.push('stop-deepseek') },
      runRemoteMaintenance: async (operation) => { events.push('remote-fence'); await operation() },
      flushRepository: async () => { events.push('flush') },
      clearLoginSession: async () => { events.push('clear-session') },
      clearRuntimeAccount: () => { events.push('clear-runtime') },
      refreshGuestPages: async () => { events.push('refresh-guest') },
      notifyLocalDataReset: () => { events.push('local-reset') },
      notifyAccountChanged: () => { events.push('account-changed') },
      resumeServices: () => { events.push('resume') }
    })

    expect(events).toEqual([
      'stop-transcription', 'stop-scan', 'stop-deepseek', 'remote-fence', 'flush',
      'clear-session', 'delete-local', 'clear-runtime', 'refresh-guest',
      'local-reset', 'account-changed', 'resume'
    ])
  })

  it('resumes services and publishes sign-out when deletion fails after cookies were cleared', async () => {
    const refreshGuestPages = vi.fn()
    const notifyAccountChanged = vi.fn()
    const notifyLocalDataReset = vi.fn()
    const resumeServices = vi.fn()
    await expect(clearCurrentAccountLocalData('100', async () => { throw new Error('delete failed') }, {
      stopTranscription: vi.fn(), stopScan: vi.fn(), stopDeepSeek: vi.fn(),
      runRemoteMaintenance: async (operation) => operation(), flushRepository: vi.fn(),
      clearLoginSession: vi.fn(), clearRuntimeAccount: vi.fn(), refreshGuestPages,
      notifyLocalDataReset, notifyAccountChanged, resumeServices
    })).rejects.toThrow('delete failed')

    expect(refreshGuestPages).toHaveBeenCalledTimes(1)
    expect(notifyAccountChanged).toHaveBeenCalledTimes(1)
    expect(notifyLocalDataReset).not.toHaveBeenCalled()
    expect(resumeServices).toHaveBeenCalledTimes(1)
  })
})
