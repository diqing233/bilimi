export type MainRendererCrashRecoveryAction = 'recreate' | 'stop'

export function createMainRendererCrashRecovery<TContext = void>({
  recreate,
  stop,
  windowMs = 10_000
}: {
  recreate: (context: TContext) => void
  stop: (context: TContext) => void
  windowMs?: number
}) {
  let lastRecoveryAt: number | undefined

  return {
    handleCrash(context: TContext, now = Date.now()): MainRendererCrashRecoveryAction {
      if (lastRecoveryAt !== undefined && now - lastRecoveryAt <= windowMs) {
        stop(context)
        return 'stop'
      }

      lastRecoveryAt = now
      recreate(context)
      return 'recreate'
    },
    reset(): void {
      lastRecoveryAt = undefined
    }
  }
}
