import { describe, expect, it, vi } from 'vitest'
import {
  buildFasterWhisperArgs,
  classifyFasterWhisperRuntimeError,
  createFasterWhisperHelperSessionPool,
  createPythonCandidates,
  mapFasterWhisperOutputToSegments,
  transcribeAudioSegmentWithFasterWhisper
} from './fasterWhisperTranscription'

describe('fasterWhisperTranscription', () => {
  it('uses explicit CPU settings for helper execution unless an approved runtime is passed', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ segments: [] }), stderr: '' })

    await transcribeAudioSegmentWithFasterWhisper({
      path: 'segment.wav',
      offsetSeconds: 0,
      model: 'large-v3-model',
      helperPath: 'bilimi-faster-whisper.exe',
      runProcess
    })

    expect(runProcess).toHaveBeenCalledWith('bilimi-faster-whisper.exe', expect.arrayContaining([
      '--device', 'cpu', '--compute-type', 'int8'
    ]), expect.any(Object))
  })

  it('preserves traditional Chinese text instead of mutating faithful transcript output', () => {
    expect(mapFasterWhisperOutputToSegments({ segments: [{ start: 0, end: 1, text: '這是一個測試' }] }, 0))
      .toEqual([{ start: 0, end: 1, text: '這是一個測試' }])
  })
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

  it('preserves traditional Chinese transcript text', () => {
    expect(
      mapFasterWhisperOutputToSegments(
        {
          segments: [
            {
              start: 12,
              end: 17,
              text: '但由於各種各樣的單個，一群人是在7月23號才全部到齊的。'
            }
          ]
        },
        0
      )
    ).toEqual([
      {
        start: 12,
        end: 17,
        text: '但由於各種各樣的單個，一群人是在7月23號才全部到齊的。'
      }
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
      'int8',
      '--vad-filter',
      'true'
      ])
  })

  it('passes an installed model directory and conservative VAD to the controlled helper', () => {
    expect(
      buildFasterWhisperArgs({
        scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
        audioPath: 'C:/tmp/segment-000.mp3',
        model: 'C:/models/faster-whisper-large-v3'
      })
    ).toEqual(expect.arrayContaining([
      '--model', 'C:/models/faster-whisper-large-v3', '--vad-filter', 'true'
    ]))
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

    expect(runProcess).toHaveBeenCalledWith(
      'python',
      [
        'C:/app/tools/transcribe_faster_whisper.py',
        '--audio',
        'C:/tmp/segment-000.mp3',
        '--model',
        'small',
        '--device',
        'cpu',
        '--compute-type',
        'int8',
        '--vad-filter',
        'true'
      ],
      { signal: undefined }
    )
  })

  it('runs the self-contained helper without invoking a user Python installation', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ segments: [{ start: 0, end: 1, text: 'helper transcript' }] })
    })

    await expect(transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/segment-000.mp3',
      offsetSeconds: 10,
      model: 'C:/models/faster-whisper-large-v3',
      helperPath: 'C:/app/helpers/bilimi-faster-whisper.exe',
      runProcess
    })).resolves.toEqual([{ start: 10, end: 11, text: 'helper transcript' }])

    expect(runProcess).toHaveBeenCalledWith('C:/app/helpers/bilimi-faster-whisper.exe', [
      '--audio', 'C:/tmp/segment-000.mp3', '--model', 'C:/models/faster-whisper-large-v3',
      '--device', 'cpu', '--compute-type', 'int8', '--vad-filter', 'true'
    ], { signal: undefined })
  })

  it('reuses one helper session for sequential matching runtimes and closes it on cancellation', async () => {
    const firstSession = {
      transcribe: vi.fn().mockResolvedValue({ segments: [{ start: 0, end: 1, text: 'first' }] }),
      close: vi.fn(),
      closed: new Promise<void>(() => {})
    }
    const secondSession = {
      transcribe: vi.fn().mockResolvedValue({ segments: [{ start: 0, end: 1, text: 'second' }] }),
      close: vi.fn(),
      closed: new Promise<void>(() => {})
    }
    const startSession = vi.fn().mockReturnValueOnce(firstSession).mockReturnValueOnce(secondSession)
    const pool = createFasterWhisperHelperSessionPool({ startSession, idleTimeoutMs: 60_000 })

    await transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/one.mp3', offsetSeconds: 0, model: 'C:/models/large-v3',
      helperPath: 'C:/app/helpers/bilimi-faster-whisper.exe', helperSessionPool: pool
    })
    await transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/two.mp3', offsetSeconds: 5, model: 'C:/models/large-v3',
      helperPath: 'C:/app/helpers/bilimi-faster-whisper.exe', helperSessionPool: pool
    })

    expect(startSession).toHaveBeenCalledTimes(1)
    expect(firstSession.transcribe).toHaveBeenNthCalledWith(1, 'C:/tmp/one.mp3', undefined)
    expect(firstSession.transcribe).toHaveBeenNthCalledWith(2, 'C:/tmp/two.mp3', undefined)

    const controller = new AbortController()
    const canceled = transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/cancel.mp3', offsetSeconds: 0, model: 'C:/models/large-v3',
      helperPath: 'C:/app/helpers/bilimi-faster-whisper.exe', helperSessionPool: pool, signal: controller.signal
    })
    controller.abort()

    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' })
    expect(firstSession.close).toHaveBeenCalledTimes(1)
    pool.dispose()
  })

  it('keeps helper sessions separate when the captured model changes', async () => {
    const createSession = () => ({
      transcribe: vi.fn().mockResolvedValue({ segments: [] }),
      close: vi.fn(),
      closed: new Promise<void>(() => {})
    })
    const startSession = vi.fn().mockImplementation(createSession)
    const pool = createFasterWhisperHelperSessionPool({ startSession, idleTimeoutMs: 60_000 })

    await transcribeAudioSegmentWithFasterWhisper({ path: 'C:/tmp/one.mp3', offsetSeconds: 0, model: 'C:/models/turbo', helperPath: 'helper.exe', helperSessionPool: pool })
    await transcribeAudioSegmentWithFasterWhisper({ path: 'C:/tmp/two.mp3', offsetSeconds: 0, model: 'C:/models/large', helperPath: 'helper.exe', helperSessionPool: pool })
    await transcribeAudioSegmentWithFasterWhisper({ path: 'C:/tmp/three.mp3', offsetSeconds: 0, model: 'C:/models/turbo', helperPath: 'helper.exe', helperSessionPool: pool })

    expect(startSession).toHaveBeenCalledTimes(2)
    pool.dispose()
  })

  it('releases only GPU helper sessions at a job boundary', async () => {
    const cpu = { transcribe: vi.fn().mockResolvedValue({ segments: [] }), close: vi.fn(), closed: new Promise<void>(() => {}) }
    const gpu = { transcribe: vi.fn().mockResolvedValue({ segments: [] }), close: vi.fn(), closed: new Promise<void>(() => {}) }
    const pool = createFasterWhisperHelperSessionPool({ startSession: vi.fn().mockReturnValueOnce(cpu).mockReturnValueOnce(gpu), idleTimeoutMs: 60_000 })
    await transcribeAudioSegmentWithFasterWhisper({ path: 'cpu.wav', offsetSeconds: 0, helperPath: 'helper.exe', model: 'model', helperSessionPool: pool })
    await transcribeAudioSegmentWithFasterWhisper({ path: 'gpu.wav', offsetSeconds: 0, helperPath: 'helper.exe', model: 'model', device: 'cuda', computeType: 'float16', helperSessionPool: pool })
    pool.disposeGpu()
    expect(cpu.close).not.toHaveBeenCalled()
    expect(gpu.close).toHaveBeenCalledTimes(1)
    pool.dispose()
  })

  it('passes cancellation signals to the Python process', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({ segments: [] })
    })
    const controller = new AbortController()

    await transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/segment-000.mp3',
      offsetSeconds: 10,
      runProcess,
      scriptPath: 'C:/app/tools/transcribe_faster_whisper.py',
      pythonCommand: 'python',
      signal: controller.signal
    })

    expect(runProcess).toHaveBeenCalledWith('python', expect.any(Array), {
      signal: controller.signal
    })
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

    expect(runProcess).toHaveBeenNthCalledWith(
      1,
      'python',
      [
        'C:/app/tools/transcribe_faster_whisper.py',
        '--audio',
        'C:/tmp/segment-000.mp3',
        '--model',
        'small',
        '--device',
        'cpu',
        '--compute-type',
        'int8',
        '--vad-filter',
        'true'
      ],
      { signal: undefined }
    )
    expect(runProcess).toHaveBeenNthCalledWith(
      2,
      'python3',
      [
        'C:/app/tools/transcribe_faster_whisper.py',
        '--audio',
        'C:/tmp/segment-000.mp3',
        '--model',
        'small',
        '--device',
        'cpu',
        '--compute-type',
        'int8',
        '--vad-filter',
        'true'
      ],
      { signal: undefined }
    )
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

  it('classifies CUDA out-of-memory failures instead of flattening them into a generic helper error', async () => {
    await expect(transcribeAudioSegmentWithFasterWhisper({
      path: 'C:/tmp/segment-000.mp3',
      offsetSeconds: 0,
      helperPath: 'bilimi-faster-whisper.exe',
      device: 'cuda',
      computeType: 'float16',
      runProcess: vi.fn().mockResolvedValue({
        exitCode: 4,
        stderr: 'BILIMI_FASTER_WHISPER_TRANSCRIBE_ERROR: CUDA out of memory.',
        stdout: ''
      })
    })).rejects.toMatchObject({ kind: 'cuda-oom' })
  })

  it('does not label a CPU memory failure as a CUDA OOM', () => {
    expect(classifyFasterWhisperRuntimeError(new Error('out of memory'), 'cpu')).toBeUndefined()
  })

  it('classifies a missing CUDA library before helper ready as an initialization failure', () => {
    expect(classifyFasterWhisperRuntimeError(
      new Error('Could not load library cublas64_12.dll'),
      'cuda',
      'startup'
    )).toMatchObject({ kind: 'cuda-initialization' })
  })
})
