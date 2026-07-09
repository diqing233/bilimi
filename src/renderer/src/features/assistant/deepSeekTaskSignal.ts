import type { DeepSeekTaskKind } from '@shared/types'

const DEEPSEEK_TASK_CHANNEL = 'bilimi.deepseek-task'

type DeepSeekTaskMessage = {
  task: DeepSeekTaskKind | null
}

function isDeepSeekTask(value: unknown): value is DeepSeekTaskKind | null {
  return (
    value === null ||
    value === 'comment' ||
    value === 'classification' ||
    value === 'summary' ||
    value === 'archive-organize' ||
    value === 'pet-chat' ||
    value === 'connection-test'
  )
}

export function publishDeepSeekTask(task: DeepSeekTaskKind | null) {
  if (typeof BroadcastChannel === 'undefined') {
    return
  }

  const channel = new BroadcastChannel(DEEPSEEK_TASK_CHANNEL)
  channel.postMessage({ task } satisfies DeepSeekTaskMessage)
  channel.close()
}

export function subscribeDeepSeekTask(callback: (task: DeepSeekTaskKind | null) => void) {
  if (typeof BroadcastChannel === 'undefined') {
    return () => undefined
  }

  const channel = new BroadcastChannel(DEEPSEEK_TASK_CHANNEL)
  channel.onmessage = (event) => {
    const task = (event.data as Partial<DeepSeekTaskMessage> | null)?.task
    if (isDeepSeekTask(task)) {
      callback(task)
    }
  }

  return () => channel.close()
}
