import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { extname } from 'node:path'
import OpenCC from 'opencc-js'
import type { TranscriptSegment, VideoAudioTranscriptionThreadLimit } from '../../src/shared/types'
import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

type LocalWhisperTimestamp = {
  from?: string
  to?: string
}

type LocalWhisperSegment = {
  timestamps?: LocalWhisperTimestamp
  text?: string
}

type LocalWhisperOutput = {
  transcription?: LocalWhisperSegment[]
}

type LocalWhisperArgsInput = {
  cliPath: string
  modelPath: string
  audioPath: string
  outputPathWithoutExtension: string
  threadLimit?: VideoAudioTranscriptionThreadLimit
  availableThreads?: number
}

type TranscribeInput = {
  path: string
  offsetSeconds: number
  cliPath: string
  modelPath: string
  threadLimit?: VideoAudioTranscriptionThreadLimit
  runProcess?: RunProcess
  readTextFile?: typeof readFile
  signal?: AbortSignal
}

const traditionalToSimplified = OpenCC.Converter({ from: 't', to: 'cn' })

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeChineseTranscriptText(value = ''): string {
  return traditionalToSimplified(cleanText(value))
}

function outputPathWithoutExtension(path: string): string {
  const extension = extname(path)

  if (!extension) {
    return path
  }

  return path.slice(0, -extension.length)
}

function parseTimestamp(value?: string): number | null {
  if (!value) {
    return null
  }

  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})$/)

  if (!match) {
    return null
  }

  const [, hours, minutes, seconds, milliseconds] = match
  return (
    Number.parseInt(hours, 10) * 3600 +
    Number.parseInt(minutes, 10) * 60 +
    Number.parseInt(seconds, 10) +
    Number.parseInt(milliseconds, 10) / 1000
  )
}

function readableLocalWhisperError(result: { stderr: string; stdout: string }): string {
  const detail = cleanText(result.stderr || result.stdout)

  if (!detail) {
    return '本地转写组件运行失败，请重新安装 bilimi。'
  }

  return `本地转写组件运行失败：${detail}`
}

function normalizeAvailableThreads(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

export function buildLocalWhisperArgs({
  modelPath,
  audioPath,
  outputPathWithoutExtension,
  threadLimit = 'unlimited',
  availableThreads = availableParallelism()
}: LocalWhisperArgsInput): string[] {
  const threadCount =
    threadLimit === 'unlimited' ? normalizeAvailableThreads(availableThreads) : threadLimit

  return [
    '-m',
    modelPath,
    '-f',
    audioPath,
    '-l',
    'auto',
    '-t',
    String(threadCount),
    '-oj',
    '-ojf',
    '-of',
    outputPathWithoutExtension,
    '-np'
  ]
}

export function mapLocalWhisperOutputToSegments(
  payload: LocalWhisperOutput,
  offsetSeconds: number
): TranscriptSegment[] {
  return (payload.transcription ?? [])
    .map((segment) => {
      const start = parseTimestamp(segment.timestamps?.from)
      const end = parseTimestamp(segment.timestamps?.to)

      return {
        start: typeof start === 'number' ? start + offsetSeconds : null,
        end: typeof end === 'number' ? end + offsetSeconds : null,
        text: normalizeChineseTranscriptText(segment.text)
      }
    })
    .filter((segment) => segment.text.length > 0)
}

export async function transcribeAudioSegmentWithLocalWhisper({
  path,
  offsetSeconds,
  cliPath,
  modelPath,
  threadLimit = 'unlimited',
  runProcess = defaultRunProcess,
  readTextFile = readFile,
  signal
}: TranscribeInput): Promise<TranscriptSegment[]> {
  const outputPath = outputPathWithoutExtension(path)
  const result = await runProcess(
    cliPath,
    buildLocalWhisperArgs({
      cliPath,
      modelPath,
      audioPath: path,
      outputPathWithoutExtension: outputPath,
      threadLimit
    }),
    { signal }
  )

  if (result.exitCode !== 0) {
    throw new Error(readableLocalWhisperError(result))
  }

  try {
    const output = await readTextFile(`${outputPath}.json`, 'utf8')
    return mapLocalWhisperOutputToSegments(JSON.parse(output), offsetSeconds)
  } catch (error) {
    if (error instanceof Error && error.name === 'SyntaxError') {
      throw new Error('本地转写组件返回了无法解析的结果，请重新安装 bilimi。')
    }

    throw error
  }
}
