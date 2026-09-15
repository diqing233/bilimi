type Rect = {
  top: number
  bottom: number
  left: number
  right: number
}

type Size = {
  width: number
  height: number
}

type Viewport = {
  width: number
  height: number
}

const GUTTER = 8

export function resolveGlobalStatusLightTooltipPosition({
  id,
  anchor,
  panel,
  tooltip,
  viewport
}: {
  id: 'deepseek' | 'transcription' | 'ledger'
  anchor: Rect
  panel: Rect
  tooltip: Size
  viewport: Viewport
}) {
  const maxLeft = Math.max(GUTTER, viewport.width - tooltip.width - GUTTER)
  if (id === 'deepseek') {
    const leftOfLight = anchor.left - tooltip.width - GUTTER
    const rightOfLight = anchor.right + GUTTER
    return {
      top: Math.max(GUTTER, Math.min(anchor.top, viewport.height - tooltip.height - GUTTER)),
      left: leftOfLight >= GUTTER
        ? leftOfLight
        : Math.max(GUTTER, Math.min(rightOfLight, maxLeft))
    }
  }

  const centeredOnPanel = panel.left + ((panel.right - panel.left) - tooltip.width) / 2
  const belowPanel = panel.bottom + GUTTER
  const abovePanel = panel.top - tooltip.height - GUTTER
  return {
    top: belowPanel + tooltip.height <= viewport.height - GUTTER
      ? belowPanel
      : abovePanel >= GUTTER
        ? abovePanel
        : Math.max(GUTTER, Math.min(belowPanel, viewport.height - tooltip.height - GUTTER)),
    left: Math.max(GUTTER, Math.min(centeredOnPanel, maxLeft))
  }
}
