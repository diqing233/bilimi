import { describe, expect, it, vi } from 'vitest'
import { probeFasterWhisperCudaRuntime } from './fasterWhisperGpu'

describe('probeFasterWhisperCudaRuntime', () => {
  it('requires NVIDIA driver evidence and a successful CUDA inference health check', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4070, 551.23, 12288, 8192\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, device: 'cuda', computeType: 'float16' }), stderr: '' })

    await expect(probeFasterWhisperCudaRuntime({
      helperPath: 'C:/app/bilimi-faster-whisper.exe',
      modelDirectory: 'C:/models/large-v3',
      runProcess
    })).resolves.toEqual({ status: 'available', device: 'cuda', computeType: 'float16', gpuName: 'NVIDIA GeForce RTX 4070', driverVersion: '551.23', memoryMiB: 12288, freeMemoryMiB: 8192 })
    expect(runProcess).toHaveBeenNthCalledWith(1, 'nvidia-smi', ['--query-gpu=index,name,driver_version,memory.total,memory.free', '--format=csv,noheader,nounits'])
    expect(runProcess).toHaveBeenNthCalledWith(2, 'C:/app/bilimi-faster-whisper.exe', [
      '--health-check', '--model', 'C:/models/large-v3', '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ])
  })

  it('runs the same CUDA self-test through the controlled development Python helper', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4060 Ti, 595.97, 8188, 6500\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ ok: true, device: 'cuda', computeType: 'float16' }), stderr: '' })

    await expect(probeFasterWhisperCudaRuntime({
      helperPath: 'python', helperArgsPrefix: ['C:/repo/tools/transcribe_faster_whisper.py'], modelDirectory: 'C:/models/turbo', runProcess
    })).resolves.toMatchObject({ status: 'available', gpuName: 'NVIDIA GeForce RTX 4060 Ti' })
    expect(runProcess).toHaveBeenNthCalledWith(2, 'python', [
      'C:/repo/tools/transcribe_faster_whisper.py', '--health-check', '--model', 'C:/models/turbo', '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ])
  })

  it('returns an actionable missing CUDA library reason', async () => {
    const runProcess = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA GeForce RTX 4060 Ti, 595.97, 8188, 6500\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 4, stdout: '', stderr: 'Library cublas64_12.dll is not found or cannot be loaded' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'python', modelDirectory: 'model', runProcess }))
      .resolves.toEqual({ status: 'cpu-only', reason: 'CUDA 12 cuBLAS runtime is missing; CPU will be used.' })
  })

  it('does not claim GPU availability when NVIDIA detection or the inference self-test fails', async () => {
    const noNvidia = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess: noNvidia })).resolves.toEqual({ status: 'cpu-only', reason: 'NVIDIA CUDA runtime was not detected.' })

    const selfTestFailure = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 8192\n', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 4, stdout: '', stderr: 'CUDA initialization failed' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess: selfTestFailure })).resolves.toEqual({ status: 'cpu-only', reason: 'CUDA inference self-test failed; CPU will be used.' })
  })

  it('rejects CUDA when no NVIDIA adapter has enough currently free memory', async () => {
    const runProcess = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '0, NVIDIA RTX, 551.23, 12288, 256\n1, NVIDIA RTX, 551.23, 8192, 512\n', stderr: '' })
    await expect(probeFasterWhisperCudaRuntime({ helperPath: 'helper.exe', modelDirectory: 'model', runProcess })).resolves.toEqual({ status: 'cpu-only', reason: 'NVIDIA GPU free memory is insufficient for the controlled self-test.' })
    expect(runProcess).toHaveBeenCalledTimes(1)
  })
})
