import type {
  TranscriptSegment,
  TranscriptionModelId,
  VideoAudioTranscriptionThreadLimit
} from '../../src/shared/types'
import { transcribeAudioSegmentWithLocalWhisper } from './localWhisperTranscription'
import { resolveMediaToolPaths, type MediaToolPaths } from './mediaToolPaths'
import { transcribeAudioSegmentWithFasterWhisper } from './fasterWhisperTranscription'
import { classifyFasterWhisperRuntimeError } from './fasterWhisperTranscription'
import { transcribeAudioSegmentWithSenseVoice } from './transcriptionProviders/senseVoice'
import type { TranscriptionRuntimePaths } from './transcriptionModelManager'

type SegmentInput = {
  path: string
  offsetSeconds: number
  threadLimit?: VideoAudioTranscriptionThreadLimit
  signal?: AbortSignal
}

export type SegmentTranscriber = ((input: SegmentInput) => Promise<TranscriptSegment[]>) & {
  runtime?: Promise<{ device: 'cpu' | 'cuda'; computeType: 'int8' | 'float16' | 'int8_float16'; fallbackMessage?: string }>
}

type FasterWhisperRuntime = NonNullable<SegmentTranscriber['runtime']> extends Promise<infer Runtime> ? Runtime : never

type Dependencies = {
  resolveTools?: () => MediaToolPaths
  resolveWhisperModelPath?: () => string | null
  transcribeWhisper?: typeof transcribeAudioSegmentWithLocalWhisper
  resolveSenseVoicePaths?: () => { helperPath: string; modelDirectory: string } | null
  transcribeSenseVoice?: typeof transcribeAudioSegmentWithSenseVoice
  resolveFasterWhisperPaths?: (id: Extract<TranscriptionModelId, `faster-whisper-${string}`>) => TranscriptionRuntimePaths | null
  resolveFasterWhisperRuntime?: (id: Extract<TranscriptionModelId, `faster-whisper-${string}`>) => Promise<{ device: 'cpu' | 'cuda'; computeType: 'int8' | 'float16' | 'int8_float16'; fallbackMessage?: string }>
  transcribeFasterWhisper?: typeof transcribeAudioSegmentWithFasterWhisper
}

/**
 * Provider implementations may retain their native runtime behind the returned
 * runner. Keep that runner stable when sequential queue jobs select the same
 * verified helper/model pair.
 */
const sharedRunners = new WeakMap<Function, Map<string, SegmentTranscriber>>()

function reuseRunner(
  provider: Function,
  key: string,
  create: () => SegmentTranscriber
): SegmentTranscriber {
  let runners = sharedRunners.get(provider)
  if (!runners) {
    runners = new Map()
    sharedRunners.set(provider, runners)
  }
  const existing = runners.get(key)
  if (existing) return existing
  const runner = create()
  runners.set(key, runner)
  return runner
}

export function createTranscriptionProviderResolver({
  resolveTools = resolveMediaToolPaths,
  resolveWhisperModelPath = () => null,
  transcribeWhisper = transcribeAudioSegmentWithLocalWhisper,
  resolveSenseVoicePaths = () => null,
  transcribeSenseVoice = transcribeAudioSegmentWithSenseVoice,
  resolveFasterWhisperPaths = () => null,
  resolveFasterWhisperRuntime = async () => ({ device: 'cpu' as const, computeType: 'int8' as const }),
  transcribeFasterWhisper = transcribeAudioSegmentWithFasterWhisper
}: Dependencies = {}) {
  return (modelId: TranscriptionModelId) => {
    if (modelId === 'sensevoice-small') {
      const paths = resolveSenseVoicePaths()
      if (paths) return reuseRunner(
        transcribeSenseVoice,
        `sensevoice:${paths.helperPath}:${paths.modelDirectory}`,
        () => (input) => transcribeSenseVoice({ ...input, ...paths })
      )
      return async (_input: SegmentInput): Promise<TranscriptSegment[]> => {
        throw new Error('SenseVoiceSmall is not available in this development runtime. Install its verified runtime and model before selecting it.')
      }
    }

    if (modelId === 'faster-whisper-large-v3' || modelId === 'faster-whisper-large-v3-turbo') {
      const paths = resolveFasterWhisperPaths(modelId)
      if (paths) {
        let runtimePromise = resolveFasterWhisperRuntime(modelId)
        let runtime: FasterWhisperRuntime | undefined
        // This resolver is scoped to one transcription job. Do not reuse the
        // first job's CUDA decision across later jobs: free VRAM and runtime
        // health can change between them.
        const runner = (async (input: SegmentInput) => {
          runtime ??= await runtimePromise
          try {
            return await transcribeFasterWhisper({
              ...input,
              ...runtime,
              ...(paths.helperPath ? { helperPath: paths.helperPath } : {}),
              ...(paths.python ? { pythonCommand: paths.python.command, scriptPath: paths.python.scriptPath } : {}),
              model: paths.modelDirectory
            })
          } catch (error) {
            const classified = classifyFasterWhisperRuntimeError(error, runtime.device)
            if (runtime.device !== 'cuda' || classified?.kind !== 'cuda-initialization') throw error
            runtime = {
              device: 'cpu',
              computeType: 'int8',
              fallbackMessage: 'NVIDIA GPU initialization failed; using CPU for this transcription.'
            }
            runtimePromise = Promise.resolve(runtime)
            runner.runtime = runtimePromise
            return transcribeFasterWhisper({
              ...input,
              ...runtime,
              ...(paths.helperPath ? { helperPath: paths.helperPath } : {}),
              ...(paths.python ? { pythonCommand: paths.python.command, scriptPath: paths.python.scriptPath } : {}),
              model: paths.modelDirectory
            })
          }
        }) as SegmentTranscriber
        runner.runtime = runtimePromise
        return runner
      }
    }

    if (modelId !== 'whisper-small') {
      const labels: Record<Exclude<TranscriptionModelId, 'whisper-small'>, string> = {
        'sensevoice-small': 'SenseVoiceSmall',
        'faster-whisper-large-v3-turbo': 'faster-whisper large-v3-turbo',
        'faster-whisper-large-v3': 'faster-whisper large-v3'
      }
      return async (_input: SegmentInput): Promise<TranscriptSegment[]> => {
        throw new Error(`${labels[modelId]} is not available in this development runtime. Install its verified runtime and model before selecting it.`)
      }
    }

    const tools = resolveTools()
    return (input: SegmentInput) => transcribeWhisper({
      ...input,
      cliPath: tools.whisperCliPath,
      modelPath: resolveWhisperModelPath() ?? tools.whisperModelPath
    })
  }
}
