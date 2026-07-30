import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { TranscriptSegment } from '../../src/shared/types'
import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

type FasterWhisperSegment = {
  start?: number
  end?: number
  text?: string
}

type FasterWhisperOutput = {
  segments?: FasterWhisperSegment[]
}

export type FasterWhisperFailureKind = 'cuda-initialization' | 'cuda-oom'

export class FasterWhisperRuntimeError extends Error {
  readonly kind: FasterWhisperFailureKind

  constructor(kind: FasterWhisperFailureKind, message: string) {
    super(message)
    this.name = 'FasterWhisperRuntimeError'
    this.kind = kind
  }
}

type HelperSessionConfig = {
  helperPath: string
  model: string
  device: string
  computeType: string
  vadFilter: boolean
}

type FasterWhisperHelperSession = {
  transcribe: (audioPath: string, signal?: AbortSignal) => Promise<FasterWhisperOutput>
  close: () => void
  closed: Promise<void>
}

export type FasterWhisperHelperSessionPool = {
  transcribe: (config: HelperSessionConfig, audioPath: string, signal?: AbortSignal) => Promise<FasterWhisperOutput>
  dispose: () => void
  disposeGpu: () => void
}

type FasterWhisperArgsInput = {
  scriptPath: string
  audioPath: string
  model: string
  device?: string
  computeType?: string
  vadFilter?: boolean
}

type TranscribeInput = {
  path: string
  offsetSeconds: number
  model?: string
  helperPath?: string
  device?: string
  computeType?: string
  pythonCommand?: string
  pythonCandidates?: PythonCandidate[]
  scriptPath?: string
  runProcess?: RunProcess
  helperSessionPool?: FasterWhisperHelperSessionPool
  signal?: AbortSignal
}

type PythonCandidate = {
  command: string
  argsPrefix: string[]
}

const DEFAULT_MODEL = 'small'
const DEFAULT_DEVICE = 'cpu'
const DEFAULT_COMPUTE_TYPE = 'int8'
const DEFAULT_HELPER_IDLE_TIMEOUT_MS = 30_000

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function defaultScriptPath(): string {
  return normalizePath(join(process.cwd(), 'tools', 'transcribe_faster_whisper.py'))
}

export function createPythonCandidates({
  envPythonPath = process.env.BILIMI_PYTHON_PATH,
  platform = process.platform
}: {
  envPythonPath?: string
  platform?: NodeJS.Platform
} = {}): PythonCandidate[] {
  const candidates: PythonCandidate[] = []
  const trimmedEnvPath = envPythonPath?.trim()

  if (trimmedEnvPath) {
    candidates.push({ command: trimmedEnvPath, argsPrefix: [] })
  }

  candidates.push({ command: 'python', argsPrefix: [] })
  candidates.push({ command: 'python3', argsPrefix: [] })

  if (platform === 'win32') {
    candidates.push({ command: 'py', argsPrefix: ['-3'] })
  }

  return candidates
}

export function classifyFasterWhisperRuntimeError(
  error: unknown,
  device?: string,
  phase: 'startup' | 'inference' = 'startup'
): FasterWhisperRuntimeError | undefined {
  if (error instanceof FasterWhisperRuntimeError) return error
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  if (device === 'cuda' && /(out of memory|cuda.*\boom\b|cuda_error_out_of_memory|cudnn_status_alloc_failed)/u.test(normalized)) {
    return new FasterWhisperRuntimeError('cuda-oom', 'NVIDIA GPU ran out of memory during transcription.')
  }
  if (phase === 'startup' && device === 'cuda' && /cuda|cudnn|cublas/u.test(normalized) && /(initiali[sz]|driver|runtime|not available|not compiled|invalid device|failed|not found|cannot load|could not load|missing)/u.test(normalized)) {
    return new FasterWhisperRuntimeError('cuda-initialization', 'NVIDIA GPU initialization failed before transcription.')
  }
  return undefined
}

function readableFasterWhisperError(result: { stderr: string; stdout: string }, device?: string): Error {
  const output = `${result.stderr}\n${result.stdout}`
  const classified = classifyFasterWhisperRuntimeError(output, device)
  if (classified) return classified

  if (output.includes('ModuleNotFoundError') && output.includes('faster_whisper')) {
    return new Error('faster-whisper is not installed. Run: python -m pip install faster-whisper')
  }

  if (output.includes('BILIMI_FASTER_WHISPER_IMPORT_ERROR')) {
    return new Error('faster-whisper is not installed. Run: python -m pip install faster-whisper')
  }

  if (output.includes('BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR')) {
    return new Error('Local faster-whisper transcription failed. Check model download, network, or audio format.')
  }

  return new Error(cleanText(result.stderr || result.stdout) || 'Local faster-whisper transcription failed.')
}

