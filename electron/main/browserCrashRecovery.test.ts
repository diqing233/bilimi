import { describe, expect, it } from 'vitest'
import { createBrowserCrashRecoveryTracker } from './browserCrashRecovery'

describe('browser crash recovery', () => {
  it('reloads once, then stops automatic reload loops until reset', () => {
    const tracker = createBrowserCrashRecoveryTracker(10_000)

    expect(tracker.recordCrash('tab-1', 1_000)).toEqual({ action: 'reload' })
    expect(tracker.recordCrash('tab-1', 2_000)).toEqual({ action: 'show-error' })
    tracker.reset('tab-1')
    expect(tracker.recordCrash('tab-1', 3_000)).toEqual({ action: 'reload' })
  })

  it('allows recovery again after the crash window expires', () => {
    const tracker = createBrowserCrashRecoveryTracker(1_000)

    expect(tracker.recordCrash('tab-1', 1_000)).toEqual({ action: 'reload' })
    expect(tracker.recordCrash('tab-1', 3_000)).toEqual({ action: 'reload' })
  })
})
