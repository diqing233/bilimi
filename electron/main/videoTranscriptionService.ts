import type { Session } from 'electron'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  TranscriptSegment,
  VideoAudioTranscriptionProgress,
  VideoAudioTranscriptionRequest,
  VideoAudioTranscriptionResult
} from '../../src/shared/types'
import { downloadVideoAudio } from './audioDownload'
import { segmentAudioForTranscription, type AudioSegment } from './audioSegmenter'
import { exportBilibiliCookiesToFile } from './bilibiliCookieExport'
import { resolveMediaToolPaths } from './mediaToolPaths'
import { transcribeAudioSegmentWithFasterWhisper } from './fasterWhisperTranscription'
import { runProcess } from './audioDownload'

type ServiceSessionLike = Pick<Session, 'cookies'>

type ServiceDeps = {
  request: VideoAudioTranscriptionRequest
  session: ServiceSessionLike
  tempDir: string
  progress?: (progress: VideoAudioTranscriptionProgress) => void
  resolveTools?: typeof resolveMediaToolPaths
  exportCookies?: typeof exportBilibiliCookiesToFile
  downloadAudio?: typeof downloadVideoAudio
  segmentAudio?: typeof segmentAudioForTranscription
  transcribeSegment?: typeof transcribeAudioSegmentWithFasterWhisper
  getAudioDuration?: (path: string, ffmpegPath?: string) => Promise<number>
  cleanup?: (path: string) => Promise<void>
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

export async function getAudioDurationSeconds(path: string, ffmpegPath = 'ffmpeg'): Promise<number> {
  const result = await runProcess(createFfprobePath(ffmpegPath), [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    path
  ])
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
  transcribeSegment = transcribeAudioSegmentWithFasterWhisper,
  getAudioDuration = getAudioDurationSeconds,
  cleanup = defaultCleanup
}: ServiceDeps): Promise<VideoAudioTranscriptionResult> {
  try {
    emit(progress, { step: 'preparing-session', message: 'Preparing current login session.' })
    const tools = resolveTools()
    const cookieExport = await exportCookies({ session, tempDir })

    emit(progress, { step: 'downloading-audio', message: 'Downloading audio.' })
    const outputTemplate = normalizePath(join(tempDir, 'source.%(ext)s'))
    const { audioPath } = await downloadAudio({
      ytdlpPath: tools.ytdlpPath,
      url: request.url,
      cookiePath: cookieExport.path,
      outputTemplate
    })

    emit(progress, { step: 'preparing-segments', message: 'Preparing audio segments.' })
    const durationSeconds = await getAudioDuration(audioPath, tools.ffmpegPath)
    const segments = await segmentAudio({
      ffmpegPath: tools.ffmpegPath,
      inputPath: audioPath,
      outputDir: tempDir,
      durationSeconds
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
        ...(await transcribeSegment({
          path: segment.path,
          offsetSeconds: segment.offsetSeconds
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
