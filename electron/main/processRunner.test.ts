import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createProcessRunner, ProcessExecutionError } from './processRunner'

function createChild(pid = 1234) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  child.pid = pid
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

describe('process runner', () => {
  it('collects process output and preserves non-zero exit codes', async () => {
    const child = createChild()
    const spawn = vi.fn().mockReturnValue(child)
    const runProcess = createProcessRunner({ spawn, killProcessTree: vi.fn() })

    const promise = runProcess('tool.exe', ['--version'])
    child.stdout.emit('data', 'stdout text')
    child.stderr.emit('data', 'stderr text')
    child.emit('close', 7)

    await expect(promise).resolves.toEqual({
      stdout: 'stdout text',
      stderr: 'stderr text',
      exitCode: 7
    })
  })

  it('terminates the process tree and classifies a timed out process', async () => {
    vi.useFakeTimers()
    const child = createChild()
    const killProcessTree = vi.fn().mockResolvedValue(undefined)
    const runProcess = createProcessRunner({
      spawn: vi.fn().mockReturnValue(child),
      killProcessTree
    })

    const assertion = expect(runProcess('tool.exe', [], { timeoutMs: 50 })).rejects.toEqual(
      expect.objectContaining<Partial<ProcessExecutionError>>({ code: 'timeout' })
    )
    await vi.advanceTimersByTimeAsync(50)

    await assertion
    expect(killProcessTree).toHaveBeenCalledWith(1234)
    vi.useRealTimers()
  })

  it('terminates the process tree and classifies an aborted process', async () => {
    const child = createChild()
    const killProcessTree = vi.fn().mockResolvedValue(undefined)
    const runProcess = createProcessRunner({
      spawn: vi.fn().mockReturnValue(child),
      killProcessTree
    })
    const controller = new AbortController()

    const promise = runProcess('tool.exe', [], { signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<ProcessExecutionError>>({ code: 'canceled' })
    )
    expect(killProcessTree).toHaveBeenCalledWith(1234)
  })

  it('classifies spawn failures without trying to kill a missing process', async () => {
    const child = createChild(0)
    const killProcessTree = vi.fn()
    const runProcess = createProcessRunner({
      spawn: vi.fn().mockReturnValue(child),
      killProcessTree
    })

    const promise = runProcess('missing.exe', [])
    child.emit('error', new Error('ENOENT'))

    await expect(promise).rejects.toEqual(
      expect.objectContaining<Partial<ProcessExecutionError>>({ code: 'spawn-failed' })
    )
    expect(killProcessTree).not.toHaveBeenCalled()
  })
})
