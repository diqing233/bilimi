import { isBilimiManagedLedgerName } from '@shared/favoriteLedgers'
import type { FavoriteLedger } from '@shared/types'
import {
  createFavoriteLedgerInsights,
  type FavoriteLedgerAiSuggestion,
  type FavoriteLedgerCandidate,
  type FavoriteLedgerInsights
} from './favoriteLedgerInsights'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'

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
}

export type FavoriteLedgerPreviewCandidateTarget = {
  candidateKey: string
  ledgerId: string
  displayName: string
  keywords: string[]
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
  aiSuggestions?: FavoriteLedgerAiSuggestion[]
}): FavoriteLedgerPreview {
  const skippedSourceFolderTitles: string[] = []
  const items: FavoriteLedgerPreviewItem[] = []
  const insights = createFavoriteLedgerInsights({
    sourceFolders: args.sourceFolders,
    existingLedgerNames: args.ledgers.map((ledger) => ledger.displayName),
    aiSuggestions: args.aiSuggestions
  })

  for (const folder of args.sourceFolders) {
    if (isBilimiManagedLedgerName(folder.title)) {
      skippedSourceFolderTitles.push(folder.title)
      continue
    }

    for (const video of folder.videos) {
      const classification = classifyVideoContent(video, args.ledgers)
      const targetLedger = args.ledgers.find((ledger) => ledger.id === classification.ledgerId)
      const targetFolderId = targetLedger?.bilibiliFolderId ?? ''
      const alreadyInTarget = targetFolderId
        ? (args.targetMembership[targetFolderId] ?? []).includes(video.aid)
        : false
      const selected = Boolean(targetFolderId) && !alreadyInTarget && !classification.reviewRequired

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
        candidateTargets: candidateTargetsForVideo(video, insights.candidateLedgers)
      })
    }
  }

  return {
    items,
    skippedSourceFolderTitles,
    insights
  }
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
