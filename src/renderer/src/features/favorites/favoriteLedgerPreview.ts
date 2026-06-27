import type { FavoriteLedger } from '@shared/types'
import {
  createFavoriteLedgerInsights,
  type FavoriteLedgerCandidate,
  type FavoriteLedgerInsights
} from './favoriteLedgerInsights'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'
import {
  planFavoriteArchiveTargets,
  type FavoriteArchiveTarget
} from '../recommendation/archivePlanning'
import type { FavoriteArchiveMultiMode } from '@shared/types'

export type FavoriteSourceVideo = VideoContentContext & {
  aid: number
  title: string
  category?: string
}

export type FavoriteSourceFolder = {
  id: string
  title: string
  videos: FavoriteSourceVideo[]
}

export type FavoriteLedgerPreviewItem = {
  aid: number
  title: string
  sourceFolderTitle: string
  targetLedgerId: string
  targetFolderId: string
  targetDisplayName: string
  reviewRequired: boolean
  alreadyInTarget: boolean
  selected: boolean
  selectedCandidateTarget?: boolean
  candidateTargets?: FavoriteLedgerPreviewCandidateTarget[]
  targets?: FavoriteLedgerPreviewTarget[]
}

export type FavoriteLedgerPreviewCandidateTarget = {
  candidateKey: string
  ledgerId: string
  displayName: string
  keywords: string[]
}

export type FavoriteLedgerPreviewTarget = {
  ledgerId: string
  folderId: string
  displayName: string
  keywords: string[]
  alreadyInTarget: boolean
  selected: boolean
  selectedCandidateTarget?: boolean
  candidateKey?: string
}

export type FavoriteLedgerPreview = {
  ok?: boolean
  message?: string
  items: FavoriteLedgerPreviewItem[]
  skippedSourceFolderTitles: string[]
  insights?: FavoriteLedgerInsights
}

export function createFavoriteLedgerPreview(args: {
  ledgers: FavoriteLedger[]
  sourceFolders: FavoriteSourceFolder[]
  targetMembership: Record<string, number[]>
  skippedSourceFolderTitles?: string[]
  multiArchiveMode?: FavoriteArchiveMultiMode
}): FavoriteLedgerPreview {
  const skippedSourceFolderTitles = args.skippedSourceFolderTitles ?? []
  const items: FavoriteLedgerPreviewItem[] = []
  const insights = createFavoriteLedgerInsights({
    sourceFolders: args.sourceFolders,
    existingLedgerNames: args.ledgers.map((ledger) => ledger.displayName)
  })

  for (const folder of args.sourceFolders) {
    for (const video of folder.videos) {
      const classification = classifyVideoContent(video, args.ledgers)
      const archiveTargets = planFavoriteArchiveTargets({
        context: video,
        ledgers: args.ledgers,
        multiArchiveMode: args.multiArchiveMode ?? 'off'
      })
      const primaryArchiveTarget = archiveTargets[0]
      const targetLedger = args.ledgers.find(
        (ledger) => ledger.id === (primaryArchiveTarget?.ledgerId ?? classification.ledgerId)
      )
      const targetFolderId = targetLedger?.bilibiliFolderId ?? ''
      const alreadyInTarget = targetFolderId
        ? (args.targetMembership[targetFolderId] ?? []).includes(video.aid)
        : false
      const selected = Boolean(targetFolderId) && !alreadyInTarget && !classification.reviewRequired
      const candidateTargets = candidateTargetsForVideo(video, insights.candidateLedgers)
      const targets = previewTargetsForVideo({
        video,
        ledgers: args.ledgers,
        targetMembership: args.targetMembership,
        primaryLedgerId: classification.ledgerId,
        primaryDisplayName: targetLedger?.displayName ?? classification.displayName,
        suggestedLedgerId: classification.suggestedLedgerId,
        reviewRequired: classification.reviewRequired,
        candidateTargets,
        archiveTargets
      })

      items.push({
        aid: video.aid,
        title: video.title,
        sourceFolderTitle: folder.title,
        targetLedgerId: classification.ledgerId,
        targetFolderId,
        targetDisplayName: targetLedger?.displayName ?? classification.displayName,
        reviewRequired: classification.reviewRequired,
        alreadyInTarget,
        selected,
        candidateTargets,
        targets
      })
    }
  }

  return {
    items,
    skippedSourceFolderTitles,
    insights
  }
}

