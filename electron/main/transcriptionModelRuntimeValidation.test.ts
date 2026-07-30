import { describe, expect, it, vi } from 'vitest'
import { validateTranscriptionModelRuntime } from './transcriptionModelRuntimeValidation'

describe('transcription model runtime validation', () => {
  it('uses the controlled development Python script for a CPU faster-whisper health check', async () => {
    const runProcess = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, device: 'cpu', computeType: 'int8' }),
      stderr: ''
    })

    await validateTranscriptionModelRuntime('faster-whisper-large-v3', {
      modelDirectory: 'C:/models/large-v3',
      python: { command: 'C:/Python/python.exe', scriptPath: 'C:/repo/tools/transcribe_faster_whisper.py' }
    }, runProcess)

    expect(runProcess).toHaveBeenCalledWith('C:/Python/python.exe', [
      'C:/repo/tools/transcribe_faster_whisper.py', '--health-check', '--model', 'C:/models/large-v3',
      '--device', 'cpu', '--compute-type', 'int8', '--vad-filter', 'true'
    ])
  })

  it('rejects a helper health check that does not provide actual CPU evidence', async () => {
    await expect(validateTranscriptionModelRuntime('faster-whisper-large-v3', {
      modelDirectory: 'model', helperPath: 'helper.exe'
    }, vi.fn().mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' }))).rejects.toThrow('invalid health evidence')
  })

  it('runs SenseVoice against a temporary silent WAV instead of accepting --help as runtime evidence', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ text: '' }), stderr: '' })

    await validateTranscriptionModelRuntime('sensevoice-small', {
      helperPath: 'C:/models/sensevoice/runtime/bin/sherpa-onnx-offline.exe',
      modelDirectory: 'C:/models/sensevoice/model'
    }, runProcess)

    expect(runProcess).toHaveBeenCalledWith(
      'C:/models/sensevoice/runtime/bin/sherpa-onnx-offline.exe',
      expect.arrayContaining([
        '--sense-voice-model=C:/models/sensevoice/model/model.int8.onnx',
        '--tokens=C:/models/sensevoice/model/tokens.txt',
        expect.stringMatching(/bilimi-sensevoice-health-.*\\health\.wav$/u)
      ])
    )
  })
})
