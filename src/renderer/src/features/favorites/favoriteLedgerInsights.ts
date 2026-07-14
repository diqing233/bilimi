import type { FavoriteSourceFolder, FavoriteSourceVideo } from './favoriteLedgerPreview'
import {
  BILIMI_LEDGER_PREFIX,
  isBilimiManagedLedgerName,
  stripBilimiLedgerPrefix
} from '@shared/favoriteLedgers'
import type { FavoriteLedgerRuleType } from '@shared/types'

export type FavoriteLedgerInsightSignal = {
  name: string
  count: number
}

export type FavoriteLedgerAuthorSignal = FavoriteLedgerInsightSignal & {
  share: number
}

export type FavoriteLedgerCandidateKind = 'author' | 'tag-cluster' | 'category' | 'series'

export type FavoriteLedgerCandidateConfidence = 'high' | 'medium'

export type FavoriteLedgerCandidate = {
  kind: FavoriteLedgerCandidateKind
  sourceName: string
  displayName: string
  keywords: string[]
  ruleType?: FavoriteLedgerRuleType
  count: number
  confidence: FavoriteLedgerCandidateConfidence
  reason: string
}

export type FavoriteLedgerInsights = {
  totalVideos: number
  topAuthors: FavoriteLedgerAuthorSignal[]
  topTags: FavoriteLedgerInsightSignal[]
  topCategories: FavoriteLedgerInsightSignal[]
  sourceFolders: FavoriteLedgerInsightSignal[]
  titleSeries: FavoriteLedgerInsightSignal[]
  candidateLedgers: FavoriteLedgerCandidate[]
}

type CountedName = {
  name: string
  count: number
  firstSeen: number
}

function cleanText(value?: string): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function cleanKeyword(value: string): string {
  return value.replace(/[，,、]/g, '').trim()
}

function increment(map: Map<string, CountedName>, rawName?: string) {
  const name = cleanText(rawName)
  if (!name) {
    return
  }

  const existing = map.get(name)
  if (existing) {
    existing.count += 1
    return
  }

  map.set(name, {
    name,
    count: 1,
    firstSeen: map.size
  })
}

function sortedSignals(map: Map<string, CountedName>): FavoriteLedgerInsightSignal[] {
  return [...map.values()]
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }

      const byName = left.name.localeCompare(right.name, 'zh-CN')
      return byName || left.firstSeen - right.firstSeen
    })
    .map(({ name, count }) => ({ name, count }))
}

function sortedTagSignals(
  tagCounts: Map<string, CountedName>,
  videos: FavoriteSourceVideo[]
): FavoriteLedgerInsightSignal[] {
  const countedTags = [...tagCounts.values()]
  const topTag = countedTags.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }

    return left.firstSeen - right.firstSeen
  })[0]?.name
  if (!topTag) {
    return []
  }

  const coOccurrenceCounts = new Map<string, number>()
  for (const video of videos) {
    const tags = (video.tags ?? []).map(cleanText).filter(Boolean)
    if (!tags.includes(topTag)) {
      continue
    }

    for (const tag of tags) {
      coOccurrenceCounts.set(tag, (coOccurrenceCounts.get(tag) ?? 0) + 1)
    }
  }

  return countedTags
    .map(({ name, count }) => ({ name, count }))
    .sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }

    if (left.name === topTag) {
      return -1
    }

    if (right.name === topTag) {
      return 1
    }

    const rightCoOccurrence = coOccurrenceCounts.get(right.name) ?? 0
    const leftCoOccurrence = coOccurrenceCounts.get(left.name) ?? 0
    if (rightCoOccurrence !== leftCoOccurrence) {
      return rightCoOccurrence - leftCoOccurrence
    }

    return left.name.localeCompare(right.name, 'zh-CN')
  })
}

function stripExistingSuffix(title: string): string {
  return title
    .replace(/[：:]\s*第?\s*\d+\s*[期集讲话课回].*$/u, '')
    .replace(/\s*第?\s*\d+\s*[期集讲话课回].*$/u, '')
    .trim()
}

function extractTitleSeries(title: string): string {
  const cleaned = cleanText(title)
  const stripped = stripExistingSuffix(cleaned)

  return stripped.length >= 4 && stripped.length < cleaned.length ? stripped : ''
}

function flattenVideos(sourceFolders: FavoriteSourceFolder[]): FavoriteSourceVideo[] {
  return sourceFolders.flatMap((folder) => folder.videos)
}

function candidateKey(kind: FavoriteLedgerCandidateKind, sourceName: string): string {
  return `${kind}:${sourceName.toLocaleLowerCase()}`
}

function hasExistingLedger(displayName: string, existingLedgerNames: string[]): boolean {
  const normalizedDisplayName = normalizeManagedLedgerName(displayName)
  return existingLedgerNames.some((name) => normalizeManagedLedgerName(name) === normalizedDisplayName)
}

function isDeletedAccountPlaceholder(value: string): boolean {
  return new Set(['账号已注销', '用户已注销', 'UP主已注销']).has(cleanText(value))
}

function normalizeManagedLedgerName(displayName: string): string {
  return isBilimiManagedLedgerName(displayName)
    ? `${BILIMI_LEDGER_PREFIX}${stripBilimiLedgerPrefix(displayName)}`
    : displayName.trim()
}

