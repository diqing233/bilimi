import { runProcess as defaultRunProcess, type RunProcess } from './audioDownload'

export type FasterWhisperGpuProbe =
  | { status: 'available'; device: 'cuda'; computeType: 'float16' | 'int8_float16'; gpuName: string; driverVersion: string; memoryMiB: number; freeMemoryMiB: number }
  | { status: 'cpu-only'; reason: string }

const MINIMUM_FREE_CUDA_MEMORY_MIB = 1024

function readNvidiaMemoryMiB(stdout: string): { name: string; driverVersion: string; total: number; free: number } | null {
  const adapters = stdout.split(/\r?\n/gu).map((line) => line.trim().match(/^(\d+),\s*([^,]+),\s*([^,]+),\s*(\d+),\s*(\d+)$/u)).filter(Boolean)
    .map((match) => ({ name: match?.[2]?.trim() ?? 'NVIDIA GPU', driverVersion: match?.[3]?.trim() ?? '', total: Number(match?.[4]), free: Number(match?.[5]) }))
    .filter((adapter) => adapter.total > 0 && adapter.free >= MINIMUM_FREE_CUDA_MEMORY_MIB)
  return adapters.sort((left, right) => right.free - left.free)[0] ?? null
}

export async function probeFasterWhisperCudaRuntime({
  helperPath,
  helperArgsPrefix = [],
  modelDirectory,
  runProcess = defaultRunProcess
}: {
  helperPath: string
  helperArgsPrefix?: string[]
  modelDirectory: string
  runProcess?: RunProcess
}): Promise<FasterWhisperGpuProbe> {
  let nvidia
  try {
    nvidia = await runProcess('nvidia-smi', ['--query-gpu=index,name,driver_version,memory.total,memory.free', '--format=csv,noheader,nounits'])
  } catch {
    return { status: 'cpu-only', reason: 'NVIDIA CUDA runtime was not detected.' }
  }
  const memory = nvidia.exitCode === 0 ? readNvidiaMemoryMiB(nvidia.stdout) : null
  if (!memory) return nvidia.exitCode === 0
    ? { status: 'cpu-only', reason: 'NVIDIA GPU free memory is insufficient for the controlled self-test.' }
    : { status: 'cpu-only', reason: 'NVIDIA CUDA runtime was not detected.' }

  let selfTest
  try {
    selfTest = await runProcess(helperPath, [
      ...helperArgsPrefix,
      '--health-check', '--model', modelDirectory, '--device', 'cuda', '--compute-type', 'float16', '--vad-filter', 'true'
    ])
  } catch {
    return { status: 'cpu-only', reason: 'CUDA inference self-test failed.' }
  }
  if (selfTest.exitCode !== 0) {
    const failure = `${selfTest.stderr}\n${selfTest.stdout}`.toLowerCase()
    if (failure.includes('cublas64_12.dll')) return { status: 'cpu-only', reason: 'CUDA 12 cuBLAS runtime is missing; CPU will be used.' }
    if (failure.includes('cudnn') && /(not found|cannot be loaded|could not load|missing)/u.test(failure)) return { status: 'cpu-only', reason: 'CUDA cuDNN runtime is missing; CPU will be used.' }
    return { status: 'cpu-only', reason: 'CUDA inference self-test failed; CPU will be used.' }
  }
  try {
    const payload = JSON.parse(selfTest.stdout) as { ok?: unknown; device?: unknown; computeType?: unknown }
    if (payload.ok === true && payload.device === 'cuda' && (payload.computeType === 'float16' || payload.computeType === 'int8_float16')) {
      return { status: 'available', device: 'cuda', computeType: payload.computeType, gpuName: memory.name, driverVersion: memory.driverVersion, memoryMiB: memory.total, freeMemoryMiB: memory.free }
    }
  } catch {
    // The controlled helper must return structured evidence of its actual runtime.
  }
  return { status: 'cpu-only', reason: 'CUDA inference self-test failed.' }
}
