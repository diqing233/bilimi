import { describe, expect, it, vi } from 'vitest'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'

describe('video transcription service', () => {
  it('downloads, segments, transcribes, merges, reports progress, and cleans up', async () => {
    const progress = vi.fn()
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const transcribeSegment = vi
      .fn()
      .mockResolvedValueOnce([{ start: 0, end: 2, text: 'first segment' }])
      .mockResolvedValueOnce([{ start: 600, end: 602, text: 'second segment' }])

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({
          ytdlpPath: 'yt-dlp',
          ffmpegPath: 'ffmpeg',
          whisperCliPath: 'whisper-cli',
          whisperModelPath: 'ggml-model.bin'
        }),
        exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
        downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
        segmentAudio: vi.fn().mockResolvedValue([
          { path: 'C:/tmp/segment-000.mp3', offsetSeconds: 0 },
          { path: 'C:/tmp/segment-001.mp3', offsetSeconds: 600 }
        ]),
        transcribeSegment,
        getAudioDuration: vi.fn().mockResolvedValue(900),
        cleanup,
        progress,
        threadLimit: 2
      })
    ).resolves.toEqual({
      transcriptSource: 'audio',
      transcript: [
        { start: 0, end: 2, text: 'first segment' },
        { start: 600, end: 602, text: 'second segment' }
      ]
    })

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'downloading-audio' })
    )
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'transcribing-segment', segmentIndex: 2, segmentCount: 2 })
    )
    expect(Object.keys(transcribeSegment.mock.calls[0][0])).toEqual([
      'path',
      'offsetSeconds',
      'threadLimit'
    ])
    expect(transcribeSegment.mock.calls[0][0]).toEqual({
      path: 'C:/tmp/segment-000.mp3',
      offsetSeconds: 0,
      threadLimit: 2
    })
    expect(cleanup).toHaveBeenCalledWith('C:/tmp/job')
  })

  it('passes cancellation signals to owned long-running steps', async () => {
    const signal = new AbortController().signal
    const downloadAudio = vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' })
    const segmentAudio = vi.fn().mockResolvedValue([{ path: 'C:/tmp/segment-000.mp3', offsetSeconds: 0 }])
    const transcribeSegment = vi.fn().mockResolvedValue([{ start: 0, end: 2, text: 'segment' }])
    const getAudioDuration = vi.fn().mockResolvedValue(120)

    await transcribeCurrentVideoAudio({
      request: {
        url: 'https://www.bilibili.com/video/BV1demo',
        title: 'Demo'
      },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
      tempDir: 'C:/tmp/job',
      resolveTools: () => ({
        ytdlpPath: 'yt-dlp',
        ffmpegPath: 'ffmpeg',
        whisperCliPath: 'whisper-cli',
        whisperModelPath: 'ggml-model.bin'
      }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio,
      segmentAudio,
      transcribeSegment,
      getAudioDuration,
      cleanup: vi.fn().mockResolvedValue(undefined),
      signal
    })

    expect(downloadAudio).toHaveBeenCalledWith(expect.objectContaining({ signal }))
    expect(getAudioDuration).toHaveBeenCalledWith('C:/tmp/audio.m4a', 'ffmpeg', signal)
    expect(segmentAudio).toHaveBeenCalledWith(expect.objectContaining({ signal }))
    expect(transcribeSegment).toHaveBeenCalledWith({
      path: 'C:/tmp/segment-000.mp3',
      offsetSeconds: 0,
      threadLimit: 'unlimited',
      signal
    })
  })

  it('cleans up when download fails', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({
          ytdlpPath: 'yt-dlp',
          ffmpegPath: 'ffmpeg',
          whisperCliPath: 'whisper-cli',
          whisperModelPath: 'ggml-model.bin'
        }),
        exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
        downloadAudio: vi.fn().mockRejectedValue(new Error('Audio download failed.')),
        segmentAudio: vi.fn(),
        transcribeSegment: vi.fn(),
        getAudioDuration: vi.fn(),
        cleanup
      })
    ).rejects.toThrow('Audio download failed')

    expect(cleanup).toHaveBeenCalledWith('C:/tmp/job')
  })
})
