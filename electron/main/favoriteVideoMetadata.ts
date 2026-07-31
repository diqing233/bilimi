import type { FavoriteRepositoryVideo } from '../../src/shared/favoriteRepository'

type FetchResponse = {
  ok: boolean
  json: () => Promise<unknown>
}

type FavoriteVideoMetadataOptions = {
  accountMid: string
  aid: number
  fetch: (url: URL) => Promise<FetchResponse>
  readCurrentAccountMid: () => Promise<string>
  now?: () => string
}

export type FavoriteVideoMetadataErrorCode = 'network' | 'unavailable' | 'account-changed'

export class FavoriteVideoMetadataError extends Error {
  constructor(
    message: string,
    readonly errorCode: FavoriteVideoMetadataErrorCode,
    readonly remoteCode?: number
  ) {
    super(message)
    this.name = 'FavoriteVideoMetadataError'
  }
}

const UNAVAILABLE_VIDEO_CODES = new Set([-404, 62002, 62004, 62012])

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function requireSameAccount(options: FavoriteVideoMetadataOptions) {
  if ((await options.readCurrentAccountMid()).trim() !== options.accountMid.trim()) {
    throw new FavoriteVideoMetadataError('当前账号已切换，请重新加载收藏库。', 'account-changed')
  }
}

export async function fetchFavoriteVideoMetadata(
  options: FavoriteVideoMetadataOptions
): Promise<FavoriteRepositoryVideo> {
  await requireSameAccount(options)

  const viewUrl = new URL('https://api.bilibili.com/x/web-interface/view')
  viewUrl.searchParams.set('aid', String(options.aid))
  const viewResponse = await options.fetch(viewUrl)
  const viewPayload = record(await viewResponse.json())
  const data = record(viewPayload?.data)
  if (!viewResponse.ok || viewPayload?.code !== 0 || !data) {
    const remoteCode = Number.isSafeInteger(viewPayload?.code) ? Number(viewPayload?.code) : undefined
    if (remoteCode !== undefined && UNAVAILABLE_VIDEO_CODES.has(remoteCode)) {
      throw new FavoriteVideoMetadataError('视频已失效或当前不可见。', 'unavailable', remoteCode)
    }
    throw new FavoriteVideoMetadataError('无法读取视频信息，请稍后重试。', 'network', remoteCode)
  }
  await requireSameAccount(options)

  const title = typeof data.title === 'string' ? data.title.trim() : ''
  if (!title) throw new Error('视频信息不完整，请稍后重试。')

  let tags: string[] = []
  let tagEvidence: FavoriteRepositoryVideo['tagEvidence']
  try {
    const tagsUrl = new URL('https://api.bilibili.com/x/tag/archive/tags')
    tagsUrl.searchParams.set('aid', String(options.aid))
    const tagsResponse = await options.fetch(tagsUrl)
    const tagsPayload = record(await tagsResponse.json())
    if (tagsResponse.ok && tagsPayload?.code === 0 && Array.isArray(tagsPayload.data)) {
      tags = Array.from(new Set(tagsPayload.data
        .map((item) => record(item)?.tag_name)
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)))
      tagEvidence = 'confirmed'
    }
  } catch {
    // Tags are optional: save other refreshed facts without clearing persisted tags.
  }
  await requireSameAccount(options)

  const owner = record(data.owner)
  const pages = Array.isArray(data.pages) ? data.pages.map(record).filter(Boolean) : []
  const firstPage = pages[0]
  const firstPageCid = firstPage?.cid
  return {
    aid: options.aid,
    title,
    tags,
    ...(tagEvidence ? { tagEvidence } : {}),
    updatedAt: options.now?.() ?? new Date().toISOString(),
    ...(typeof owner?.name === 'string' && owner.name.trim() ? { author: owner.name.trim() } : {}),
    ...(typeof data.desc === 'string' && data.desc.trim() ? { description: data.desc.trim() } : {}),
    ...(typeof data.bvid === 'string' && data.bvid.trim() ? { bvid: data.bvid.trim() } : {}),
    ...(Number.isSafeInteger(data.duration) ? { durationSeconds: Number(data.duration) } : {}),
    ...(typeof data.tname === 'string' && data.tname.trim() ? { category: data.tname.trim() } : {}),
    ...(typeof data.pic === 'string' && data.pic.trim() ? { coverUrl: data.pic.trim() } : {}),
    ...(Number.isSafeInteger(firstPageCid) ? { cid: Number(firstPageCid) } : {})
  }
}
