import type { AssistantAutomationResult } from '@shared/types'

export type OldFavoriteScanPreparationProbe =
  | { status: 'ready' }
  | { status: 'waiting' }
  | { status: 'fatal'; message: string }

type OldFavoriteScanPreparationOptions = {
  intervalMs?: number
  timeoutMs?: number
  now?: () => number
  wait?: (delayMs: number) => Promise<void>
}

const waitForDelay = (delayMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))

export async function prepareOldFavoriteScan(
  probe: () => Promise<OldFavoriteScanPreparationProbe>,
  options: OldFavoriteScanPreparationOptions = {}
): Promise<AssistantAutomationResult> {
  const intervalMs = options.intervalMs ?? 250
  const timeoutMs = options.timeoutMs ?? 60_000
  const now = options.now ?? Date.now
  const wait = options.wait ?? waitForDelay
  const startedAt = now()

  while (now() - startedAt < timeoutMs) {
    const result = await probe()
    if (result.status === 'ready') {
      return {
        ok: true,
        steps: ['bilibili-runtime:ready'],
        missingTargets: [],
        message: 'B站收藏环境已准备好。'
      }
    }
    if (result.status === 'fatal') {
      return {
        ok: false,
        steps: [],
        missingTargets: ['bilibili-login'],
        message: result.message
      }
    }
    await wait(Math.min(intervalMs, Math.max(0, timeoutMs - (now() - startedAt))))
  }

  return {
    ok: false,
    steps: [],
    missingTargets: ['bilibili-runtime'],
    message: 'B站页面或登录状态尚未准备好，请确认登录后重试。'
  }
}
