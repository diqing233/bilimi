import { describe, expect, it } from 'vitest'
import { createPosterSvgDataUrl, normalizePosterSummary } from './notePoster'
import type { NotePosterSummary } from '@shared/types'

const summary: NotePosterSummary = {
  title: '  Learning Types  ',
  subtitle: '  A compact note  ',
  keyPoints: [' one ', 'two', '', 'three', 'four', 'five', 'six'],
  keywords: [' ts ', 'ai', '', 'poster'],
  prompt: '  clean porcelain poster  '
}

describe('note poster helpers', () => {
  it('normalizes poster summaries to compact bounded text', () => {
    expect(normalizePosterSummary(summary)).toEqual({
      title: 'Learning Types',
      subtitle: 'A compact note',
      keyPoints: ['one', 'two', 'three', 'four', 'five'],
      keywords: ['ts', 'ai', 'poster'],
      prompt: 'clean porcelain poster'
    })
  })

  it('creates an SVG data URL containing encoded poster text', () => {
    const url = createPosterSvgDataUrl(summary)

    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(url).toContain('Learning%20Types')
    expect(url).toContain('A%20compact%20note')
    expect(decodeURIComponent(url)).toContain('one')
  })
})
