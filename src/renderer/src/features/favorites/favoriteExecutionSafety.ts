export type FavoriteFormalTargetResult = {
  targetId: string
  state: 'succeeded' | 'failed' | 'already-member' | 'unknown'
}

type FavoriteExecutionSafetyOptions = {
  expectedFormalTargetIds: string[]
  targetResults: FavoriteFormalTargetResult[]
  formalMembershipComplete: boolean
  stagingFolderIds: string[]
}

const uniqueStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

export function evaluateFavoriteExecutionSafety(options: FavoriteExecutionSafetyOptions) {
  if (!options.formalMembershipComplete) {
    return {
      canExecute: false as const,
      status: 'blocked' as const,
      reason: 'formal-membership-incomplete' as const,
      removeFromStagingFolderIds: [] as string[]
    }
  }

  const expectedTargets = new Set(uniqueStrings(options.expectedFormalTargetIds))
  const relevantResults = options.targetResults.filter((result) => expectedTargets.has(result.targetId))
  const landedFormalTargetIds = uniqueStrings(
    relevantResults
      .filter((result) => result.state === 'succeeded' || result.state === 'already-member')
      .map((result) => result.targetId)
  )
  const failedFormalTargetIds = uniqueStrings(
    relevantResults.filter((result) => result.state === 'failed').map((result) => result.targetId)
  )
  const unknownFormalTargetIds = uniqueStrings(
    relevantResults.filter((result) => result.state === 'unknown').map((result) => result.targetId)
  )

  if (unknownFormalTargetIds.length > 0) {
    return {
      canExecute: true as const,
      status: 'result-unknown' as const,
      landedFormalTargetIds,
      unknownFormalTargetIds,
      removeFromStagingFolderIds: [] as string[]
    }
  }
  if (landedFormalTargetIds.length === 0) {
    return {
      canExecute: true as const,
      status: 'failed' as const,
      landedFormalTargetIds,
      failedFormalTargetIds,
      removeFromStagingFolderIds: [] as string[]
    }
  }

  const status = landedFormalTargetIds.length === expectedTargets.size ? 'succeeded' : 'partial'
  return {
    canExecute: true as const,
    status,
    landedFormalTargetIds,
    ...(failedFormalTargetIds.length > 0 ? { failedFormalTargetIds } : {}),
    removeFromStagingFolderIds: uniqueStrings(options.stagingFolderIds)
  }
}
