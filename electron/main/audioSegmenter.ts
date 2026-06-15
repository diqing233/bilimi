import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

export type AudioSegment = {
  path: string
  offsetSeconds: number
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
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
  outputPattern
}: {
  inputPath: string
  segmentSeconds: number
  outputPattern: string
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
  segmentSeconds = 600,
  durationSeconds,
  runProcess = defaultRunProcess,
  listFiles = readdir
}: {
  ffmpegPath: string
  inputPath: string
  outputDir: string
  segmentSeconds?: number
  durationSeconds: number
  runProcess?: RunProcess
  listFiles?: typeof readdir
}): Promise<AudioSegment[]> {
  const outputPattern = normalizePath(join(outputDir, 'segment-%03d.mp3'))
  const result = await runProcess(
    ffmpegPath,
    buildFfmpegSegmentArgs({ inputPath, segmentSeconds, outputPattern })
  )

  if (result.exitCode !== 0) {
    throw new Error('Audio preparation failed. The downloaded media format may be unsupported.')
  }

  const files = (await listFiles(outputDir))
    .filter((file) => /^segment-\d+\.mp3$/.test(file))
    .sort()
  const offsets = createSegmentOffsets({ durationSeconds, segmentSeconds })

  return files.map((file, index) => ({
    path: normalizePath(join(outputDir, file)),
    offsetSeconds: offsets[index] ?? index * segmentSeconds
  }))
}
