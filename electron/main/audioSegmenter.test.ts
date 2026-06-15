import { describe, expect, it, vi } from 'vitest'
import {
  buildFfmpegSegmentArgs,
  createSegmentOffsets,
  segmentAudioForTranscription
} from './audioSegmenter'

describe('audio segmenter', () => {
  it('creates segment offsets by fixed duration', () => {
    expect(createSegmentOffsets({ durationSeconds: 125, segmentSeconds: 60 })).toEqual([0, 60, 120])
  })

  it('builds ffmpeg args for normalized audio segments', () => {
    expect(
      buildFfmpegSegmentArgs({
        inputPath: 'C:/tmp/input.m4a',
        segmentSeconds: 600,
        outputPattern: 'C:/tmp/segment-%03d.mp3'
      })
    ).toEqual([
      '-y',
      '-i',
      'C:/tmp/input.m4a',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-f',
      'segment',
      '-segment_time',
      '600',
      '-reset_timestamps',
      '1',
      'C:/tmp/segment-%03d.mp3'
    ])
  })

  it('returns ordered segment files with offsets', async () => {
    const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const listFiles = vi.fn().mockResolvedValue(['segment-001.mp3', 'segment-000.mp3'])

    await expect(
      segmentAudioForTranscription({
        ffmpegPath: 'C:/tools/ffmpeg.exe',
        inputPath: 'C:/tmp/input.m4a',
        outputDir: 'C:/tmp/segments',
        segmentSeconds: 600,
        durationSeconds: 900,
        runProcess,
        listFiles
      })
    ).resolves.toEqual([
      { path: 'C:/tmp/segments/segment-000.mp3', offsetSeconds: 0 },
      { path: 'C:/tmp/segments/segment-001.mp3', offsetSeconds: 600 }
    ])
  })
})
