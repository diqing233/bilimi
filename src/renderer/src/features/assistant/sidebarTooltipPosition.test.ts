import { describe, expect, it } from 'vitest'
import { resolveSidebarTooltipPosition } from './sidebarTooltipPosition'

describe('resolveSidebarTooltipPosition', () => {
  const viewport = { width: 276, height: 600 }
  const tooltip = { width: 244, height: 120 }

  it('uses the space to the left when it fits without covering the trigger', () => {
    expect(resolveSidebarTooltipPosition(
      { top: 200, bottom: 224, left: 260, right: 268 },
      tooltip,
      { width: 600, height: 600 }
    )).toEqual({ top: 200, left: 8 })
  })

  it('falls back to a vertical position when neither side fits', () => {
    expect(resolveSidebarTooltipPosition(
      { top: 200, bottom: 224, left: 252, right: 268 },
      tooltip,
      viewport
    )).toEqual({ top: 232, left: 24 })
  })

  it('uses the space above when a narrow-window tooltip cannot fit below', () => {
    expect(resolveSidebarTooltipPosition(
      { top: 500, bottom: 524, left: 252, right: 268 },
      tooltip,
      viewport
    )).toEqual({ top: 372, left: 24 })
  })
})
