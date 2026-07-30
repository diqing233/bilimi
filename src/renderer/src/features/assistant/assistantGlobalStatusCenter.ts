import type { TranscriptionModelId, TranscriptionModelInstallProgress } from '@shared/types'

export type GlobalFeedbackHistoryItem = { message: string; occurredAt: number; count: number }
type RuntimeStatus = { label: string; detail: string; tone: 'ok' | 'warn' | 'error' | 'running' | 'idle' }
export type PersistentStatusTask = { id: string; label: string; detail: string; destination: 'transcription' | 'deepseek' | 'ledger' }

const MODEL_LABELS: Record<TranscriptionModelId, string> = {
  'sensevoice-small': 'SenseVoiceSmall',
  'whisper-small': 'Whisper small',
  'faster-whisper-large-v3-turbo': 'faster-whisper large-v3-turbo',
  'faster-whisper-large-v3': 'faster-whisper large-v3'
}
const ACTIVE_MODEL_STAGES = new Set<TranscriptionModelInstallProgress['stage']>([
  'connecting', 'downloading', 'downloading-part', 'verifying', 'merging-parts', 'installing', 'validating-runtime'
])

export function appendGlobalFeedbackHistory(history: GlobalFeedbackHistoryItem[], message: string, occurredAt = Date.now()): GlobalFeedbackHistoryItem[] {
  const trimmed = message.trim()
  if (!trimmed) return history
  const [newest, ...rest] = history
  if (newest?.message === trimmed) return [{ ...newest, occurredAt, count: newest.count + 1 }, ...rest]
  return [{ message: trimmed, occurredAt, count: 1 }, ...history].slice(0, 8)
}

export function createPersistentStatusTasks({ modelProgress, transcription, deepSeek, ledger }: {
  modelProgress?: TranscriptionModelInstallProgress
  transcription?: RuntimeStatus
  deepSeek?: RuntimeStatus
  ledger?: RuntimeStatus
}): PersistentStatusTask[] {
  const tasks: PersistentStatusTask[] = []
  if (modelProgress && ACTIVE_MODEL_STAGES.has(modelProgress.stage)) {
    const percent = modelProgress.percentage === undefined ? '' : ` · ${modelProgress.percentage}%`
    tasks.push({ id: 'model-download', label: `${MODEL_LABELS[modelProgress.id]} 下载中${percent}`, detail: modelProgress.sourceFallbackMessage || '模型下载、校验或安装尚未完成。', destination: 'transcription' })
  }
  for (const [id, status, destination] of [
    ['transcription', transcription, 'transcription'], ['deepseek', deepSeek, 'deepseek'], ['ledger', ledger, 'ledger']
  ] as const) {
    if (status?.tone === 'running' || status?.tone === 'error') tasks.push({ id, label: status.label, detail: status.detail, destination })
  }
  return tasks
}
