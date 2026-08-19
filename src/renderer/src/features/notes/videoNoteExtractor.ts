import type { TranscriptSegment, VideoNoteExtractionResult } from '@shared/types'

type RawSubtitleItem = {
  from?: number
  to?: number
  content?: string
}

type RawSubtitlePayload = {
  body?: RawSubtitleItem[]
}

type RawVideoNoteExtraction = {
  title?: string
  author?: string
  description?: string
  tags?: string[]
  bvid?: string
  aid?: number
  cid?: number
  partNumber?: number
  partTitle?: string
  partDurationSeconds?: number
  url?: string
  transcript?: TranscriptSegment[]
}

const BILIBILI_TITLE_SUFFIX = /\s*[-_]\s*哔哩哔哩.*$/i

function cleanText(value = ''): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniqueTags(tags: string[] = []): string[] {
  return Array.from(new Set(tags.map(cleanText).filter(Boolean))).slice(0, 20)
}

export function normalizeSubtitleBody(payload: RawSubtitlePayload): TranscriptSegment[] {
  return (payload.body ?? [])
    .map((item) => ({
      start: typeof item.from === 'number' ? item.from : null,
      end: typeof item.to === 'number' ? item.to : null,
      text: cleanText(item.content)
    }))
    .filter((segment) => segment.text.length > 0)
}

export function normalizeExtractedVideoNoteResult(
  raw: RawVideoNoteExtraction
): VideoNoteExtractionResult {
  const url = cleanText(raw.url) || 'about:blank'
  const title = cleanText(raw.title).replace(BILIBILI_TITLE_SUFFIX, '') || url
  const transcript = (raw.transcript ?? [])
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: cleanText(segment.text)
    }))
    .filter((segment) => segment.text.length > 0)

  return {
    source: {
      title,
      author: cleanText(raw.author),
      description: cleanText(raw.description),
      tags: uniqueTags(raw.tags),
      bvid: cleanText(raw.bvid),
      ...(typeof raw.aid === 'number' && Number.isSafeInteger(raw.aid) && raw.aid > 0 ? { aid: raw.aid } : {}),
      ...(typeof raw.cid === 'number' && Number.isSafeInteger(raw.cid) && raw.cid > 0 ? { cid: raw.cid } : {}),
      ...(typeof raw.partNumber === 'number' && Number.isSafeInteger(raw.partNumber) && raw.partNumber > 0 ? { partNumber: raw.partNumber } : {}),
      ...(raw.partTitle?.trim() ? { partTitle: cleanText(raw.partTitle) } : {}),
      ...(typeof raw.partDurationSeconds === 'number' && Number.isFinite(raw.partDurationSeconds) && raw.partDurationSeconds >= 0 ? { partDurationSeconds: Math.floor(raw.partDurationSeconds) } : {}),
      url
    },
    transcript,
    transcriptSource: transcript.length > 0 ? 'auto' : 'manual'
  }
}

export function buildVideoNoteExtractionScript(): string {
  return `
    (async () => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const normalizeSubtitleBody = (payload) => Array.from(payload?.body || [])
        .map((item) => ({
          start: typeof item.from === 'number' ? item.from : null,
          end: typeof item.to === 'number' ? item.to : null,
          text: clean(item.content)
        }))
        .filter((item) => item.text);
      const looksLikeSubtitleUrl = (value) =>
        /^https?:\\/\\//i.test(value) || value.startsWith('//') || value.startsWith('/bfs/') || value.startsWith('/bfs/subtitle/');
      const subtitleUrlFrom = (candidate) => {
        const urls = [
          clean(candidate?.subtitle_url),
          clean(candidate?.url),
          clean(candidate?.ai_subtitle_url)
        ];

        return urls.find(looksLikeSubtitleUrl) || '';
      };
      const absoluteSubtitleUrl = (value) => {
        if (!value) {
          return '';
        }

        try {
          return new URL(value, location.href).href;
        } catch {
          return value.startsWith('//') ? location.protocol + value : value;
        }
      };
      const fetchSubtitle = async (candidate) => {
        const subtitleUrl = absoluteSubtitleUrl(subtitleUrlFrom(candidate));

        if (!subtitleUrl) {
          return [];
        }

        try {
          const response = await fetch(subtitleUrl, { credentials: 'include' });

          if (!response.ok) {
            return [];
          }

          return normalizeSubtitleBody(await response.json());
        } catch {
          return [];
        }
      };
      const fetchPlayerSubtitleCandidates = async (aid, cid) => {
        if (!aid || !cid) {
          return [];
        }

        try {
          const response = await fetch(
            'https://api.bilibili.com/x/player/v2?aid=' + encodeURIComponent(aid) + '&cid=' + encodeURIComponent(cid),
            { credentials: 'include' }
          );

          if (!response.ok) {
            return [];
          }

          const payload = await response.json();
          return Array.from(payload?.data?.subtitle?.subtitles || []);
        } catch {
          return [];
        }
      };
      const readMeta = (name) =>
        document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.getAttribute('content') || '';
      const textFrom = (selectors) =>
        selectors.map((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join(' '))
          .filter(Boolean)
          .join(' ');
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};
      const aid = videoData.aid || initialState.aid || '';
      const pages = Array.from(videoData.pages || initialState.pages || []);
      const requestedPart = Number(new URL(location.href).searchParams.get('p') || 1);
      const currentPage = pages.find((page) => Number(page?.page) === requestedPart) || pages[requestedPart - 1] || pages[0] || {};
      const cid = currentPage.cid || videoData.cid || initialState.cid || '';
      const tags = Array.from(document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span'))
        .map((node) => clean(node.textContent))
        .filter(Boolean)
        .slice(0, 20);
      let subtitleCandidates = [
        ...(videoData.subtitle?.list || []),
        ...(initialState.subtitle?.list || []),
        ...(window.__playinfo__?.subtitle?.subtitles || [])
      ];
      let fetchedTranscript = [];

      for (const candidate of subtitleCandidates) {
        fetchedTranscript = await fetchSubtitle(candidate);

        if (fetchedTranscript.length > 0) {
          break;
        }
      }

      if (fetchedTranscript.length === 0) {
        const playerSubtitleCandidates = await fetchPlayerSubtitleCandidates(aid, cid);
        subtitleCandidates = [...subtitleCandidates, ...playerSubtitleCandidates];

        for (const candidate of playerSubtitleCandidates) {
          fetchedTranscript = await fetchSubtitle(candidate);

          if (fetchedTranscript.length > 0) {
            break;
          }
        }
      }

      return {
        title: clean(document.querySelector('h1')?.textContent || videoData.title || document.title),
        author: clean(document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || ''),
        description: clean(readMeta('description') || textFrom(['.desc-info-text', '.video-desc', '[class*="desc"]'])),
        tags,
        bvid: clean(videoData.bvid || location.pathname.match(/BV[0-9A-Za-z]+/)?.[0] || ''),
        aid: Number(aid) || undefined,
        cid: Number(cid) || undefined,
        partNumber: Number(currentPage.page) || requestedPart || undefined,
        partTitle: clean(currentPage.part || ''),
        partDurationSeconds: Number.isFinite(Number(currentPage.duration)) ? Number(currentPage.duration) : undefined,
        url: location.href,
        subtitleCandidates,
        transcript: fetchedTranscript
      };
    })();
  `
}
