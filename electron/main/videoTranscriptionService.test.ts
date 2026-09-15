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

  it('announces the authoritative runtime before the first transcription segment', async () => {
    const progress = vi.fn()
    const runner = vi.fn().mockResolvedValue([]) as any
    runner.runtime = Promise.resolve({ device: 'cuda', computeType: 'float16' })
    await transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1gpu', title: 'GPU', transcriptionModelId: 'faster-whisper-large-v3-turbo' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/gpu',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper', whisperModelPath: 'model' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'cookies', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'audio.mp3' }),
      segmentAudio: vi.fn().mockResolvedValue([{ path: 'segment.mp3', offsetSeconds: 0 }]),
      getAudioDuration: vi.fn().mockResolvedValue(60), cleanup: vi.fn(), progress,
      resolveTranscriber: () => runner
    })
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      step: 'transcribing-segment', actualDevice: 'cuda', actualComputeType: 'float16'
    }))
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

  it('uses the model captured by the queue for every segment of a job', async () => {
    const transcribeSegmentForModel = vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'model output' }])
    await transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1demo', title: 'Demo', transcriptionModelId: 'faster-whisper-large-v3-turbo' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/job',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'ggml-model.bin' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
      segmentAudio: vi.fn().mockResolvedValue([{ path: 'C:/tmp/segment.mp3', offsetSeconds: 0 }]),
      getAudioDuration: vi.fn().mockResolvedValue(10), cleanup: vi.fn().mockResolvedValue(undefined),
      transcribeSegmentForModel
    })

    expect(transcribeSegmentForModel).toHaveBeenCalledWith('faster-whisper-large-v3-turbo', expect.objectContaining({ path: 'C:/tmp/segment.mp3' }))
  })

  it('resolves the captured model once before transcribing its segments', async () => {
    const transcribe = vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'model output' }])
    const resolveTranscriber = vi.fn().mockReturnValue(transcribe)
    await transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1demo', title: 'Demo', transcriptionModelId: 'sensevoice-small' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/job',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'ggml-model.bin' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
      segmentAudio: vi.fn().mockResolvedValue([
        { path: 'C:/tmp/segment-0.mp3', offsetSeconds: 0 },
        { path: 'C:/tmp/segment-1.mp3', offsetSeconds: 600 }
      ]),
      getAudioDuration: vi.fn().mockResolvedValue(610), cleanup: vi.fn().mockResolvedValue(undefined),
      resolveTranscriber
    })

    expect(resolveTranscriber).toHaveBeenCalledTimes(1)
    expect(resolveTranscriber).toHaveBeenCalledWith('sensevoice-small')
    expect(transcribe).toHaveBeenCalledTimes(2)
  })

  it('prepares RIFF PCM WAV segments only for the captured SenseVoice model', async () => {
    const segmentAudio = vi.fn().mockResolvedValue([{ path: 'C:/tmp/segment-000.wav', offsetSeconds: 0 }])
    const transcribe = vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'model output' }])

    await transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1demo', title: 'Demo', transcriptionModelId: 'sensevoice-small' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/job',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'ggml-model.bin' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
      segmentAudio,
      getAudioDuration: vi.fn().mockResolvedValue(10), cleanup: vi.fn().mockResolvedValue(undefined),
      resolveTranscriber: vi.fn().mockReturnValue(transcribe)
    })

    expect(segmentAudio).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'wav-pcm-16khz-mono'
    }))
  })

  it('keeps the default MP3 segment profile for Whisper-family models', async () => {
    const segmentAudio = vi.fn().mockResolvedValue([{ path: 'C:/tmp/segment-000.mp3', offsetSeconds: 0 }])

    await transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1demo', title: 'Demo', transcriptionModelId: 'whisper-small' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/job',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'ggml-model.bin' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
      segmentAudio,
      getAudioDuration: vi.fn().mockResolvedValue(10), cleanup: vi.fn().mockResolvedValue(undefined),
      transcribeSegment: vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'model output' }])
    })

    expect(segmentAudio).toHaveBeenCalledWith(expect.not.objectContaining({ profile: expect.anything() }))
  })

  it('returns the actual runtime reported by the captured model runner', async () => {
    const transcribe = Object.assign(
      vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'model output' }]),
      { runtime: Promise.resolve({ device: 'cpu' as const, computeType: 'int8' as const, fallbackMessage: 'GPU initialization failed; using CPU.' }) }
    )
    await expect(transcribeCurrentVideoAudio({
      request: { url: 'https://www.bilibili.com/video/BV1demo', title: 'Demo', transcriptionModelId: 'faster-whisper-large-v3' },
      session: { cookies: { get: vi.fn().mockResolvedValue([]) } }, tempDir: 'C:/tmp/job',
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'ggml-model.bin' }),
      exportCookies: vi.fn().mockResolvedValue({ path: 'C:/tmp/cookies.txt', cookieCount: 1 }),
      downloadAudio: vi.fn().mockResolvedValue({ audioPath: 'C:/tmp/audio.m4a' }),
      segmentAudio: vi.fn().mockResolvedValue([{ path: 'C:/tmp/segment.mp3', offsetSeconds: 0 }]),
      getAudioDuration: vi.fn().mockResolvedValue(10), cleanup: vi.fn().mockResolvedValue(undefined),
      resolveTranscriber: vi.fn().mockReturnValue(transcribe)
    })).resolves.toMatchObject({ runtime: { device: 'cpu', computeType: 'int8', fallbackMessage: 'GPU initialization failed; using CPU.' } })
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
