export const ASSISTANT_SIDEBAR_MIN_WIDTH_PX = 320
export const ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX = 384
export const ASSISTANT_SIDEBAR_MAX_WIDTH_PX = 486
export const ASSISTANT_SIDEBAR_MAX_WINDOW_RATIO = 0.38

export function getAssistantSidebarMaxWidthPx(windowWidth: number): number {
  return Math.max(
    ASSISTANT_SIDEBAR_MIN_WIDTH_PX,
    Math.floor(Math.min(ASSISTANT_SIDEBAR_MAX_WIDTH_PX, windowWidth * ASSISTANT_SIDEBAR_MAX_WINDOW_RATIO))
  )
}

export function clampAssistantSidebarWidthPx(
  width: number,
  windowWidth = ASSISTANT_SIDEBAR_DEFAULT_WIDTH_PX / 0.24
): number {
  const maxWidth = getAssistantSidebarMaxWidthPx(windowWidth)

  return Math.min(Math.max(Math.round(width), ASSISTANT_SIDEBAR_MIN_WIDTH_PX), maxWidth)
}

export function normalizeAssistantSidebarWidthPx(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? clampAssistantSidebarWidthPx(value)
    : null
}
