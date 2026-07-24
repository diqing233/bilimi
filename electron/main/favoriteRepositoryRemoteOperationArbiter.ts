export type FavoriteRepositoryRemoteOperationPriority =
  | 'reconcile'
  | 'user-single'
  | 'archive-restore'
  | 'bulk'

export type FavoriteRepositoryRemoteOperationOptions = {
  priority: FavoriteRepositoryRemoteOperationPriority
  /** Operations with the same key replace an older operation that has not started. */
  videoKey?: string
}

export class FavoriteRepositoryRemoteOperationSupersededError extends Error {
  readonly code = 'REMOTE_OPERATION_SUPERSEDED'

  constructor() {
    super('A newer remote operation replaced this pending operation.')
    this.name = 'FavoriteRepositoryRemoteOperationSupersededError'
  }
}

/** Remote work is no longer accepted because destructive local maintenance is in progress. */
export class FavoriteRepositoryRemoteOperationUnavailableError extends Error {
  readonly code = 'REMOTE_OPERATION_UNAVAILABLE'

  constructor() {
    super('Remote operations are unavailable during destructive local maintenance.')
    this.name = 'FavoriteRepositoryRemoteOperationUnavailableError'
  }
}

type QueuedOperation<T> = FavoriteRepositoryRemoteOperationOptions & {
  sequence: number
  operation: () => Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}

type AccountQueue = {
  active: boolean
  queue: QueuedOperation<unknown>[]
}

const priorityRank: Record<FavoriteRepositoryRemoteOperationPriority, number> = {
  reconcile: 0,
  'user-single': 1,
  'archive-restore': 2,
  bulk: 3
}

/** Serializes remote Bilibili page work per account while leaving accounts isolated. */
export class FavoriteRepositoryRemoteOperationArbiter {
  private readonly queues = new Map<string, AccountQueue>()
  private nextSequence = 0
  private maintenanceRequested = 0
  private exclusiveTail = Promise.resolve()
  private idleWaiters: Array<() => void> = []
  private acceptingOperations = true

  /**
   * Preserves the original FIFO entry point for callers that do not need an
   * explicit priority or same-video replacement key.
   */
  run<T>(accountMid: string, operation: () => Promise<T>) {
    return this.enqueue(accountMid, { priority: 'bulk' }, operation)
  }

  enqueue<T>(
    accountMid: string,
    options: FavoriteRepositoryRemoteOperationOptions,
    operation: () => Promise<T>
  ): Promise<T> {
    if (!this.acceptingOperations) return Promise.reject(new FavoriteRepositoryRemoteOperationUnavailableError())
    const accountQueue = this.queues.get(accountMid) ?? { active: false, queue: [] }
    this.queues.set(accountMid, accountQueue)

    if (options.videoKey) {
      for (const queued of accountQueue.queue.filter((candidate) => candidate.videoKey === options.videoKey)) {
        accountQueue.queue.splice(accountQueue.queue.indexOf(queued), 1)
        queued.reject(new FavoriteRepositoryRemoteOperationSupersededError())
      }
    }

    const result = new Promise<T>((resolve, reject) => {
      accountQueue.queue.push({
        ...options,
        sequence: this.nextSequence++,
        operation,
        resolve,
        reject
      })
    })
    this.drain(accountMid, accountQueue)
    return result
  }

  /** Runs session-wide maintenance only after submitted remote work has settled. */
  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.maintenanceRequested += 1
    let release!: () => void
    const next = new Promise<void>((resolve) => { release = resolve })
    const previous = this.exclusiveTail
    this.exclusiveTail = previous.then(() => next)
    try {
      await previous
      await this.waitForIdle()
      return await operation()
    } finally {
      this.maintenanceRequested -= 1
      release()
      if (!this.maintenanceRequested) {
        for (const [accountMid, accountQueue] of this.queues) this.drain(accountMid, accountQueue)
      }
    }
  }

  /**
   * Stops accepting remote work, rejects operations that have not started, and
   * waits for the active operation to settle before destructive local cleanup.
   * Active work is deliberately not aborted: its remote outcome must be
   * checkpointed or recorded as unknown by its own operation handler.
   */
  async runDestructiveMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    this.acceptingOperations = false
    for (const accountQueue of this.queues.values()) {
      const pending = accountQueue.queue.splice(0)
      for (const queued of pending) queued.reject(new FavoriteRepositoryRemoteOperationUnavailableError())
    }
    return this.runExclusive(operation)
  }

  private drain(accountMid: string, accountQueue: AccountQueue) {
    if (accountQueue.active || this.maintenanceRequested) return
    const next = this.takeNext(accountQueue)
    if (!next) {
      this.queues.delete(accountMid)
      return
    }

    accountQueue.active = true
    void this.execute(accountMid, accountQueue, next)
  }

  private takeNext(accountQueue: AccountQueue) {
    accountQueue.queue.sort((left, right) => {
      const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority]
      return priorityDifference || left.sequence - right.sequence
    })
    return accountQueue.queue.shift()
  }

  private async execute(accountMid: string, accountQueue: AccountQueue, queued: QueuedOperation<unknown>) {
    try {
      // Invoke immediately so legacy run() retains its eager-start behavior.
      queued.resolve(await queued.operation())
    } catch (error) {
      queued.reject(error)
    } finally {
      accountQueue.active = false
      this.notifyIdleIfNeeded()
      this.drain(accountMid, accountQueue)
    }
  }

  private waitForIdle(): Promise<void> {
    if (![...this.queues.values()].some((queue) => queue.active)) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private notifyIdleIfNeeded() {
    if ([...this.queues.values()].some((queue) => queue.active)) return
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}

/** Shared process-wide gate for every Bilibili mutation and observation. */
export const favoriteRepositoryRemoteOperationArbiter = new FavoriteRepositoryRemoteOperationArbiter()
