import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

export type AudioSegment = {
  path: string
  offsetSeconds: number
}

export type AudioPreparationProfile = 'mp3' | 'wav-pcm-16khz-mono'

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function sanitizeProcessText(value: string): string {
  return value.replace(/https?:\/\/\S+/g, '[redacted-url]').replace(/\s+/g, ' ').trim().slice(0, 500)
}

async function describeInputFile(
  inputPath: string,
  statFile: (path: string) => Promise<{ size: number }>
): Promise<string> {
  try {
    const inputStats = await statFile(inputPath)
    return `input=${inputPath} size=${inputStats.size}`
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return `input=${inputPath} size=unknown statError=${sanitizeProcessText(detail)}`
  }
}

export function createSegmentOffsets({
  durationSeconds,
  segmentSeconds
}: {
  durationSeconds: number
  segmentSeconds: number
}): number[] {
  const offsets: number[] = []

  for (let offset = 0; offset < durationSeconds; offset += segmentSeconds) {
    offsets.push(offset)
  }

  return offsets.length > 0 ? offsets : [0]
}

export function buildFfmpegSegmentArgs({
  inputPath,
  segmentSeconds,
  outputPattern,
  profile = 'mp3'
}: {
  inputPath: string
  segmentSeconds: number
  outputPattern: string
  profile?: AudioPreparationProfile
}): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    ...(profile === 'wav-pcm-16khz-mono' ? ['-c:a', 'pcm_s16le'] : []),
    '-f',
    'segment',
    '-segment_time',
    String(segmentSeconds),
    '-reset_timestamps',
    '1',
    outputPattern
  ]
}

export async function segmentAudioForTranscription({
  ffmpegPath,
  inputPath,
  outputDir,
  profile = 'mp3',
  segmentSeconds = 600,
  durationSeconds,
  runProcess = defaultRunProcess,
  listFiles = readdir,
  statFile = stat,
  signal
}: {
  ffmpegPath: string
  inputPath: string
  outputDir: string
  profile?: AudioPreparationProfile
  segmentSeconds?: number
  durationSeconds: number
  runProcess?: RunProcess
  listFiles?: typeof readdir
  statFile?: (path: string) => Promise<{ size: number }>
  signal?: AbortSignal
}): Promise<AudioSegment[]> {
  const extension = profile === 'wav-pcm-16khz-mono' ? 'wav' : 'mp3'
  const outputPattern = normalizePath(join(outputDir, `segment-%03d.${extension}`))
  const result = await runProcess(
    ffmpegPath,
    buildFfmpegSegmentArgs({ inputPath, segmentSeconds, outputPattern, profile }),
    { signal }
  )

  if (result.exitCode !== 0) {
    const inputDescription = await describeInputFile(inputPath, statFile)
    const processDetail = sanitizeProcessText(result.stderr || result.stdout) || 'No ffmpeg output.'

    throw new Error(
      `Audio preparation failed: ffmpeg exited with ${result.exitCode}. ${inputDescription}. ${processDetail}`
    )
  }

  const files = (await listFiles(outputDir))
    .filter((file) => new RegExp(`^segment-\\d+\\.${extension}$`).test(file))
    .sort()
  const offsets = createSegmentOffsets({ durationSeconds, segmentSeconds })

  return files.map((file, index) => ({
    path: normalizePath(join(outputDir, file)),
    offsetSeconds: offsets[index] ?? index * segmentSeconds
  }))
}
