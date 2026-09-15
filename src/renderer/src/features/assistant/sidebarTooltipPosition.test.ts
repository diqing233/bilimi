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

  it('anchors a sidebar help card beside the sidebar panel instead of falling back to the window edge', () => {
    expect(resolveSidebarTooltipPosition(
      { top: 200, bottom: 224, left: 1_208, right: 1_268 },
      { width: 360, height: 120 },
      { width: 1_600, height: 900 },
      { top: 100, bottom: 800, left: 1_200, right: 1_600 }
    )).toEqual({ top: 200, left: 832 })
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
