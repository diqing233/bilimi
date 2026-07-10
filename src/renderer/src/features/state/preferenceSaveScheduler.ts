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
