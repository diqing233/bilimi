export type MultipartVideoPart = {
  number: number
  cid: number
  title: string
  durationSeconds: number
}

export type MultipartVideoSnapshot = {
  aid: number
  bvid: string
  title: string
  author?: string
  url: string
  currentPart: MultipartVideoPart
  parts: MultipartVideoPart[]
}

export function buildMultipartPartUrl(snapshot: MultipartVideoSnapshot, partNumber: number): string {
  const url = new URL(snapshot.url)
  url.searchParams.set('p', String(partNumber))
  return url.toString()
}

type RawMultipartVideoPage = {
  page?: unknown
  cid?: unknown
  part?: unknown
  duration?: unknown
}

type RawMultipartVideoSnapshot = {
  url?: unknown
  aid?: unknown
  bvid?: unknown
  title?: unknown
  author?: unknown
  pages?: unknown
}

function requiredPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/u.test(value.trim())
      ? Number(value)
      : undefined
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''
}

function requestedPartNumber(url: string): number | undefined {
  const parsed = new URL(url)
  const requested = parsed.searchParams.get('p')
  if (requested === null || requested.trim() === '') return undefined
  return requiredPositiveInteger(requested)
}

export function normalizeMultipartVideoSnapshot(raw: RawMultipartVideoSnapshot): MultipartVideoSnapshot {
  const url = cleanText(raw.url)
  const aid = requiredPositiveInteger(raw.aid)
  const bvid = cleanText(raw.bvid)
  const title = cleanText(raw.title)
  if (!url || !aid || !bvid || !title) {
    throw new Error('当前视频信息不完整，请刷新视频页面后重试。')
  }

  let requestedPart: number | undefined
  try {
    requestedPart = requestedPartNumber(url)
  } catch {
    throw new Error('当前视频地址无效，请返回视频页面后重试。')
  }
  if (new URL(url).searchParams.has('p') && !requestedPart) {
    throw new Error('当前分 P 无效，请返回视频页面后重试。')
  }

  const rawPages = Array.isArray(raw.pages) ? raw.pages : []
  const parts = rawPages.map((value): MultipartVideoPart | undefined => {
    const page = value as RawMultipartVideoPage
    const number = requiredPositiveInteger(page.page)
    const cid = requiredPositiveInteger(page.cid)
    const partTitle = cleanText(page.part)
    const duration = typeof page.duration === 'number' && Number.isFinite(page.duration) && page.duration >= 0
      ? Math.floor(page.duration)
      : undefined
    if (!number || !cid || !partTitle || duration === undefined) return undefined
    return { number, cid, title: partTitle, durationSeconds: duration }
  })
  if (parts.length === 0 || parts.some((part) => !part)) {
    throw new Error('分 P 信息不完整，请刷新视频页面后重试。')
  }
  const normalizedParts = parts as MultipartVideoPart[]
  const currentPart = normalizedParts.find((part) => part.number === (requestedPart ?? 1))
  if (!currentPart) {
    throw new Error('当前分 P 无效，请返回视频页面后重试。')
  }

  const author = cleanText(raw.author)
  return {
    aid,
    bvid,
    title,
    ...(author ? { author } : {}),
    url,
    currentPart,
    parts: normalizedParts
  }
}

export function buildMultipartVideoSnapshotScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};
      return {
        url: location.href,
        aid: videoData.aid || initialState.aid,
        bvid: clean(videoData.bvid || location.pathname.match(/BV[0-9A-Za-z]+/)?.[0] || ''),
        title: clean(document.querySelector('h1')?.textContent || videoData.title || document.title),
        author: clean(document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || ''),
        pages: Array.from(videoData.pages || initialState.pages || []).map((page) => ({
          page: page?.page,
          cid: page?.cid,
          part: clean(page?.part),
          duration: page?.duration
        }))
      };
    })();
  `
}
