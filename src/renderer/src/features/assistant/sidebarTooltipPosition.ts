type TooltipAnchor = {
  top: number
  bottom: number
  left: number
  right: number
}

type TooltipSize = {
  width: number
  height: number
}

type TooltipViewport = {
  width: number
  height: number
}

const DEFAULT_GUTTER = 8

export function resolveSidebarTooltipPosition(
  anchor: TooltipAnchor,
  tooltip: TooltipSize,
  viewport: TooltipViewport,
  gutter = DEFAULT_GUTTER
) {
  const preferredLeft = anchor.left - tooltip.width - gutter
  const fallbackLeft = anchor.right + gutter
  const canPlaceLeft = preferredLeft >= gutter
  const canPlaceRight = fallbackLeft + tooltip.width <= viewport.width - gutter
  const left = canPlaceLeft
    ? preferredLeft
    : canPlaceRight
      ? fallbackLeft
      : Math.max(gutter, Math.min(anchor.left, viewport.width - tooltip.width - gutter))

  if (canPlaceLeft || canPlaceRight) {
    return {
      top: Math.max(gutter, Math.min(anchor.top, viewport.height - tooltip.height - gutter)),
      left
    }
  }

  const below = anchor.bottom + gutter
  const above = anchor.top - tooltip.height - gutter
  return {
    top: below + tooltip.height <= viewport.height - gutter
      ? below
      : above >= gutter
        ? above
        : Math.max(gutter, Math.min(below, viewport.height - tooltip.height - gutter)),
    left
  }
}
