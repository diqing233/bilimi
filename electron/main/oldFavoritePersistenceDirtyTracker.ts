export type OldFavoritePersistenceFlushCheckpoint = ReadonlySet<number>
export type OldFavoritePersistenceMutation = number

export class OldFavoritePersistenceDirtyTracker {
  private nextMutationId = 0
  private readonly dirtyMutationIds = new Set<number>()

  beginMutation(): OldFavoritePersistenceMutation {
    this.nextMutationId += 1
    this.dirtyMutationIds.add(this.nextMutationId)
    return this.nextMutationId
  }

  finishMutation(mutation: OldFavoritePersistenceMutation): void {
    this.dirtyMutationIds.delete(mutation)
  }

  isDirty(): boolean {
    return this.dirtyMutationIds.size > 0
  }

  captureFlushCheckpoint(): OldFavoritePersistenceFlushCheckpoint {
    return new Set(this.dirtyMutationIds)
  }

  completeFlush(checkpoint: OldFavoritePersistenceFlushCheckpoint): void {
    for (const mutationId of checkpoint) this.dirtyMutationIds.delete(mutationId)
  }
}
