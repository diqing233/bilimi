import type {
  OldFavoriteSessionsState,
  OldFavoriteTaskKind
} from '../../../../shared/oldFavoriteSessions'

const WORKSPACE_SNAPSHOT_KEYS = new Set([
  'preview',
  'baseScanPreview',
  'archiveEditorState',
  'archivePlanState',
  'segmentSnapshots',
  'collectionSnapshot',
  'recommendations',
  'deepSeek',
  'undo'
])

export function compactOldFavoriteSessionsForIpc(
  state: OldFavoriteSessionsState
): OldFavoriteSessionsState {
  return {
    ...state,
    batches: state.batches.map((batch) => ({
      ...batch,
      snapshot: Object.fromEntries(
        Object.entries(batch.snapshot).filter(([key]) => !WORKSPACE_SNAPSHOT_KEYS.has(key))
      )
    }))
  }
}

export type OldFavoriteSessionsGateway = {
  load: () => Promise<OldFavoriteSessionsState>
  save: (state: OldFavoriteSessionsState) => Promise<OldFavoriteSessionsState>
  claimLease: (
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string
  ) => Promise<boolean>
  releaseLease: (batchId: string, segmentId: string) => Promise<boolean>
  subscribe: (callback: (state: OldFavoriteSessionsState) => void) => () => void
}

function createDesktopGateway(): OldFavoriteSessionsGateway {
  const desktop = window.bilimiDesktop
  if (
    !desktop.loadOldFavoriteSessions ||
    !desktop.saveOldFavoriteSessions ||
    !desktop.claimOldFavoriteTaskLease ||
    !desktop.releaseOldFavoriteTaskLease ||
    !desktop.onOldFavoriteSessionsChanged
  ) {
    throw new Error('Old favorite session desktop API is unavailable.')
  }

  return {
    load: desktop.loadOldFavoriteSessions,
    save: desktop.saveOldFavoriteSessions,
    claimLease: desktop.claimOldFavoriteTaskLease,
    releaseLease: desktop.releaseOldFavoriteTaskLease,
    subscribe: desktop.onOldFavoriteSessionsChanged
  }
}

export class OldFavoriteTaskCoordinator {
  private readonly gateway: OldFavoriteSessionsGateway

  constructor(gateway?: OldFavoriteSessionsGateway) {
    this.gateway = gateway ?? createDesktopGateway()
  }

  async canRun(batchId: string, segmentId: string, accountMid: string): Promise<boolean> {
    const state = await this.gateway.load()
    const batch = state.batches.find((candidate) => candidate.id === batchId)
    return Boolean(
      batch &&
        batch.status === 'active' &&
        batch.accountMid === accountMid.trim() &&
        batch.segments.some((segment) => segment.id === segmentId) &&
        (!state.lease ||
          (state.lease.batchId === batchId && state.lease.segmentId === segmentId))
    )
  }

  acquire(
    batchId: string,
    segmentId: string,
    task: OldFavoriteTaskKind,
    accountMid: string
  ): Promise<boolean> {
    return this.gateway.claimLease(batchId, segmentId, task, accountMid)
  }

  release(batchId: string, segmentId: string): Promise<boolean> {
    return this.gateway.releaseLease(batchId, segmentId)
  }

  load(): Promise<OldFavoriteSessionsState> {
    return this.gateway.load()
  }

  save(state: OldFavoriteSessionsState): Promise<OldFavoriteSessionsState> {
    return this.gateway.save(compactOldFavoriteSessionsForIpc(state))
  }

  subscribe(callback: (state: OldFavoriteSessionsState) => void): () => void {
    return this.gateway.subscribe(callback)
  }
}
