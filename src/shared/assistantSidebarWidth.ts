export const ASSISTANT_SIDEBAR_MIN_WIDTH_PX = 320
export const ASSISTANT_SIDEBAR_MEDIUM_MIN_WIDTH_PX = 288
export const ASSISTANT_SIDEBAR_COMPACT_MIN_WIDTH_PX = 272
export const ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX = 384
export const ASSISTANT_SIDEBAR_MAX_WIDTH_PX = 486
export const ASSISTANT_SIDEBAR_MAX_WINDOW_RATIO = 0.38

export function getAssistantSidebarMinWidthPx(windowWidth: number): number {
  if (windowWidth < 1120) {
    return ASSISTANT_SIDEBAR_COMPACT_MIN_WIDTH_PX
  }

  if (windowWidth < 1280) {
    return ASSISTANT_SIDEBAR_MEDIUM_MIN_WIDTH_PX
  }

  return ASSISTANT_SIDEBAR_MIN_WIDTH_PX
}

export function getAssistantSidebarDefaultWidthPx(windowWidth: number): number {
  if (windowWidth < 1120) {
    return 288
  }

  if (windowWidth < 1280) {
    return 320
  }

  return ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX
}

export function getAssistantSidebarMaxWidthPx(windowWidth: number): number {
  const minWidth = getAssistantSidebarMinWidthPx(windowWidth)

  return Math.max(
    minWidth,
    Math.floor(Math.min(ASSISTANT_SIDEBAR_MAX_WIDTH_PX, windowWidth * ASSISTANT_SIDEBAR_MAX_WINDOW_RATIO))
  )
}

export function clampAssistantSidebarWidthPx(
  width: number,
  windowWidth = ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX / 0.24
): number {
  const minWidth = getAssistantSidebarMinWidthPx(windowWidth)
  const maxWidth = getAssistantSidebarMaxWidthPx(windowWidth)

  return Math.min(Math.max(Math.round(width), minWidth), maxWidth)
}

export function normalizeAssistantSidebarWidthPx(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampAssistantSidebarWidthPx(value)
    : null
}
