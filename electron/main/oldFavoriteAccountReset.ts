export type OldFavoriteAccountResetOperations<SessionState, RuntimeState> = {
  loadSessions: () => SessionState
  resetRuntime: (accountMid: string) => RuntimeState
  restoreRuntime: (accountMid: string, state: RuntimeState) => void
  resetSessions: (accountMid: string) => SessionState
  restoreSessions: (state: SessionState) => void
  flushSessions: () => Promise<void>
  resetWorkspace: (accountMid: string) => Promise<void>
  onMutation?: { begin: () => unknown; finish: (mutation: unknown) => void }
}

export async function resetOldFavoriteAccount<SessionState, RuntimeState>(
  operations: OldFavoriteAccountResetOperations<SessionState, RuntimeState>,
  accountMid: string
): Promise<SessionState> {
  const previousSessions = operations.loadSessions()
  const mutation = operations.onMutation?.begin()
  let previousRuntime: RuntimeState
  try {
    previousRuntime = operations.resetRuntime(accountMid)
  } catch (error) {
    throw error
  }
  let sessionsReset = false
  try {
    operations.resetSessions(accountMid)
    sessionsReset = true
    await operations.flushSessions()
    await operations.resetWorkspace(accountMid)
    if (mutation !== undefined) operations.onMutation?.finish(mutation)
    return operations.loadSessions()
  } catch (error) {
    if (sessionsReset) {
      operations.restoreSessions(previousSessions)
      await operations.flushSessions().catch(() => undefined)
    }
    operations.restoreRuntime(accountMid, previousRuntime)
    throw error
  }
}
