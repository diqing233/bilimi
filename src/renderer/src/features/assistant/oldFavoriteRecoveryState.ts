type OldFavoriteRecoveryRecord = {
  aid?: unknown
  [key: string]: unknown
}

export type OldFavoriteTagCoverage = 'complete' | 'partial' | 'none'

export type OldFavoriteRecoveryState =
  | {
      kind: 'recoverable'
      itemCount: number
      tagCoverage: OldFavoriteTagCoverage
      tagRecordCount: number
      missingTagAids: number[]
    }
  | {
      kind: 'rescan-required'
      reason: 'empty-workspace'
    }
  | {
      kind: 'error'
      reason: 'corrupt-base' | 'corrupt-tags'
    }

function validAid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

export function classifyOldFavoriteRecoveryState(input: {
  base: OldFavoriteRecoveryRecord[]
  tags: OldFavoriteRecoveryRecord[]
  sources: OldFavoriteRecoveryRecord[]
}): OldFavoriteRecoveryState {
  if (input.base.some((item) =>
    !validAid(item.aid) ||
    typeof item.title !== 'string' ||
    typeof item.sourceFolderTitle !== 'string'
  )) {
    return { kind: 'error', reason: 'corrupt-base' }
  }
  if (input.tags.some((item) => !validAid(item.aid) || !Array.isArray(item.tags) ||
    item.tags.some((tag) => typeof tag !== 'string'))) {
    return { kind: 'error', reason: 'corrupt-tags' }
  }
  const baseAids = [...new Set(input.base.map((item) => item.aid).filter(validAid))]
  if (baseAids.length === 0) {
    return { kind: 'rescan-required', reason: 'empty-workspace' }
  }

  const baseAidSet = new Set(baseAids)
  const tagAids = new Set(input.tags
    .map((item) => item.aid)
    .filter((aid): aid is number => validAid(aid) && baseAidSet.has(aid)))
  const missingTagAids = baseAids.filter((aid) => !tagAids.has(aid))

  return {
    kind: 'recoverable',
    itemCount: baseAids.length,
    tagCoverage: tagAids.size === 0
      ? 'none'
      : missingTagAids.length === 0
        ? 'complete'
        : 'partial',
    tagRecordCount: tagAids.size,
    missingTagAids
  }
}
