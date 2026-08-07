import type { DeepSeekTask, DeepSeekTaskKind } from '@shared/types'

const DEEPSEEK_TASK_CHANNEL = 'bilimi.deepseek-task'
const localTaskListeners = new Set<() => void>()
const localTasks = new Map<string, DeepSeekTask>()
let localTaskSnapshot: DeepSeekTask[] = []

function emitLocalTasks() {
  localTaskSnapshot = [...localTasks.values()]
  localTaskListeners.forEach((listener) => listener())
}

export function subscribeLocalDeepSeekTasks(listener: () => void) {
  localTaskListeners.add(listener)
  return () => localTaskListeners.delete(listener)
}

export function getLocalDeepSeekTasks() {
  return localTaskSnapshot
}

export function startLocalDeepSeekTask(task: DeepSeekTask) {
  localTasks.set(task.id, task)
  emitLocalTasks()
  return () => {
    localTasks.delete(task.id)
    emitLocalTasks()
  }
}

type DeepSeekTaskMessage = {
  action: 'start' | 'finish' | 'query' | 'heartbeat'
  task?: DeepSeekTask
  id?: string
}

function isDeepSeekTaskKind(value: unknown): value is DeepSeekTaskKind {
  return (
    value === 'comment' ||
    value === 'classification' ||
    value === 'summary' ||
    value === 'archive-organize' ||
    value === 'pet-chat' ||
    value === 'connection-test'
  )
}

function isDeepSeekTask(value: unknown): value is DeepSeekTask {
  const task = value as Partial<DeepSeekTask> | null
  return Boolean(
    task &&
      typeof task.id === 'string' &&
      task.id.trim() &&
      isDeepSeekTaskKind(task.kind) &&
      (task.detail === undefined || typeof task.detail === 'string')
  )
}

export function publishDeepSeekTask(task: DeepSeekTask) {
  if (typeof BroadcastChannel === 'undefined') {
    return () => undefined
  }

  const channel = new BroadcastChannel(DEEPSEEK_TASK_CHANNEL)
  let finished = false
  const heartbeat = window.setInterval(() => {
    channel.postMessage({ action: 'heartbeat', task } satisfies DeepSeekTaskMessage)
  }, 5_000)
  channel.onmessage = (event) => {
    const message = event.data as Partial<DeepSeekTaskMessage> | null
    if (!finished && message?.action === 'query') {
      channel.postMessage({ action: 'start', task } satisfies DeepSeekTaskMessage)
    }
  }
  channel.postMessage({ action: 'start', task } satisfies DeepSeekTaskMessage)

  return () => {
    if (finished) return
    finished = true
    window.clearInterval(heartbeat)
    channel.postMessage({ action: 'finish', id: task.id } satisfies DeepSeekTaskMessage)
    window.setTimeout(() => channel.close(), 0)
  }
}

export function subscribeDeepSeekTasks(callback: (tasks: DeepSeekTask[]) => void) {
  if (typeof BroadcastChannel === 'undefined') {
    return () => undefined
  }

  const tasks = new Map<string, { task: DeepSeekTask; lastSeenAt: number }>()
  const emitTasks = () => callback([...tasks.values()].map((entry) => entry.task))
  const channel = new BroadcastChannel(DEEPSEEK_TASK_CHANNEL)
  channel.onmessage = (event) => {
    const message = event.data as Partial<DeepSeekTaskMessage> | null
    if (
      (message?.action === 'start' || message?.action === 'heartbeat') &&
      isDeepSeekTask(message.task)
    ) {
      tasks.set(message.task.id, { task: message.task, lastSeenAt: Date.now() })
      emitTasks()
    } else if (message?.action === 'finish' && typeof message.id === 'string') {
      tasks.delete(message.id)
      emitTasks()
    }
  }

  const expirationTimer = window.setInterval(() => {
    const expirationThreshold = Date.now() - 15_000
    let changed = false
    for (const [id, entry] of tasks) {
      if (entry.lastSeenAt < expirationThreshold) {
        tasks.delete(id)
        changed = true
      }
    }
    if (changed) emitTasks()
  }, 5_000)
  channel.postMessage({ action: 'query' } satisfies DeepSeekTaskMessage)

  return () => {
    window.clearInterval(expirationTimer)
    channel.close()
  }
}
