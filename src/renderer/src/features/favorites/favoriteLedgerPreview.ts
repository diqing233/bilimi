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
import type {
  FavoriteArchiveMultiMode,
  FavoriteArchiveStrategy,
  FavoriteLedger,
  FavoriteLedgerClassificationDiagnostic
} from '@shared/types'

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

export type FavoriteLedgerScanDiagnostics = {
  tagDetailRequests: number
  tagDetailFailures: number
  taggedVideos: number
  untaggedVideos: number
}

export type FavoriteLedgerPreviewItem = {
  aid: number
  title: string
  author?: string
  description?: string
  tags?: string[]
  pageText?: string
  category?: string
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
  originalSuggestedLedgerIds: string[]
  currentTargetLedgerIds: string[]
  selectedTargetLedgerIds: string[]
  classificationDiagnostic?: FavoriteLedgerClassificationDiagnostic
  lowConfidence: boolean
  originalSuggestionLabel?: string
}

export type FavoriteLedgerPreviewCandidateTarget = {
  candidateKey: string
  ledgerId: string
  displayName: string
  keywords: string[]
  ruleType?: FavoriteLedger['ruleType']
}

export type FavoriteLedgerPreviewTarget = {
  ledgerId: string
  folderId: string
  displayName: string
  keywords: string[]
  ruleType?: FavoriteLedger['ruleType']
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
  scanDiagnostics?: FavoriteLedgerScanDiagnostics
  insights?: FavoriteLedgerInsights
}

export function createFavoriteLedgerPreview(args: {
  ledgers: FavoriteLedger[]
  sourceFolders: FavoriteSourceFolder[]
  targetMembership: Record<string, number[]>
  skippedSourceFolderTitles?: string[]
  scanDiagnostics?: FavoriteLedgerScanDiagnostics
  multiArchiveMode?: FavoriteArchiveMultiMode
  archiveStrategy?: FavoriteArchiveStrategy
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
        multiArchiveMode: args.multiArchiveMode ?? 'off',
        archiveStrategy: args.archiveStrategy
      })
      const primaryArchiveTarget = archiveTargets[0]
      const targetLedger = args.ledgers.find(
        (ledger) => ledger.id === (primaryArchiveTarget?.ledgerId ?? classification.ledgerId)
      )
      const targetFolderId = targetLedger?.bilibiliFolderId ?? ''
      const alreadyInSpecificTarget = targetFolderId
        ? (args.targetMembership[targetFolderId] ?? []).includes(video.aid)
        : false
      const alreadyInManagedLedger = isAlreadyInManagedLedger({
        aid: video.aid,
        ledgers: args.ledgers,
        targetMembership: args.targetMembership
      })
      const alreadyInTarget =
        alreadyInSpecificTarget || (targetLedger?.id === 'inbox' && alreadyInManagedLedger)
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
        archiveTargets,
        alreadyInManagedLedger
      })
      const originalSuggestedLedgerIds = archiveTargets.map((target) => target.ledgerId)
      const selectedTargetLedgerIds = targets
        .filter((target) => target.selected && target.ledgerId !== 'inbox')
        .map((target) => target.ledgerId)
      const currentTargetLedgerIds = [...selectedTargetLedgerIds]
      const classificationDiagnostic =
        primaryArchiveTarget?.diagnostic ?? classification.diagnostic
      const lowConfidence = Boolean(classificationDiagnostic?.lowConfidence)

      items.push({
        aid: video.aid,
        title: video.title,
        author: video.author,
        description: video.description,
        tags: video.tags,
        pageText: video.pageText,
        category: video.category,
        sourceFolderTitle: folder.title,
        targetLedgerId: classification.ledgerId,
        targetFolderId,
        targetDisplayName: targetLedger?.displayName ?? classification.displayName,
        reviewRequired: classification.reviewRequired,
        alreadyInTarget,
        selected: selectedTargetLedgerIds.length > 0,
        candidateTargets,
        targets,
        originalSuggestedLedgerIds,
        currentTargetLedgerIds,
        selectedTargetLedgerIds,
        classificationDiagnostic,
        lowConfidence,
        originalSuggestionLabel: archiveTargets.map((target) => target.displayName).join('、')
      })
    }
  }

  return {
    items,
    skippedSourceFolderTitles,
    scanDiagnostics: args.scanDiagnostics,
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
  alreadyInManagedLedger: boolean
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
    if (args.alreadyInManagedLedger && archiveTarget.ledgerId === 'inbox') {
      continue
    }

    const folderId = archiveTarget.folderId
    const alreadyInTarget = folderId ? (args.targetMembership[folderId] ?? []).includes(args.video.aid) : false
    const selected =
      Boolean(folderId) &&
      archiveTarget.ledgerId !== 'inbox' &&
      !alreadyInTarget &&
      !args.reviewRequired &&
      archiveTarget.selectedByStrategy
    pushTarget({
      ledgerId: archiveTarget.ledgerId,
      folderId,
      displayName: archiveTarget.displayName,
      keywords: archiveTarget.keywords,
      ruleType: archiveTarget.ruleType,
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
        ruleType: suggestedLedger.ruleType,
        alreadyInTarget,
        selected: false
      })
    }
  }

  for (const target of args.candidateTargets) {
    pushTarget({
      ledgerId: target.ledgerId,
      folderId: '',
      displayName: target.displayName,
      keywords: target.keywords,
      ruleType: target.ruleType,
      alreadyInTarget: false,
      selected: false,
      selectedCandidateTarget: true,
      candidateKey: target.candidateKey
    })
  }

  if (!args.alreadyInManagedLedger && (targets.length === 0 || targets.every((target) => !target.selected))) {
    const inboxLedger = args.ledgers.find((ledger) => ledger.id === 'inbox')
    if (inboxLedger) {
      const folderId = inboxLedger.bilibiliFolderId ?? ''
      const alreadyInTarget = folderId ? (args.targetMembership[folderId] ?? []).includes(args.video.aid) : false
      pushTarget({
        ledgerId: inboxLedger.id,
        folderId,
        displayName: inboxLedger.displayName,
        keywords: inboxLedger.keywords,
        ruleType: inboxLedger.ruleType,
        alreadyInTarget,
        selected: false
      })
    }
  }

  return targets
}

