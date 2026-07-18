import type { OldFavoriteSessionsState } from '../../src/shared/oldFavoriteSessions'

type QuitEvent = { preventDefault(): void }

type ShutdownSessionStore = {
  load: () => OldFavoriteSessionsState
  saveForShutdown: (state: OldFavoriteSessionsState) => void
}

export function prepareOldFavoriteStateForShutdown(options: {
  sessionStore: ShutdownSessionStore
  runtimeStore?: { prepareForShutdown: () => void }
  beginMutation: () => unknown
}): boolean {
  const state = options.sessionStore.load()
  const hasRunningSessionWork = state.batches?.some((batch) =>
    batch.status === 'active' && batch.segments?.some((segment) =>
      segment.status === 'running' || segment.task?.status === 'running'
    )
  ) ?? false
  if (!state.lease && !hasRunningSessionWork) return false
  options.sessionStore.saveForShutdown(state)
  options.runtimeStore?.prepareForShutdown()
  options.beginMutation()
  return true
}

export function shouldFlushOldFavoriteOnQuit(
  persistenceDirty: boolean,
  rendererDirty: boolean,
  openedSessionStore?: { load: () => {
    lease: unknown
    batches?: Array<{ status?: string; segments?: Array<{ status?: string; task?: { status?: string } }> }>
  } }
): boolean {
  if (persistenceDirty || rendererDirty) return true
  const state = openedSessionStore?.load()
  return Boolean(state?.lease || state?.batches?.some((batch) =>
    batch.status === 'active' && batch.segments?.some((segment) =>
      segment.status === 'running' || segment.task?.status === 'running'
    )
  ))
}

export function createOldFavoriteQuitBarrier(options: {
  shouldFlush?: () => boolean
  prepare: () => void
  flush: () => Promise<void>
  quit: () => void
  flushTimeoutMs?: number
}) {
  let flushing = false
  let allowQuit = false

  return (event: QuitEvent): void => {
    if (allowQuit) return
    if (options.shouldFlush && !options.shouldFlush()) return
    event.preventDefault()
    if (flushing) return
    flushing = true
    options.prepare()
    let settled = false
    const finishQuit = () => {
      if (settled) return
      settled = true
      allowQuit = true
      options.quit()
    }
    const timeout = setTimeout(finishQuit, options.flushTimeoutMs ?? 1_500)
    void options.flush().then(() => {
      clearTimeout(timeout)
      finishQuit()
    }).catch(() => {
      clearTimeout(timeout)
      finishQuit()
    })
  }
}
