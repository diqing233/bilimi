import { join } from 'node:path'
import OpenCC from 'opencc-js'
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

type FasterWhisperArgsInput = {
  scriptPath: string
  audioPath: string
  model: string
  device?: string
  computeType?: string
}

type TranscribeInput = {
  path: string
  offsetSeconds: number
  model?: string
  pythonCommand?: string
  pythonCandidates?: PythonCandidate[]
  scriptPath?: string
  runProcess?: RunProcess
}

type PythonCandidate = {
  command: string
  argsPrefix: string[]
}

const DEFAULT_MODEL = 'small'
const DEFAULT_DEVICE = 'cpu'
const DEFAULT_COMPUTE_TYPE = 'int8'
const traditionalToSimplified = OpenCC.Converter({ from: 't', to: 'cn' })

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeChineseTranscriptText(value = ''): string {
  return traditionalToSimplified(cleanText(value))
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

function readableFasterWhisperError(result: { stderr: string; stdout: string }): string {
  const output = `${result.stderr}\n${result.stdout}`

  if (output.includes('ModuleNotFoundError') && output.includes('faster_whisper')) {
    return 'faster-whisper is not installed. Run: python -m pip install faster-whisper'
  }

  if (output.includes('BILIMI_FASTER_WHISPER_IMPORT_ERROR')) {
    return 'faster-whisper is not installed. Run: python -m pip install faster-whisper'
  }

  if (output.includes('BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR')) {
    return 'Local faster-whisper transcription failed. Check model download, network, or audio format.'
  }

  return cleanText(result.stderr || result.stdout) || 'Local faster-whisper transcription failed.'
}

export function mapFasterWhisperOutputToSegments(
  payload: FasterWhisperOutput,
  offsetSeconds: number
): TranscriptSegment[] {
  return (payload.segments ?? [])
    .map((segment) => ({
      start: typeof segment.start === 'number' ? segment.start + offsetSeconds : null,
      end: typeof segment.end === 'number' ? segment.end + offsetSeconds : null,
      text: normalizeChineseTranscriptText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function buildFasterWhisperArgs({
  scriptPath,
  audioPath,
  model,
  device = DEFAULT_DEVICE,
  computeType = DEFAULT_COMPUTE_TYPE
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
    computeType
  ]
}

export async function transcribeAudioSegmentWithFasterWhisper({
  path,
  offsetSeconds,
  model = DEFAULT_MODEL,
  pythonCommand,
  pythonCandidates = pythonCommand
    ? [{ command: pythonCommand, argsPrefix: [] }]
    : createPythonCandidates(),
  scriptPath = defaultScriptPath(),
  runProcess = defaultRunProcess
}: TranscribeInput): Promise<TranscriptSegment[]> {
  let result: Awaited<ReturnType<RunProcess>> | null = null
  let lastStartError: unknown = null

  for (const candidate of pythonCandidates) {
    try {
      result = await runProcess(candidate.command, [
        ...candidate.argsPrefix,
        ...buildFasterWhisperArgs({ scriptPath, audioPath: path, model })
      ])
      break
    } catch (error) {
      lastStartError = error
    }
  }

  if (!result) {
    throw new Error(
      `Python is not available. Install Python or set BILIMI_PYTHON_PATH. ${lastStartError instanceof Error ? lastStartError.message : ''}`.trim()
    )
  }

  if (result.exitCode !== 0) {
    throw new Error(readableFasterWhisperError(result))
  }

  try {
    return mapFasterWhisperOutputToSegments(JSON.parse(result.stdout), offsetSeconds)
  } catch {
    throw new Error('Local faster-whisper transcription returned invalid JSON.')
  }
}
