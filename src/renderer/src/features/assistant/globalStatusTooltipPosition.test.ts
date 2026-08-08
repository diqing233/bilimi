import { describe, expect, it } from 'vitest'
import { resolveGlobalStatusLightTooltipPosition } from './globalStatusTooltipPosition'

describe('resolveGlobalStatusLightTooltipPosition', () => {
  const viewport = { width: 1_600, height: 900 }
  const panel = { top: 100, bottom: 168, left: 1_200, right: 1_600 }
  const tooltip = { width: 360, height: 96 }

  it('keeps the first DeepSeek light tooltip immediately to the left of its own light', () => {
    expect(resolveGlobalStatusLightTooltipPosition({
      id: 'deepseek',
      anchor: { top: 134, bottom: 154, left: 1_210, right: 1_320 },
      panel,
      tooltip,
      viewport
    })).toEqual({ top: 134, left: 842 })
  })

  it.each(['transcription', 'ledger'] as const)('centers the %s tooltip beneath the complete status panel', (id) => {
    expect(resolveGlobalStatusLightTooltipPosition({
      id,
      anchor: { top: 134, bottom: 154, left: 1_335, right: 1_465 },
      panel,
      tooltip,
      viewport
    })).toEqual({ top: 176, left: 1_220 })
  })

  it('keeps panel-centered tooltips visible when the sidebar is narrower than the card', () => {
    expect(resolveGlobalStatusLightTooltipPosition({
      id: 'transcription',
      anchor: { top: 134, bottom: 154, left: 96, right: 184 },
      panel: { top: 100, bottom: 168, left: 0, right: 280 },
      tooltip: { width: 288, height: 96 },
      viewport: { width: 320, height: 600 }
    })).toEqual({ top: 176, left: 8 })
  })
})
