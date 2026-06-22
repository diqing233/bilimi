import { isBilimiManagedLedgerName } from '@shared/favoriteLedgers'
import type { FavoriteLedger } from '@shared/types'
import { classifyVideoContent, type VideoContentContext } from '../recommendation/videoClassifier'

export type FavoriteSourceVideo = VideoContentContext & {
  aid: number
  title: string
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
}

export type FavoriteLedgerPreview = {
  ok?: boolean
  message?: string
  items: FavoriteLedgerPreviewItem[]
  skippedSourceFolderTitles: string[]
}

export function createFavoriteLedgerPreview(args: {
  ledgers: FavoriteLedger[]
  sourceFolders: FavoriteSourceFolder[]
  targetMembership: Record<string, number[]>
}): FavoriteLedgerPreview {
  const skippedSourceFolderTitles: string[] = []
  const items: FavoriteLedgerPreviewItem[] = []

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
        selected
      })
    }
  }

  return {
    items,
    skippedSourceFolderTitles
  }
}
