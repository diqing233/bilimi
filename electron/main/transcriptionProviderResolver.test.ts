import { describe, expect, it, vi } from 'vitest'
import { createTranscriptionProviderResolver } from './transcriptionProviderResolver'

describe('transcription provider resolver', () => {
  it('uses the bundled whisper.cpp implementation only for the captured whisper-small model', async () => {
    const whisper = vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'hello' }])
    const resolve = createTranscriptionProviderResolver({
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'model.bin' }),
      transcribeWhisper: whisper
    })

    await expect(resolve('whisper-small')({ path: 'segment.wav', offsetSeconds: 0 })).resolves.toEqual([
      { start: 0, end: 1, text: 'hello' }
    ])
    expect(whisper).toHaveBeenCalledWith(expect.objectContaining({ cliPath: 'whisper-cli', modelPath: 'model.bin' }))
  })

  it('uses a verified machine-wide Whisper download when one is available', async () => {
    const whisper = vi.fn().mockResolvedValue([])
    const resolve = createTranscriptionProviderResolver({
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'legacy.bin' }),
      resolveWhisperModelPath: () => 'C:/models/whisper-small/ggml-small.bin',
      transcribeWhisper: whisper
    })

    await resolve('whisper-small')({ path: 'segment.wav', offsetSeconds: 0 })
    expect(whisper).toHaveBeenCalledWith(expect.objectContaining({ modelPath: 'C:/models/whisper-small/ggml-small.bin' }))
  })

  it('does not silently replace an unavailable explicitly selected model', async () => {
    const whisper = vi.fn()
    const resolve = createTranscriptionProviderResolver({
      resolveTools: () => ({ ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', whisperCliPath: 'whisper-cli', whisperModelPath: 'model.bin' }),
      transcribeWhisper: whisper
    })

    await expect(resolve('sensevoice-small')({ path: 'segment.wav', offsetSeconds: 0 }))
      .rejects.toThrow('SenseVoiceSmall is not available')
    expect(whisper).not.toHaveBeenCalled()
  })

  it('uses the verified local SenseVoice runtime for its captured model', async () => {
    const senseVoice = vi.fn().mockResolvedValue([{ start: 2, end: 3, text: '你好' }])
    const resolve = createTranscriptionProviderResolver({
      resolveSenseVoicePaths: () => ({ helperPath: 'sherpa-onnx-offline.exe', modelDirectory: 'sensevoice-model' }),
      transcribeSenseVoice: senseVoice
    })

    await expect(resolve('sensevoice-small')({ path: 'segment.wav', offsetSeconds: 2 })).resolves.toEqual([
      { start: 2, end: 3, text: '你好' }
    ])
    expect(senseVoice).toHaveBeenCalledWith(expect.objectContaining({
      helperPath: 'sherpa-onnx-offline.exe',
      modelDirectory: 'sensevoice-model'
    }))
  })

  it('uses the shared self-contained faster-whisper helper only with verified model paths', async () => {
    const fasterWhisper = vi.fn().mockResolvedValue([{ start: 0, end: 1, text: 'mixed English 中文' }])
    const resolve = createTranscriptionProviderResolver({
      resolveFasterWhisperPaths: () => ({ helperPath: 'bilimi-faster-whisper.exe', modelDirectory: 'large-v3-model' }),
      transcribeFasterWhisper: fasterWhisper
    })

    await expect(resolve('faster-whisper-large-v3')({ path: 'segment.wav', offsetSeconds: 0 })).resolves.toEqual([
      { start: 0, end: 1, text: 'mixed English 中文' }
    ])
    expect(fasterWhisper).toHaveBeenCalledWith(expect.objectContaining({
      helperPath: 'bilimi-faster-whisper.exe', model: 'large-v3-model'
    }))
  })

  it('uses CUDA only when the controlled runtime policy has verified it', async () => {
    const fasterWhisper = vi.fn().mockResolvedValue([])
    const resolve = createTranscriptionProviderResolver({
      resolveFasterWhisperPaths: () => ({ helperPath: 'bilimi-faster-whisper.exe', modelDirectory: 'large-v3-model' }),
      resolveFasterWhisperRuntime: vi.fn().mockResolvedValue({ device: 'cuda', computeType: 'float16' }),
      transcribeFasterWhisper: fasterWhisper
    })

    await resolve('faster-whisper-large-v3')({ path: 'segment.wav', offsetSeconds: 0 })
    expect(fasterWhisper).toHaveBeenCalledWith(expect.objectContaining({ device: 'cuda', computeType: 'float16' }))
  })

  it('does not reuse a prior job runtime decision across resolver instances', () => {
    const fasterWhisper = vi.fn()
    const resolveFasterWhisperPaths = vi.fn(() => ({
      helperPath: 'bilimi-faster-whisper.exe',
      modelDirectory: 'large-v3-model'
    }))

    const first = createTranscriptionProviderResolver({ resolveFasterWhisperPaths, transcribeFasterWhisper: fasterWhisper })
    const second = createTranscriptionProviderResolver({ resolveFasterWhisperPaths, transcribeFasterWhisper: fasterWhisper })

    expect(first('faster-whisper-large-v3')).not.toBe(second('faster-whisper-large-v3'))
  })

  it('retries a CUDA helper initialization failure once on CPU and records visible fallback feedback', async () => {
    const initializationFailure = Object.assign(new Error('CUDA initialization failed before inference.'), {
      kind: 'cuda-initialization'
    })
    const fasterWhisper = vi.fn()
      .mockRejectedValueOnce(initializationFailure)
      .mockResolvedValueOnce([{ start: 0, end: 1, text: 'CPU fallback transcript' }])
    const resolve = createTranscriptionProviderResolver({
      resolveFasterWhisperPaths: () => ({ helperPath: 'bilimi-faster-whisper.exe', modelDirectory: 'large-v3-model' }),
      resolveFasterWhisperRuntime: vi.fn().mockResolvedValue({ device: 'cuda', computeType: 'float16' }),
      transcribeFasterWhisper: fasterWhisper
    })

    const runner = resolve('faster-whisper-large-v3')
    await expect(runner({ path: 'segment.wav', offsetSeconds: 0 })).resolves.toEqual([
      { start: 0, end: 1, text: 'CPU fallback transcript' }
    ])
    expect(fasterWhisper).toHaveBeenNthCalledWith(1, expect.objectContaining({ device: 'cuda', computeType: 'float16' }))
    expect(fasterWhisper).toHaveBeenNthCalledWith(2, expect.objectContaining({ device: 'cpu', computeType: 'int8' }))
    await expect(runner.runtime).resolves.toMatchObject({
      device: 'cpu',
      computeType: 'int8',
      fallbackMessage: expect.stringContaining('CPU')
    })
  })
})
