/** Serializes remote Bilibili page work per account while leaving accounts isolated. */
export class FavoriteRepositoryRemoteOperationArbiter {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(accountMid: string, operation: () => Promise<T>) {
    const previous = this.tails.get(accountMid) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(accountMid, tail)
    await previous
    try {
      return await operation()
    } finally {
      release?.()
      if (this.tails.get(accountMid) === tail) this.tails.delete(accountMid)
    }
  }
}
