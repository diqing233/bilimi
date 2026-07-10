import { execFile, spawn as nodeSpawn } from 'node:child_process'

export type ProcessResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type ProcessFailureCode = 'canceled' | 'timeout' | 'spawn-failed'

export class ProcessExecutionError extends Error {
  constructor(
    public readonly code: ProcessFailureCode,
    message: string
  ) {
    super(message)
    this.name = 'ProcessExecutionError'
  }
}

export type ProcessRunOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

type ProcessChild = ReturnType<typeof nodeSpawn>
type SpawnProcess = (command: string, args: string[], options: Parameters<typeof nodeSpawn>[2]) => ProcessChild
type KillProcessTree = (pid: number) => Promise<void>

export type RunProcess = (
  command: string,
  args: string[],
  options?: ProcessRunOptions
) => Promise<ProcessResult>

export function killProcessTree(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // The process may already have exited.
      }
    }
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

export function createProcessRunner({
  spawn = nodeSpawn as SpawnProcess,
  killProcessTree: terminateTree = killProcessTree
}: {
  spawn?: SpawnProcess
  killProcessTree?: KillProcessTree
} = {}): RunProcess {
  return (command, args, options = {}) =>
    new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new ProcessExecutionError('canceled', `Process canceled before start: ${command}`))
        return
      }

      const child = spawn(command, args, {
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8'
        },
        windowsHide: true,
        detached: process.platform !== 'win32'
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let timeout: NodeJS.Timeout | undefined

      const cleanup = () => {
        if (timeout) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', handleAbort)
      }

      const settleFailure = async (code: ProcessFailureCode, message: string) => {
        if (settled) return
        settled = true
        cleanup()
        if (child.pid) await terminateTree(child.pid)
        reject(new ProcessExecutionError(code, message))
      }

      const handleAbort = () => {
        void settleFailure('canceled', `Process canceled: ${command}`)
      }

      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new ProcessExecutionError('spawn-failed', error.message))
      })
      child.on('close', (exitCode) => {
        if (settled) return
        settled = true
        cleanup()
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 })
      })

      options.signal?.addEventListener('abort', handleAbort, { once: true })
      if (options.timeoutMs && options.timeoutMs > 0) {
        timeout = setTimeout(() => {
          void settleFailure('timeout', `Process timed out after ${options.timeoutMs}ms: ${command}`)
        }, options.timeoutMs)
      }
    })
}

export const runProcess = createProcessRunner()
