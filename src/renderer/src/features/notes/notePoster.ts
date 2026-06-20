import type { NotePosterSummary } from '@shared/types'

function cleanText(value: string, fallback = ''): string {
  return value.replace(/\s+/g, ' ').trim() || fallback
}

function cleanList(values: string[], limit: number): string[] {
  return values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .slice(0, limit)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function normalizePosterSummary(summary: NotePosterSummary): NotePosterSummary {
  return {
    title: cleanText(summary.title, 'Untitled note').slice(0, 48),
    subtitle: cleanText(summary.subtitle).slice(0, 72),
    keyPoints: cleanList(summary.keyPoints, 5).map((point) => point.slice(0, 90)),
    keywords: cleanList(summary.keywords, 8).map((keyword) => keyword.slice(0, 24)),
    prompt: cleanText(summary.prompt).slice(0, 120)
  }
}

export function createPosterSvgDataUrl(summary: NotePosterSummary): string {
  const normalized = normalizePosterSummary(summary)
  const keyPoints = normalized.keyPoints
    .map(
      (point, index) =>
        `<text x="86" y="${250 + index * 54}" class="point">${index + 1}. ${escapeXml(point)}</text>`
    )
    .join('')
  const keywords = normalized.keywords
    .map(
      (keyword, index) =>
        `<text x="${86 + index * 104}" y="620" class="tag">#${escapeXml(keyword)}</text>`
    )
    .join('')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="680" viewBox="0 0 900 680">
  <style>
    .bg{fill:#f7fbff}
    .panel{fill:#ffffff;stroke:#74c7df;stroke-width:2}
    .kicker{fill:#1f63b5;font:700 24px sans-serif}
    .title{fill:#071a33;font:700 46px sans-serif}
    .subtitle{fill:#54749b;font:24px sans-serif}
    .point{fill:#18375f;font:26px sans-serif}
    .tag{fill:#174577;font:700 19px sans-serif}
  </style>
  <rect class="bg" width="900" height="680"/>
  <rect class="panel" x="46" y="42" width="808" height="596" rx="18"/>
  <text x="86" y="112" class="kicker">Bilimi One-Image Summary</text>
  <text x="86" y="176" class="title">${escapeXml(normalized.title)}</text>
  <text x="86" y="216" class="subtitle">${escapeXml(normalized.subtitle)}</text>
  ${keyPoints}
  ${keywords}
</svg>`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
