import { describe, expect, it, vi } from 'vitest'
import {
  buildLocalWhisperArgs,
  mapLocalWhisperOutputToSegments,
  transcribeAudioSegmentWithLocalWhisper
} from './localWhisperTranscription'

describe('localWhisperTranscription', () => {
  it('builds whisper.cpp arguments for a bundled offline model', () => {
    expect(
      buildLocalWhisperArgs({
        cliPath: 'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
        modelPath: 'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        audioPath: 'C:/tmp/segment-000.wav',
        outputPathWithoutExtension: 'C:/tmp/segment-000',
        availableThreads: 8
      })
    ).toEqual([
      '-m',
      'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
      '-f',
      'C:/tmp/segment-000.wav',
      '-l',
      'auto',
      '-t',
      '8',
      '-oj',
      '-ojf',
      '-of',
      'C:/tmp/segment-000',
      '-np'
    ])
  })

  it('uses all available whisper.cpp threads when transcription is unlimited', () => {
    expect(
      buildLocalWhisperArgs({
        cliPath: 'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
        modelPath: 'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        audioPath: 'C:/tmp/segment-000.wav',
        outputPathWithoutExtension: 'C:/tmp/segment-000',
        threadLimit: 'unlimited',
        availableThreads: 12
      })
    ).toEqual(expect.arrayContaining(['-t', '12']))
  })

  it('passes the selected whisper.cpp thread limit', () => {
    expect(
      buildLocalWhisperArgs({
        cliPath: 'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
        modelPath: 'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        audioPath: 'C:/tmp/segment-000.wav',
        outputPathWithoutExtension: 'C:/tmp/segment-000',
        threadLimit: 2
      })
    ).toEqual([
      '-m',
      'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
      '-f',
      'C:/tmp/segment-000.wav',
      '-l',
      'auto',
      '-t',
      '2',
      '-oj',
      '-ojf',
      '-of',
      'C:/tmp/segment-000',
      '-np'
    ])
  })

  it('maps whisper.cpp JSON output to transcript segments with offsets', () => {
    expect(
      mapLocalWhisperOutputToSegments(
        {
          transcription: [
            {
              timestamps: { from: '00:00:01,200', to: '00:00:03,400' },
              text: ' 第一行 '
            },
            {
              timestamps: { from: '00:00:04,000', to: '00:00:05,500' },
              text: '第二行'
            },
            {
              timestamps: { from: '00:00:06,000', to: '00:00:07,000' },
              text: ''
            }
          ]
        },
        600
      )
    ).toEqual([
      { start: 601.2, end: 603.4, text: '第一行' },
      { start: 604, end: 605.5, text: '第二行' }
    ])
  })

  it('normalizes traditional Chinese transcript text to simplified Chinese', () => {
    expect(
      mapLocalWhisperOutputToSegments(
        {
          transcription: [
            {
              timestamps: { from: '00:00:00,000', to: '00:00:02,000' },
              text: '這是一個測試'
            }
          ]
        },
        0
      )
    ).toEqual([{ start: 0, end: 2, text: '这是一个测试' }])
  })

  it('runs bundled whisper.cpp and parses the generated JSON file', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' })
    const readTextFile = vi.fn().mockResolvedValue(
      JSON.stringify({
        transcription: [
          {
            timestamps: { from: '00:00:02,000', to: '00:00:04,000' },
            text: 'local transcript'
          }
        ]
      })
    )

    await expect(
      transcribeAudioSegmentWithLocalWhisper({
        path: 'C:/tmp/segment-000.wav',
        offsetSeconds: 10,
        cliPath: 'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
        modelPath: 'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        runProcess,
        readTextFile
      })
    ).resolves.toEqual([{ start: 12, end: 14, text: 'local transcript' }])

    expect(runProcess).toHaveBeenCalledWith(
      'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
      [
        '-m',
        'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        '-f',
        'C:/tmp/segment-000.wav',
        '-l',
        'auto',
        '-t',
        expect.stringMatching(/^\d+$/),
        '-oj',
        '-ojf',
        '-of',
        'C:/tmp/segment-000',
        '-np'
      ],
      { signal: undefined, timeoutMs: 30 * 60_000 }
    )
    expect(readTextFile).toHaveBeenCalledWith('C:/tmp/segment-000.json', 'utf8')
  })

  it('returns a Chinese error when bundled whisper.cpp fails', async () => {
    await expect(
      transcribeAudioSegmentWithLocalWhisper({
        path: 'C:/tmp/segment-000.wav',
        offsetSeconds: 0,
        cliPath: 'C:/app/resources/tools/win32/whisper/whisper-cli.exe',
        modelPath: 'C:/app/resources/tools/win32/whisper/models/ggml-small.bin',
        runProcess: vi.fn().mockResolvedValue({
          exitCode: 1,
          stderr: 'failed to load model',
          stdout: ''
        })
      })
    ).rejects.toThrow('本地转写组件运行失败')
  })
})
