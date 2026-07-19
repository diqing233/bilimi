export type OldFavoriteAccountResetOperations<SessionState, RuntimeState> = {
  loadSessions: () => SessionState
  beginReset?: (accountMid: string) => Promise<void> | void
  abortReset?: (accountMid: string) => Promise<void> | void
  resetRuntime: (accountMid: string) => RuntimeState
  restoreRuntime: (accountMid: string, state: RuntimeState) => void
  resetSessions: (accountMid: string) => SessionState
  restoreSessions: (state: SessionState) => void
  flushSessions: () => Promise<void>
  resetWorkspace: (accountMid: string) => Promise<void>
  completeReset?: (accountMid: string) => Promise<void> | void
  onMutation?: { begin: () => unknown; finish: (mutation: unknown) => void }
}

export async function resetOldFavoriteAccount<SessionState, RuntimeState>(
  operations: OldFavoriteAccountResetOperations<SessionState, RuntimeState>,
  accountMid: string
): Promise<SessionState> {
  const previousSessions = operations.loadSessions()
  const mutation = operations.onMutation?.begin()
  let previousRuntime!: RuntimeState
  let runtimeCaptured = false
  let sessionsReset = false
  let resetStarted = false
  try {
    await operations.beginReset?.(accountMid)
    resetStarted = true
    previousRuntime = operations.resetRuntime(accountMid)
    runtimeCaptured = true
    operations.resetSessions(accountMid)
    sessionsReset = true
    await operations.flushSessions()
    await operations.resetWorkspace(accountMid)
  } catch (error) {
    if (resetStarted) await Promise.resolve(operations.abortReset?.(accountMid)).catch(() => undefined)
    if (sessionsReset) {
      operations.restoreSessions(previousSessions)
      await operations.flushSessions().catch(() => undefined)
    }
    if (runtimeCaptured) operations.restoreRuntime(accountMid, previousRuntime)
    throw error
  }
  await Promise.resolve(operations.completeReset?.(accountMid)).catch(() => undefined)
  if (mutation !== undefined) operations.onMutation?.finish(mutation)
  return operations.loadSessions()
}