function previewTargetsForVideo(args: {
  video: FavoriteSourceVideo
  ledgers: FavoriteLedger[]
  targetMembership: Record<string, number[]>
  primaryLedgerId: string
  primaryDisplayName: string
  suggestedLedgerId?: string
  reviewRequired: boolean
  candidateTargets: FavoriteLedgerPreviewCandidateTarget[]
  archiveTargets: FavoriteArchiveTarget[]
}): FavoriteLedgerPreviewTarget[] {
  const targets: FavoriteLedgerPreviewTarget[] = []
  const targetLedgerIds = new Set<string>()

  function pushTarget(target: FavoriteLedgerPreviewTarget) {
    if (targetLedgerIds.has(target.ledgerId)) {
      return
    }

    targetLedgerIds.add(target.ledgerId)
    targets.push(target)
  }

  for (const archiveTarget of args.archiveTargets) {
    const folderId = archiveTarget.folderId
    const alreadyInTarget = folderId ? (args.targetMembership[folderId] ?? []).includes(args.video.aid) : false
    const selected = Boolean(folderId) && !alreadyInTarget && !args.reviewRequired
    pushTarget({
      ledgerId: archiveTarget.ledgerId,
      folderId,
      displayName: archiveTarget.displayName,
      keywords: archiveTarget.keywords,
      alreadyInTarget,
      selected
    })
  }

  if (args.suggestedLedgerId) {
    const suggestedLedger = args.ledgers.find((ledger) => ledger.id === args.suggestedLedgerId)
    if (suggestedLedger) {
      const folderId = suggestedLedger.bilibiliFolderId ?? ''
      const alreadyInTarget = folderId ? (args.targetMembership[folderId] ?? []).includes(args.video.aid) : false
      pushTarget({
        ledgerId: suggestedLedger.id,
        folderId,
        displayName: suggestedLedger.displayName,
        keywords: suggestedLedger.keywords,
        alreadyInTarget,
        selected: Boolean(folderId) && !alreadyInTarget
      })
    }
  }

  for (const target of args.candidateTargets) {
    pushTarget({
      ledgerId: target.ledgerId,
      folderId: '',
      displayName: target.displayName,
      keywords: target.keywords,
      alreadyInTarget: false,
      selected: false,
      selectedCandidateTarget: true,
      candidateKey: target.candidateKey
    })
  }

  if (targets.length === 0 || targets.every((target) => !target.selected)) {
    const inboxLedger = args.ledgers.find((ledger) => ledger.id === 'inbox')
    if (inboxLedger) {
      const folderId = inboxLedger.bilibiliFolderId ?? ''
      const alreadyInTarget = folderId ? (args.targetMembership[folderId] ?? []).includes(args.video.aid) : false
      pushTarget({
        ledgerId: inboxLedger.id,
        folderId,
        displayName: inboxLedger.displayName,
        keywords: inboxLedger.keywords,
        alreadyInTarget,
        selected: Boolean(folderId) && !alreadyInTarget,
      })
    }
  }

  return targets
}

function ledgerMatchesVideo(ledger: FavoriteLedger, video: FavoriteSourceVideo) {
  if (!ledger.enabled) {
    return false
  }

  const text = videoText(video)
  return ledger.keywords.some((keyword) => text.includes(normalize(keyword)))
}

function candidateKey(candidate: FavoriteLedgerCandidate) {
  return `${candidate.kind}:${candidate.sourceName}`
}

function candidateLedgerId(candidate: FavoriteLedgerCandidate) {
  return `custom-${candidate.kind}-${candidate.sourceName
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')}`
}

function normalize(value = '') {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function videoText(video: FavoriteSourceVideo) {
  return normalize(
    [
      video.title,
      video.author,
      video.description,
      video.pageText,
      video.category,
      ...(video.tags ?? [])
    ]
      .filter(Boolean)
      .join(' ')
  )
}

function candidateTargetsForVideo(
  video: FavoriteSourceVideo,
  candidates: FavoriteLedgerCandidate[]
): FavoriteLedgerPreviewCandidateTarget[] {
  const text = videoText(video)
  if (!text) {
    return []
  }

  return candidates
    .filter((candidate) =>
      candidate.keywords.some((keyword) => text.includes(normalize(keyword)))
    )
    .reduce<FavoriteLedgerPreviewCandidateTarget[]>((targets, candidate) => {
      if (targets.some((target) => target.displayName === candidate.displayName)) {
        return targets
      }

      targets.push({
        candidateKey: candidateKey(candidate),
        ledgerId: candidateLedgerId(candidate),
        displayName: candidate.displayName,
        keywords: candidate.keywords
      })
      return targets
    }, [])
}