function isAlreadyInManagedLedger(args: {
  aid: number
  ledgers: FavoriteLedger[]
  targetMembership: Record<string, number[]>
}) {
  return args.ledgers
    .filter((ledger) => ledger.id !== 'inbox' && ledger.bilibiliFolderId)
    .some((ledger) => (args.targetMembership[ledger.bilibiliFolderId ?? ''] ?? []).includes(args.aid))
}

function ledgerMatchesVideo(ledger: FavoriteLedger, video: FavoriteSourceVideo) {
  if (!ledger.enabled) {
    return false
  }

  return ruleMatchesVideo(ledger.ruleType, ledger.keywords, video)
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

function ruleMatchesVideo(
  ruleType: FavoriteLedger['ruleType'],
  keywords: string[],
  video: FavoriteSourceVideo
) {
  const normalizedKeywords = keywords.map(normalize).filter(Boolean)
  if (!normalizedKeywords.length) {
    return false
  }

  if (ruleType === 'author') {
    const author = normalize(video.author)
    return normalizedKeywords.some((keyword) => author.includes(keyword))
  }

  if (ruleType === 'tag') {
    const tags = normalize((video.tags ?? []).join(' '))
    return normalizedKeywords.some((keyword) => tags.includes(keyword))
  }

  const text = videoText(video)
  return normalizedKeywords.some((keyword) => text.includes(keyword))
}

function candidateTargetsForVideo(
  video: FavoriteSourceVideo,
  candidates: FavoriteLedgerCandidate[]
): FavoriteLedgerPreviewCandidateTarget[] {
  return candidates
    .filter((candidate) => ruleMatchesVideo(candidate.ruleType, candidate.keywords, video))
    .reduce<FavoriteLedgerPreviewCandidateTarget[]>((targets, candidate) => {
      if (targets.some((target) => target.displayName === candidate.displayName)) {
        return targets
      }

      targets.push({
        candidateKey: candidateKey(candidate),
        ledgerId: candidateLedgerId(candidate),
        displayName: candidate.displayName,
        keywords: candidate.keywords,
        ruleType: candidate.ruleType
      })
      return targets
    }, [])
}
