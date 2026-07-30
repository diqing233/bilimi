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

  it('builds RIFF PCM WAV segments for SenseVoice without changing the default MP3 profile', () => {
    expect(
      buildFfmpegSegmentArgs({
        inputPath: 'C:/tmp/input.m4a',
        segmentSeconds: 600,
        outputPattern: 'C:/tmp/segment-%03d.wav',
        profile: 'wav-pcm-16khz-mono'
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
      '-c:a',
      'pcm_s16le',
      '-f',
      'segment',
      '-segment_time',
      '600',
      '-reset_timestamps',
      '1',
      'C:/tmp/segment-%03d.wav'
    ])
  })

  it('discovers ordered WAV segments for the SenseVoice preparation profile', async () => {
    const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const listFiles = vi.fn().mockResolvedValue(['segment-001.wav', 'segment-000.wav', 'segment-999.mp3'])

    await expect(segmentAudioForTranscription({
      ffmpegPath: 'C:/tools/ffmpeg.exe',
      inputPath: 'C:/tmp/input.m4a',
      outputDir: 'C:/tmp/segments',
      durationSeconds: 900,
      profile: 'wav-pcm-16khz-mono',
      runProcess,
      listFiles
    })).resolves.toEqual([
      { path: 'C:/tmp/segments/segment-000.wav', offsetSeconds: 0 },
      { path: 'C:/tmp/segments/segment-001.wav', offsetSeconds: 600 }
    ])
  })

  it('returns ordered segment files with offsets', async () => {
    const runProcess = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    const listFiles = vi.fn().mockResolvedValue(['segment-001.mp3', 'segment-000.mp3'])
    const signal = new AbortController().signal

    await expect(
      segmentAudioForTranscription({
        ffmpegPath: 'C:/tools/ffmpeg.exe',
        inputPath: 'C:/tmp/input.m4a',
        outputDir: 'C:/tmp/segments',
        segmentSeconds: 600,
        durationSeconds: 900,
        runProcess,
        listFiles,
        signal
      })
    ).resolves.toEqual([
      { path: 'C:/tmp/segments/segment-000.mp3', offsetSeconds: 0 },
      { path: 'C:/tmp/segments/segment-001.mp3', offsetSeconds: 600 }
    ])
    expect(runProcess).toHaveBeenCalledWith('C:/tools/ffmpeg.exe', expect.any(Array), { signal })
  })

  it('includes ffmpeg diagnostics and input size when segmenting fails', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'Invalid data found when processing input',
      exitCode: 183
    })
    const statFile = vi.fn().mockResolvedValue({ size: 16196844 })

    await expect(
      segmentAudioForTranscription({
        ffmpegPath: 'C:/tools/ffmpeg.exe',
        inputPath: 'C:/tmp/source.m4a',
        outputDir: 'C:/tmp/segments',
        durationSeconds: 900,
        runProcess,
        statFile
      })
    ).rejects.toThrow(
      'Audio preparation failed: ffmpeg exited with 183. input=C:/tmp/source.m4a size=16196844. Invalid data found when processing input'
    )
  })
})