function confidence(count: number, totalVideos: number): FavoriteLedgerCandidateConfidence {
  return count >= 4 || count / Math.max(totalVideos, 1) >= 0.5 ? 'high' : 'medium'
}

function buildTagClusters(videos: FavoriteSourceVideo[], totalVideos: number): FavoriteLedgerCandidate[] {
  const tagCounts = new Map<string, CountedName>()

  for (const video of videos) {
    for (const tag of video.tags ?? []) {
      increment(tagCounts, tag)
    }
  }

  const sortedTags = [...tagCounts.values()].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count
    }

    return left.firstSeen - right.firstSeen
  })
  const candidateTags = sortedTags.filter((tag) => tag.count >= 2).slice(0, 24)

  return candidateTags.map((tag) => {
    const keyword = cleanKeyword(tag.name)
    const displaySuffix = tag.name
    const keywords = keyword ? [keyword] : []

    return {
      kind: 'tag-cluster',
      sourceName: tag.name,
      displayName: `${BILIMI_LEDGER_PREFIX}${displaySuffix}`,
      keywords,
      ruleType: 'tag',
      count: tag.count,
      confidence: confidence(tag.count, totalVideos),
      reason: `高频标签“${tag.name}”出现 ${tag.count} 次，适合单独成册。`
    }
  })
}

function buildSeriesCandidates(
  titleSeries: FavoriteLedgerInsightSignal[],
  totalVideos: number
): FavoriteLedgerCandidate[] {
  return titleSeries
    .filter((series) => series.count >= 3)
    .slice(0, 2)
    .map((series) => ({
      kind: 'series' as const,
      sourceName: series.name,
      displayName: `${BILIMI_LEDGER_PREFIX}${series.name}`,
      keywords: [series.name],
      count: series.count,
      confidence: confidence(series.count, totalVideos),
      reason: `标题系列“${series.name}”出现 ${series.count} 次，适合追更或成套回看。`
    }))
}

function buildAuthorCandidates(
  topAuthors: FavoriteLedgerAuthorSignal[],
  totalVideos: number
): FavoriteLedgerCandidate[] {
  return topAuthors
    .filter((author) => author.count >= 2 && !isDeletedAccountPlaceholder(author.name))
    .slice(0, 3)
    .map((author) => ({
      kind: 'author' as const,
      sourceName: author.name,
      displayName: `${BILIMI_LEDGER_PREFIX}${author.name}追更`,
      keywords: [author.name],
      ruleType: 'author',
      count: author.count,
      confidence: confidence(author.count, totalVideos),
      reason: `固定 UP“${author.name}”已有 ${author.count} 条收藏，适合持续追更。`
    }))
}

function buildCategoryCandidates(
  topCategories: FavoriteLedgerInsightSignal[],
  totalVideos: number
): FavoriteLedgerCandidate[] {
  return topCategories
    .filter((category) => category.count > 0)
    .slice(0, 3)
    .map((category) => ({
      kind: 'category' as const,
      sourceName: category.name,
      displayName: `${BILIMI_LEDGER_PREFIX}${category.name}`,
      keywords: [category.name],
      count: category.count,
      confidence: confidence(category.count, totalVideos),
      reason: `分区“${category.name}”占比较高，可作为粗粒度归档入口。`
    }))
}

export function createFavoriteLedgerInsights(args: {
  sourceFolders: FavoriteSourceFolder[]
  existingLedgerNames: string[]
}): FavoriteLedgerInsights {
  const videos = flattenVideos(args.sourceFolders)
  const totalVideos = videos.length
  const authorCounts = new Map<string, CountedName>()
  const tagCounts = new Map<string, CountedName>()
  const categoryCounts = new Map<string, CountedName>()
  const titleSeriesCounts = new Map<string, CountedName>()

  for (const video of videos) {
    increment(authorCounts, video.author)
    increment(categoryCounts, video.category)
    increment(titleSeriesCounts, extractTitleSeries(video.title))

    for (const tag of video.tags ?? []) {
      increment(tagCounts, tag)
    }
  }

  const topAuthors = sortedSignals(authorCounts).map((author) => ({
    ...author,
    share: author.count / Math.max(totalVideos, 1)
  }))
  const topTags = sortedTagSignals(tagCounts, videos)
  const topCategories = sortedSignals(categoryCounts)
  const sourceFolders = args.sourceFolders
    .map((folder, index) => ({
      name: cleanText(folder.title),
      count: folder.videos.length,
      firstSeen: index
    }))
    .filter((folder) => folder.name && folder.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count
      }

      return left.firstSeen - right.firstSeen
    })
    .map(({ name, count }) => ({ name, count }))
  const titleSeries = sortedSignals(titleSeriesCounts)
  const tagClusters = buildTagClusters(videos, totalVideos)
  const candidates = [
    ...tagClusters,
    ...buildSeriesCandidates(titleSeries, totalVideos),
    ...buildCategoryCandidates(topCategories, totalVideos),
    ...buildAuthorCandidates(topAuthors, totalVideos)
  ].filter((candidate) => !hasExistingLedger(candidate.displayName, args.existingLedgerNames))

  return {
    totalVideos,
    topAuthors,
    topTags,
    topCategories,
    sourceFolders,
    titleSeries,
    candidateLedgers: candidates
  }
}
