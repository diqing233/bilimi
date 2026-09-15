import type { TranscriptSegment } from '../../../src/shared/types'
import { runProcess as defaultRunProcess, type RunProcess } from '../audioDownload'
import { dirname } from 'node:path'
import { resolveSenseVoiceRuntimePaths } from './senseVoicePathSandbox'

type SenseVoiceOutput = {
  segments?: Array<{ start?: number; end?: number; text?: string }>
  text?: string
  timestamps?: number[]
  tokens?: string[]
}

function cleanText(value = ''): string {
  return value.replace(/<\|[^|]+\|>/gu, '').replace(/\s+/gu, ' ').trim()
}

type TimedToken = { text: string; timestamp: number }
const MAX_TIMELINE_SEGMENT_SPAN_SECONDS = 10

function sentenceText(tokens: TimedToken[]): string {
  return cleanText(tokens.map((token) => token.text).join(''))
}

function tokenTimestampSegments(payload: SenseVoiceOutput, offsetSeconds: number): TranscriptSegment[] | null {
  if (!payload.tokens?.length || !payload.timestamps?.length || payload.tokens.length !== payload.timestamps.length) return null
  const tokens = payload.tokens.flatMap((token, index): TimedToken[] => {
    const timestamp = payload.timestamps?.[index]
    return typeof timestamp === 'number' && Number.isFinite(timestamp) && cleanText(token)
      ? [{ text: token, timestamp }]
      : []
  })
  if (!tokens.length) return null

  const segments: TranscriptSegment[] = []
  let sentenceStart = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const isSentenceBoundary = /[。！？.!?]/u.test(tokens[index].text)
    const elapsedSeconds = tokens[index].timestamp - tokens[sentenceStart].timestamp
    if (!isSentenceBoundary && elapsedSeconds < MAX_TIMELINE_SEGMENT_SPAN_SECONDS) continue
    const sentenceTokens = tokens.slice(sentenceStart, index + 1)
    const text = sentenceText(sentenceTokens)
    if (text) {
      segments.push({
        start: sentenceTokens[0].timestamp + offsetSeconds,
        end: sentenceTokens.at(-1)!.timestamp + offsetSeconds,
        text
      })
    }
    sentenceStart = index + 1
  }
  const tail = tokens.slice(sentenceStart)
  const tailText = sentenceText(tail)
  if (tailText) {
    segments.push({ start: tail[0].timestamp + offsetSeconds, end: tail.at(-1)!.timestamp + offsetSeconds, text: tailText })
  }
  if (segments.length === 1) {
    const completeText = cleanText(payload.text)
    if (completeText) segments[0].text = completeText
  }
  return segments.length ? segments : null
}

export function mapSenseVoiceOutputToSegments(payload: SenseVoiceOutput, offsetSeconds: number): TranscriptSegment[] {
  const tokenSegments = !payload.segments?.length ? tokenTimestampSegments(payload, offsetSeconds) : null
  if (tokenSegments) return tokenSegments
  const segments = payload.segments ?? (payload.text ? [{
    start: payload.timestamps?.[0],
    end: payload.timestamps?.at(-1),
    text: payload.text
  }] : [])
  return segments.flatMap((segment) => {
    const text = cleanText(segment.text)
    return text ? [{
      start: typeof segment.start === 'number' ? segment.start + offsetSeconds : null,
      end: typeof segment.end === 'number' ? segment.end + offsetSeconds : null,
      text
    }] : []
  })
}

export function buildSenseVoiceArgs({ audioPath, modelDirectory }: { audioPath: string; modelDirectory: string }): string[] {
  return [
    `--sense-voice-model=${modelDirectory}/model.int8.onnx`,
    `--tokens=${modelDirectory}/tokens.txt`,
    '--sense-voice-use-itn=false',
    audioPath
  ]
}

function parseSenseVoiceOutput(stdout: string): SenseVoiceOutput {
  const line = stdout.split(/\r?\n/u).map((candidate) => candidate.trim()).find((candidate) => candidate.startsWith('{'))
  if (!line) throw new Error('SenseVoice helper returned invalid JSON.')
  return JSON.parse(line) as SenseVoiceOutput
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function needsAsciiPathSandbox(...paths: string[]): boolean {
  return paths.some((path) => !/^[\x00-\x7F]+$/u.test(path))
}

export async function transcribeAudioSegmentWithSenseVoice({
  path,
  offsetSeconds,
  helperPath,
  modelDirectory,
  runProcess = defaultRunProcess,
  resolveRuntimePaths = resolveSenseVoiceRuntimePaths,
  signal
}: {
  path: string
  offsetSeconds: number
  helperPath: string
  modelDirectory: string
  runProcess?: RunProcess
  resolveRuntimePaths?: typeof resolveSenseVoiceRuntimePaths
  signal?: AbortSignal
}): Promise<TranscriptSegment[]> {
  let runtimePaths: { helperPath: string; modelDirectory: string }
  try {
    runtimePaths = needsAsciiPathSandbox(helperPath, modelDirectory)
      ? await resolveRuntimePaths({
          helperPath,
          modelDirectory,
          workingDirectory: dirname(path)
        })
      : { helperPath, modelDirectory }
  } catch (error) {
    if (signal?.aborted) throw createAbortError()
    throw error
  }
  if (signal?.aborted) throw createAbortError()
  const result = await runProcess(
    runtimePaths.helperPath,
    buildSenseVoiceArgs({ audioPath: path, modelDirectory: runtimePaths.modelDirectory }),
    { signal }
  )
  if (signal?.aborted) throw createAbortError()
  if (result.exitCode !== 0) throw new Error('SenseVoice 转写失败，请检查音频文件和模型后重试。')
  try {
    return mapSenseVoiceOutputToSegments(parseSenseVoiceOutput(result.stdout), offsetSeconds)
  } catch {
    throw new Error('SenseVoice helper returned invalid JSON.')
  }
}
