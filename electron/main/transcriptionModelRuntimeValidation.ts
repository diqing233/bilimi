import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'
import type { TranscriptionModelId } from '../../src/shared/types'
import type { TranscriptionRuntimePaths } from './transcriptionModelManager'

type RuntimePaths = TranscriptionRuntimePaths

function errorFromResult(result: { exitCode: number; stdout: string; stderr: string }): Error | undefined {
  if (result.exitCode === 0) return undefined
  return new Error((result.stderr || result.stdout || 'Runtime health check failed.').trim())
}

/** Runs the installed model through its controlled local helper before exposing it as selectable. */
export async function validateTranscriptionModelRuntime(
  id: TranscriptionModelId,
  paths: RuntimePaths,
  runProcess: RunProcess = defaultRunProcess
): Promise<void> {
  if (id === 'whisper-small') return
  if (id === 'sensevoice-small') {
    if (!paths.helperPath) throw new Error('SenseVoice runtime helper is unavailable.')
    const healthDirectory = await mkdtemp(join(tmpdir(), 'bilimi-sensevoice-health-'))
    const audioPath = join(healthDirectory, 'health.wav')
    // 100 ms of PCM silence exercises the extracted executable, DLLs, and model files.
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(3200 + 36, 4)
    header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(16000, 24)
    header.writeUInt32LE(32000, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(3200, 40)
    await writeFile(audioPath, Buffer.concat([header, Buffer.alloc(3200)]))
    try {
      const result = await runProcess(paths.helperPath, [
        `--sense-voice-model=${paths.modelDirectory}/model.int8.onnx`,
        `--tokens=${paths.modelDirectory}/tokens.txt`,
        '--sense-voice-use-itn=false',
        audioPath
      ])
      const error = errorFromResult(result)
      if (error) throw new Error(`SenseVoice runtime validation failed: ${error.message}`)
    } finally {
      await rm(healthDirectory, { recursive: true, force: true })
    }
    return
  }
  const command = paths.helperPath ?? paths.python?.command
  const args = paths.helperPath
    ? ['--health-check', '--model', paths.modelDirectory, '--device', 'cpu', '--compute-type', 'int8', '--vad-filter', 'true']
    : paths.python
      ? [paths.python.scriptPath, '--health-check', '--model', paths.modelDirectory, '--device', 'cpu', '--compute-type', 'int8', '--vad-filter', 'true']
      : undefined
  if (!command || !args) throw new Error('Controlled faster-whisper runtime is unavailable.')
  const result = await runProcess(command, args)
  const error = errorFromResult(result)
  if (error) throw new Error(`faster-whisper runtime validation failed: ${error.message}`)
  try {
    const payload = JSON.parse(result.stdout) as { ok?: unknown; device?: unknown; computeType?: unknown }
    if (payload.ok !== true || payload.device !== 'cpu' || payload.computeType !== 'int8') {
      throw new Error('Controlled faster-whisper runtime returned invalid health evidence.')
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error('Controlled faster-whisper runtime returned invalid health evidence.')
  }
}
