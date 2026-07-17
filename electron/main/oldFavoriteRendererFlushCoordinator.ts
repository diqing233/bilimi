import { randomUUID } from 'node:crypto'

export class OldFavoriteRendererFlushCoordinator {
  private dirty = false
  private pending = new Map<string, (success: boolean) => void>()

  markDirty() {
    this.dirty = true
  }

  isDirty() {
    return this.dirty
  }

  markClean() {
    this.dirty = false
  }

  requestFlush(send: (requestId: string) => void): Promise<boolean> {
    if (!this.dirty) return Promise.resolve(false)
    const requestId = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pending.set(requestId, (success) => {
        this.pending.delete(requestId)
        if (success) this.dirty = false
        resolve(success)
      })
      send(requestId)
    })
  }

  complete(requestId: string, success = true) {
    const settle = this.pending.get(requestId)
    if (!settle) return false
    settle(success)
    return true
  }
}
