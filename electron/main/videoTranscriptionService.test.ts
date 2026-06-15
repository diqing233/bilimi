import { describe, expect, it, vi } from 'vitest'
import { transcribeCurrentVideoAudio } from './videoTranscriptionService'

describe('video transcription service', () => {
  it('downloads, segments, transcribes, merges, reports progress, and cleans up', async () => {
    const progress = vi.fn()
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        apiKey: 'sk-test',
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' }),
        exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
        downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
        segmentAudio: vi.fn().mockResolvedValue([
          { path: 'C:/tmp/segment-000.mp3', offsetSeconds: 0 },
          { path: 'C:/tmp/segment-001.mp3', offsetSeconds: 600 }
        ]),
        transcribeSegment: vi
          .fn()
          .mockResolvedValueOnce([{ start: 0, end: 2, text: 'first segment' }])
          .mockResolvedValueOnce([{ start: 600, end: 602, text: 'second segment' }]),
        getAudioDuration: vi.fn().mockResolvedValue(900),
        cleanup,
        progress
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
    expect(cleanup).toHaveBeenCalledWith('C:/tmp/job')
  })

  it('cleans up when download fails', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)

    await expect(
      transcribeCurrentVideoAudio({
        request: {
          url: 'https://www.bilibili.com/video/BV1demo',
          title: 'Demo'
        },
        apiKey: 'sk-test',
        session: { cookies: { get: vi.fn().mockResolvedValue([]) } },
        tempDir: 'C:/tmp/job',
        resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' }),
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