export function mapFasterWhisperOutputToSegments(
  payload: FasterWhisperOutput,
  offsetSeconds: number
): TranscriptSegment[] {
  return (payload.segments ?? [])
    .map((segment) => ({
      start: typeof segment.start === 'number' ? segment.start + offsetSeconds : null,
      end: typeof segment.end === 'number' ? segment.end + offsetSeconds : null,
      text: cleanText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function buildFasterWhisperArgs({
  scriptPath,
  audioPath,
  model,
  device = DEFAULT_DEVICE,
  computeType = DEFAULT_COMPUTE_TYPE,
  vadFilter = true
}: FasterWhisperArgsInput): string[] {
  return [
    scriptPath,
    '--audio',
    audioPath,
    '--model',
    model,
    '--device',
    device,
    '--compute-type',
    computeType,
    '--vad-filter',
    String(vadFilter)
  ]
}

function buildFasterWhisperHelperArgs(input: Omit<FasterWhisperArgsInput, 'scriptPath'>): string[] {
  return buildFasterWhisperArgs({ ...input, scriptPath: '' }).slice(1)
}

function createAbortError(): Error {
  const error = new Error('Process canceled.')
  error.name = 'AbortError'
  return error
}

function helperSessionKey(config: HelperSessionConfig): string {
  return [config.helperPath, config.model, config.device, config.computeType, String(config.vadFilter)].join('\u0000')
}

function createNodeHelperSession(config: HelperSessionConfig): FasterWhisperHelperSession {
  const child: ChildProcessWithoutNullStreams = spawn(config.helperPath, [
    '--serve',
    '--model', config.model,
    '--device', config.device,
    '--compute-type', config.computeType,
    '--vad-filter', String(config.vadFilter)
  ], {
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: 'pipe',
    windowsHide: true
  })
  const lines = createInterface({ input: child.stdout })
  let stderr = ''
  let ready = false
  let requestIndex = 0
  let closed = false
  let resolveClosed: (() => void) | undefined
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve })
  let pending: {
    id: string
    resolve: (output: FasterWhisperOutput) => void
    reject: (error: Error) => void
    removeAbortListener: () => void
  } | undefined

  function settlePending(error?: Error, output?: FasterWhisperOutput) {
    const current = pending
    pending = undefined
    if (!current) return
    current.removeAbortListener()
    if (error) current.reject(error)
    else current.resolve(output ?? {})
  }

  function close(error?: Error) {
    if (closed) return
    closed = true
    lines.close()
    settlePending(error ?? (!ready ? classifyFasterWhisperRuntimeError(stderr, config.device, 'startup') : undefined) ?? new Error('faster-whisper helper session closed.'))
    child.kill()
    resolveClosed?.()
  }

  lines.on('line', (line) => {
    let response: { id?: string; ready?: boolean; segments?: FasterWhisperSegment[]; error?: string }
    try {
      response = JSON.parse(line) as typeof response
    } catch {
      return
    }
    if (response.ready) {
      ready = true
      return
    }
    if (!pending || response.id !== pending.id) return
    if (response.error) settlePending(classifyFasterWhisperRuntimeError(response.error, config.device, 'inference') ?? new Error(response.error))
    else settlePending(undefined, { segments: response.segments })
  })
  child.on('error', (error) => close(error))
  child.on('close', () => close())
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  return {
    closed: closedPromise,
    close: () => close(),
    transcribe: (audioPath, signal) => new Promise<FasterWhisperOutput>((resolve, reject) => {
      if (closed) {
        reject(new Error('faster-whisper helper session is unavailable.'))
        return
      }
      if (pending) {
        reject(new Error('faster-whisper helper received concurrent requests.'))
        return
      }
      if (signal?.aborted) {
        close(createAbortError())
        reject(createAbortError())
        return
      }
      requestIndex += 1
      const id = String(requestIndex)
      const abort = () => close(createAbortError())
      signal?.addEventListener('abort', abort, { once: true })
      pending = {
        id,
        resolve,
        reject,
        removeAbortListener: () => signal?.removeEventListener('abort', abort)
      }
      try {
        child.stdin.write(`${JSON.stringify({ id, audio: audioPath })}\n`)
      } catch (error) {
        settlePending(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export function createFasterWhisperHelperSessionPool({
  startSession = createNodeHelperSession,
  idleTimeoutMs = DEFAULT_HELPER_IDLE_TIMEOUT_MS
}: {
  startSession?: (config: HelperSessionConfig) => FasterWhisperHelperSession
  idleTimeoutMs?: number
} = {}): FasterWhisperHelperSessionPool {
  const sessions = new Map<string, { config: HelperSessionConfig; session: FasterWhisperHelperSession; idleTimer?: ReturnType<typeof setTimeout> }>()

  function remove(key: string, session: FasterWhisperHelperSession) {
    const current = sessions.get(key)
    if (current?.session !== session) return
    if (current.idleTimer) clearTimeout(current.idleTimer)
    sessions.delete(key)
  }

  function acquire(config: HelperSessionConfig) {
    const key = helperSessionKey(config)
    let current = sessions.get(key)
    if (!current) {
      const session = startSession(config)
      current = { config, session }
      sessions.set(key, current)
      void session.closed.then(() => remove(key, session), () => remove(key, session))
    }
    if (current.idleTimer) {
      clearTimeout(current.idleTimer)
      current.idleTimer = undefined
    }
    return { key, current }
  }

  function scheduleIdleClose(key: string, current: { session: FasterWhisperHelperSession; idleTimer?: ReturnType<typeof setTimeout> }) {
    if (idleTimeoutMs <= 0) return
    current.idleTimer = setTimeout(() => {
      current.session.close()
      remove(key, current.session)
    }, idleTimeoutMs)
  }

  return {
    async transcribe(config, audioPath, signal) {
      const { key, current } = acquire(config)
      let aborted = false
      const abort = () => {
        aborted = true
        current.session.close()
        remove(key, current.session)
      }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        if (signal?.aborted) throw createAbortError()
        const output = await current.session.transcribe(audioPath, signal)
        if (aborted || signal?.aborted) throw createAbortError()
        return output
      } finally {
        signal?.removeEventListener('abort', abort)
        if (!aborted) scheduleIdleClose(key, current)
      }
    },
    dispose() {
      for (const { session, idleTimer } of sessions.values()) {
        if (idleTimer) clearTimeout(idleTimer)
        session.close()
      }
      sessions.clear()
    },
    disposeGpu() {
      for (const [key, current] of sessions) {
        if (current.config.device !== 'cuda') continue
        if (current.idleTimer) clearTimeout(current.idleTimer)
        current.session.close()
        sessions.delete(key)
      }
    }
  }
}

const defaultHelperSessionPool = createFasterWhisperHelperSessionPool()
let releasePreviousGpuTurn: Promise<void> = Promise.resolve()

async function withExclusiveGpuTurn<T>(work: () => Promise<T>): Promise<T> {
  const previous = releasePreviousGpuTurn
  let release!: () => void
  releasePreviousGpuTurn = new Promise<void>((resolve) => { release = resolve })
  await previous
  try {
    return await work()
  } finally {
    release()
  }
}

export function disposeDefaultFasterWhisperHelperSessions(): void {
  defaultHelperSessionPool.dispose()
}

/** GPU work is job-bound: release its helper and VRAM at job completion. */
export function disposeDefaultFasterWhisperGpuSessions(): void {
  defaultHelperSessionPool.disposeGpu()
}

export async function transcribeAudioSegmentWithFasterWhisper({
  path,
  offsetSeconds,
  model = DEFAULT_MODEL,
  helperPath,
  device,
  computeType,
  pythonCommand,
  pythonCandidates = pythonCommand
    ? [{ command: pythonCommand, argsPrefix: [] }]
    : createPythonCandidates(),
  scriptPath = defaultScriptPath(),
  runProcess = defaultRunProcess,
  helperSessionPool,
  signal
}: TranscribeInput): Promise<TranscriptSegment[]> {
  let result: Awaited<ReturnType<RunProcess>> | null = null
  let lastStartError: unknown = null
  // The helper never auto-selects CUDA: only the verified runtime policy may opt in.
  const runtimeDevice = device ?? DEFAULT_DEVICE
  const runtimeComputeType = computeType ?? DEFAULT_COMPUTE_TYPE

  if (helperPath && (helperSessionPool || runProcess === defaultRunProcess)) {
    const transcribe = () => (helperSessionPool ?? defaultHelperSessionPool).transcribe({
      helperPath,
      model,
      device: runtimeDevice,
      computeType: runtimeComputeType,
      vadFilter: true
    }, path, signal)
    // Queue and immediate transcription share this process-level CUDA lease.
    const output = runtimeDevice === 'cuda' ? await withExclusiveGpuTurn(transcribe) : await transcribe()
    return mapFasterWhisperOutputToSegments(output, offsetSeconds)
  }

  if (helperPath) {
    result = await runProcess(helperPath, buildFasterWhisperHelperArgs({
      audioPath: path,
      model,
      device: runtimeDevice,
      computeType: runtimeComputeType
    }), { signal })
  } else {
    for (const candidate of pythonCandidates) {
      try {
        result = await runProcess(
          candidate.command,
          [
            ...candidate.argsPrefix,
            ...buildFasterWhisperArgs({
              scriptPath,
              audioPath: path,
              model,
              device: runtimeDevice,
              computeType: runtimeComputeType
            })
          ],
          { signal }
        )
        break
      } catch (error) {
        lastStartError = error
      }
    }
  }

  if (!result) {
    throw new Error(
      `Python is not available. Install Python or set BILIMI_PYTHON_PATH. ${lastStartError instanceof Error ? lastStartError.message : ''}`.trim()
    )
  }

  if (result.exitCode !== 0) {
    throw readableFasterWhisperError(result, runtimeDevice)
  }

  try {
    return mapFasterWhisperOutputToSegments(JSON.parse(result.stdout), offsetSeconds)
  } catch {
    throw new Error('Local faster-whisper transcription returned invalid JSON.')
  }
}
