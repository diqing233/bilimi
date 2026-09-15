type PreferenceSaveSchedulerOptions<TPreferences> = {
  delayMs: number
  save: (preferences: TPreferences) => Promise<TPreferences>
}

export type PreferenceSaveScheduler<TPreferences> = {
  flush: () => Promise<TPreferences | null>
  hasActiveSave: () => boolean
  schedule: (preferences: TPreferences) => void
  updatePending: (updater: (preferences: TPreferences) => TPreferences) => boolean
}

export type PreferencePatchScheduler<TPreferences> = {
  flush: () => Promise<Partial<TPreferences> | null>
  hasActiveSave: () => boolean
  schedule: (patch: Partial<TPreferences>) => void
  scheduleAndWait: (patch: Partial<TPreferences>) => Promise<Partial<TPreferences>>
}

export function createPreferencePatchScheduler<TPreferences>({
  delayMs,
  save
}: {
  delayMs: number
  save: (patch: Partial<TPreferences>) => Promise<Partial<TPreferences>>
}): PreferencePatchScheduler<TPreferences> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Partial<TPreferences> | null = null
  let inFlight: Promise<Partial<TPreferences> | null> | null = null
  let pendingWaiters: Array<{
    resolve: (saved: Partial<TPreferences>) => void
    reject: (error: unknown) => void
  }> = []

  function clearTimer() {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  async function drain(): Promise<Partial<TPreferences> | null> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      let lastSaved: Partial<TPreferences> | null = null
      try {
        while (pending) {
          const next = pending
          const waiters = pendingWaiters
          pending = null
          pendingWaiters = []
          try {
            lastSaved = await save(next)
            waiters.forEach(({ resolve }) => resolve(lastSaved!))
          } catch (error) {
            waiters.forEach(({ reject }) => reject(error))
            throw error
          }
        }
        return lastSaved
      } finally {
        inFlight = null
        if (pending) void drain().catch(() => {})
      }
    })()
    return inFlight
  }

  function schedule(patch: Partial<TPreferences>) {
    pending = { ...(pending ?? {}), ...patch }
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void drain().catch(() => {})
    }, delayMs)
  }

  function scheduleAndWait(patch: Partial<TPreferences>) {
    schedule(patch)
    return new Promise<Partial<TPreferences>>((resolve, reject) => {
      pendingWaiters.push({ resolve, reject })
    })
  }

  async function flush() {
    clearTimer()
    return drain()
  }

  return {
    flush,
    hasActiveSave: () => Boolean(timer || pending || inFlight),
    schedule,
    scheduleAndWait
  }
}

export function createPreferenceSaveScheduler<TPreferences>({
  delayMs,
  save
}: PreferenceSaveSchedulerOptions<TPreferences>): PreferenceSaveScheduler<TPreferences> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let inFlight: Promise<TPreferences | null> | null = null
  let pending: TPreferences | null = null
  let lastSaved: TPreferences | null = null

  function clearTimer() {
    if (timer === null) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  async function drain(): Promise<TPreferences | null> {
    if (inFlight) {
      return inFlight
    }

    inFlight = (async () => {
      try {
        while (pending) {
          const next = pending
          pending = null
          lastSaved = await save(next)
        }

        return lastSaved
      } finally {
        inFlight = null
        if (pending) {
          void drain()
        }
      }
    })()

    return inFlight
  }

  function schedule(preferences: TPreferences) {
    pending = preferences
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      void drain()
    }, delayMs)
  }

  function updatePending(updater: (preferences: TPreferences) => TPreferences) {
    if (!pending) {
      return false
    }

    pending = updater(pending)
    return true
  }

  function hasActiveSave() {
    return Boolean(timer || inFlight || pending)
  }

  async function flush() {
    clearTimer()
    return drain()
  }

  return { flush, hasActiveSave, schedule, updatePending }
}
