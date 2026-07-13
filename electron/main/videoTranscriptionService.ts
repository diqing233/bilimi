import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  TranscriptSegment,
  VideoAudioTranscriptionThreadLimit,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult
} from '../../src/shared/types'
import { downloadVideoAudio } from './audioDownload'
import { segmentAudioForTranscription, type AudioSegment } from './audioSegmenter'
import { exportBilibiliCookiesToFile, type CookieSessionLike } from './bilibiliCookieExport'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { transcribeAudioSegmentWithLocalWhisper } from './localWhisperTranscription'
import { runProcess } from './audioDownload'

type ServiceDeps = {
  request: VideoAudioTranscriptionRequest
  session: CookieSessionLike
  tempDir: string
  progress?: (progress: VideoAudioTranscriptionProgress) => void
  resolveTools?: typeof resolveMediaToolPaths
  exportCookies?: typeof exportBilibiliCookiesToFile
  downloadAudio?: typeof downloadVideoAudio
  segmentAudio?: typeof segmentAudioForTranscription
  transcribeSegment?: (input: {
    path: string
    offsetSeconds: number
    threadLimit?: VideoAudioTranscriptionThreadLimit
    signal?: AbortSignal
  }) => Promise<TranscriptSegment[]>
  getAudioDuration?: (path: string, ffmpegPath?: string, signal?: AbortSignal) => Promise<number>
  cleanup?: (path: string) => Promise<void>
  threadLimit?: VideoAudioTranscriptionThreadLimit
  signal?: AbortSignal
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function emit(
  progress: ((progress: VideoAudioTranscriptionProgress) => void) | undefined,
  next: VideoAudioTranscriptionProgress
) {
  progress?.(next)
}

function createFfprobePath(ffmpegPath: string): string {
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

  return normalizePath(join(dirname(ffmpegPath), executable))
}

export async function getAudioDurationSeconds(
  path: string,
  ffmpegPath = 'ffmpeg',
  signal?: AbortSignal
): Promise<number> {
  const result = await runProcess(
    createFfprobePath(ffmpegPath),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path
    ],
    { signal }
  )
  const duration = Number.parseFloat(result.stdout.trim())

  if (result.exitCode !== 0 || !Number.isFinite(duration) || duration <= 0) {
    return 3600
  }

  return duration
}

async function defaultCleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export async function transcribeCurrentVideoAudio({
  request,
  session,
  tempDir,
  progress,
  resolveTools = resolveMediaToolPaths,
  exportCookies = exportBilibiliCookiesToFile,
  downloadAudio = downloadVideoAudio,
  segmentAudio = segmentAudioForTranscription,
  transcribeSegment,
  getAudioDuration = getAudioDurationSeconds,
  cleanup = defaultCleanup,
  threadLimit = 'unlimited',
  signal
}: ServiceDeps): Promise<VideoAudioTranscriptionResult> {
  try {
    emit(progress, { step: 'preparing-session', message: 'Preparing current login session.' })
    const tools = resolveTools()
    const transcribeAudioSegment =
      transcribeSegment ??
      ((input: {
        path: string
        offsetSeconds: number
        threadLimit?: VideoAudioTranscriptionThreadLimit
        signal?: AbortSignal
      }) =>
        transcribeAudioSegmentWithLocalWhisper({
          ...input,
          cliPath: tools.whisperCliPath,
          modelPath: tools.whisperModelPath,
          signal
        }))
    const cookieExport = await exportCookies({ session, tempDir })

    emit(progress, { step: 'downloading-audio', message: 'Downloading audio.' })
    const outputTemplate = normalizePath(join(tempDir, 'source.%(ext)s'))
    const { audioPath } = await downloadAudio({
      ytdlpPath: tools.ytdlpPath,
      url: request.url,
      cookiePath: cookieExport.path,
      outputTemplate,
      signal
    })

    emit(progress, { step: 'preparing-segments', message: 'Preparing audio segments.' })
    const durationSeconds = await getAudioDuration(audioPath, tools.ffmpegPath, signal)
    const segments = await segmentAudio({
      ffmpegPath: tools.ffmpegPath,
      inputPath: audioPath,
      outputDir: tempDir,
      durationSeconds,
      signal
    })

    const transcript: TranscriptSegment[] = []

    for (const [index, segment] of segments.entries()) {
      emit(progress, {
        step: 'transcribing-segment',
        message: `Transcribing segment ${index + 1}/${segments.length}.`,
        segmentIndex: index + 1,
        segmentCount: segments.length
      })
      transcript.push(
        ...(await transcribeAudioSegment({
          path: segment.path,
          offsetSeconds: segment.offsetSeconds,
          threadLimit,
          ...(signal ? { signal } : {})
        }))
      )
    }

    emit(progress, { step: 'merging-transcript', message: 'Merging transcript.' })

    return {
      transcriptSource: 'audio',
      transcript
    }
  } finally {
    await cleanup(tempDir)
  }
}

export type { AudioSegment }
