import { describe, expect, it, vi } from 'vitest'
import { OldFavoriteBackgroundRuntime } from './oldFavoriteBackgroundRuntime'

function createWebContents(id: number) {
  return {
    id,
    isDestroyed: vi.fn(() => false),
    setBackgroundThrottling: vi.fn()
  }
}

describe('OldFavoriteBackgroundRuntime', () => {
  it('keeps the main renderer and actual execution webview unthrottled while running', () => {
    const main = createWebContents(1)
    const execution = createWebContents(2)
    const runtime = new OldFavoriteBackgroundRuntime({
      getMainWebContents: () => main,
      getWebContentsById: (id) => id === execution.id ? execution : undefined
    })

    runtime.setRunning(true)
    runtime.setExecutionTarget(execution.id)

    expect(main.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
    expect(execution.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  })

  it('restores a previous execution webview before switching targets', () => {
    const main = createWebContents(1)
    const first = createWebContents(2)
    const second = createWebContents(3)
    const runtime = new OldFavoriteBackgroundRuntime({
      getMainWebContents: () => main,
      getWebContentsById: (id) => [first, second].find((contents) => contents.id === id)
    })

    runtime.setRunning(true)
    runtime.setExecutionTarget(first.id)
    runtime.setExecutionTarget(second.id)

    expect(first.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
    expect(second.setBackgroundThrottling).toHaveBeenLastCalledWith(false)
  })

  it.each(['paused', 'completed', 'failed', 'risk-stopped'])(
    'restores default throttling when execution reaches %s',
    () => {
      const main = createWebContents(1)
      const execution = createWebContents(2)
      const runtime = new OldFavoriteBackgroundRuntime({
        getMainWebContents: () => main,
        getWebContentsById: () => execution
      })
      runtime.setRunning(true)
      runtime.setExecutionTarget(execution.id)

      runtime.setRunning(false)

      expect(main.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
      expect(execution.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
      expect(runtime.snapshot()).toEqual({ running: false, executionTargetId: null })
    }
  )

  it('does not touch destroyed web contents while restoring', () => {
    const main = createWebContents(1)
    const execution = createWebContents(2)
    const runtime = new OldFavoriteBackgroundRuntime({
      getMainWebContents: () => main,
      getWebContentsById: () => execution
    })
    runtime.setRunning(true)
    runtime.setExecutionTarget(execution.id)
    main.isDestroyed.mockReturnValue(true)
    execution.isDestroyed.mockReturnValue(true)

    runtime.setRunning(false)

    expect(main.setBackgroundThrottling).toHaveBeenCalledTimes(1)
    expect(execution.setBackgroundThrottling).toHaveBeenCalledTimes(1)
  })
})
