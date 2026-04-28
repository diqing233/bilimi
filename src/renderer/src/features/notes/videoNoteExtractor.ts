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
      url
    },
    transcript,
    transcriptSource: transcript.length > 0 ? 'auto' : 'manual'
  }
}

export function buildVideoNoteExtractionScript(): string {
  return `
    (() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const readMeta = (name) =>
        document.querySelector('meta[name="' + name + '"],meta[property="' + name + '"]')?.getAttribute('content') || '';
      const textFrom = (selectors) =>
        selectors.map((selector) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent || '').join(' '))
          .filter(Boolean)
          .join(' ');
      const initialState = window.__INITIAL_STATE__ || {};
      const videoData = initialState.videoData || initialState.videoInfo || {};
      const tags = Array.from(document.querySelectorAll('.tag-link,.tag,.video-tag,[class*="tag"] a,[class*="tag"] span'))
        .map((node) => clean(node.textContent))
        .filter(Boolean)
        .slice(0, 20);
      const subtitleCandidates = [
        ...(videoData.subtitle?.list || []),
        ...(initialState.subtitle?.list || []),
        ...(window.__playinfo__?.subtitle?.subtitles || [])
      ];
      const transcript = Array.from(document.querySelectorAll('.bpx-player-subtitle-panel-text,.subtitle-item,[class*="subtitle"]'))
        .map((node, index) => ({ start: null, end: null, text: clean(node.textContent), index }))
        .filter((item) => item.text);

      return {
        title: clean(document.querySelector('h1')?.textContent || videoData.title || document.title),
        author: clean(document.querySelector('.up-name,.username,[class*="up-name"]')?.textContent || videoData.owner?.name || ''),
        description: clean(readMeta('description') || textFrom(['.desc-info-text', '.video-desc', '[class*="desc"]'])),
        tags,
        bvid: clean(videoData.bvid || location.pathname.match(/BV[0-9A-Za-z]+/)?.[0] || ''),
        url: location.href,
        subtitleCandidates,
        transcript
      };
    })();
  `
}
