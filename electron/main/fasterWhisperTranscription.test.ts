import { describe, expect, it, vi } from 'vitest'
import {
  buildFasterWhisperArgs,
  createPythonCandidates,
  mapFasterWhisperOutputToSegments,
  transcribeAudioSegmentWithFasterWhisper
} from './fasterWhisperTranscription'

describe('fasterWhisperTranscription', () => {
  it('maps faster-whisper JSON output to transcript segments with offsets', () => {
    expect(
      mapFasterWhisperOutputToSegments(
        {
          segments: [
            { start: 0, end: 2.4, text: ' first line ' },
            { start: 2.5, end: 4, text: '' },
            { start: 4, end: 6, text: 'second line' }
          ]
        },
        600
      )
    ).toEqual([
      { start: 600, end: 602.4, text: 'first line' },
      { start: 604, end: 606, text: 'second line' }
    ])
  })

  it('builds Python script arguments for a local audio segment', () => {
    expect(
      buildFasterWhisperArgs({
        scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
        audioPath: 'C:/tmp/segment-000.mp3',
        model: 'small'
      })
    ).toEqual([
      'C:/app/tools/transcribe_faster_whisper.py',
      '--audio',
      'C:/tmp/segment-000.mp3',
      '--model',
      'small',
      '--device',
      'cpu',
      '--compute-type',
      'int8'
    ])
  })

  it('orders Python candidates with env override and Windows launcher fallback', () => {
    expect(
      createPythonCandidates({
        envPythonPath: 'C:/Python312/python.exe',
        platform: 'win32'
      })
    ).toEqual([
      { command: 'C:/Python312/python.exe', argsPrefix: [] },
      { command: 'python', argsPrefix: [] },
      { command: 'python3', argsPrefix: [] },
      { command: 'py', argsPrefix: ['-3'] }
    ])
  })

  it('runs the Python faster-whisper script and parses transcript output', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        segments: [{ start: 1, end: 3, text: 'local transcript' }]
      })
    })

    await expect(
      transcribeAudioSegmentWithFasterWhisper({
        path: 'C:/tmp/segment-000.mp3',
        offsetSeconds: 10,
        runProcess,
        scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
        pythonCommand: 'python'
      })
    ).resolves.toEqual([{ start: 11, end: 13, text: 'local transcript' }])

    expect(runProcess).toHaveBeenCalledWith('python', [
      'C:/app/tools/transcribe_faster_whisper.py',
      '--audio',
      'C:/tmp/segment-000.mp3',
      '--model',
      'small',
      '--device',
      'cpu',
      '--compute-type',
      'int8'
    ])
  })

  it('falls back to the next Python candidate when a command cannot start', async () => {
    const runProcess = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }))
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          segments: [{ start: 0, end: 1, text: 'fallback transcript' }]
        })
      })

    await expect(
      transcribeAudioSegmentWithFasterWhisper({
        path: 'C:/tmp/segment-000.mp3',
        offsetSeconds: 5,
        runProcess,
        scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
        pythonCandidates: [
          { command: 'python', argsPrefix: [] },
          { command: 'python3', argsPrefix: [] }
        ]
      })
    ).resolves.toEqual([{ start: 5, end: 6, text: 'fallback transcript' }])

    expect(runProcess).toHaveBeenNthCalledWith(1, 'python', [
      'C:/app/tools/transcribe_faster_whisper.py',
      '--audio',
      'C:/tmp/segment-000.mp3',
      '--model',
      'small',
      '--device',
      'cpu',
      '--compute-type',
      'int8'
    ])
    expect(runProcess).toHaveBeenNthCalledWith(2, 'python3', [
      'C:/app/tools/transcribe_faster_whisper.py',
      '--audio',
      'C:/tmp/segment-000.mp3',
      '--model',
      'small',
      '--device',
      'cpu',
      '--compute-type',
      'int8'
    ])
  })

  it('returns a readable error when faster-whisper is not installed', async () => {
    await expect(
      transcribeAudioSegmentWithFasterWhisper({
        path: 'C:/tmp/segment-000.mp3',
        offsetSeconds: 0,
        runProcess: vi.fn().mockResolvedValue({
          exitCode: 3,
          stderr: 'ModuleNotFoundError: No module named faster_whisper',
          stdout: ''
        }),
        scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
        pythonCommand: 'python'
      })
    ).rejects.toThrow('faster-whisper is not installed')
  })
})
