type Point = {
  x: number
  y: number
}

type Size = {
  width: number
  height: number
}

type Bounds = Point & Size

type OverlayPosition = {
  left: number
  top: number
}

const DEFAULT_GAP = 12

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function createFloatingSealDragPosition({
  startBounds,
  startCursor,
  currentCursor
}: {
  startBounds: Bounds
  startCursor: Point
  currentCursor: Point
}): Point {
  return {
    x: Math.round(startBounds.x + currentCursor.x - startCursor.x),
    y: Math.round(startBounds.y + currentCursor.y - startCursor.y)
  }
}

export function createAssistantPanelPosition({
  mainBounds,
  sealBounds,
  panelSize,
  gap = DEFAULT_GAP
}: {
  mainBounds: Bounds
  sealBounds: Bounds
  panelSize: Size
  gap?: number
}): OverlayPosition {
  const mainMaxLeft = Math.max(gap, mainBounds.width - panelSize.width - gap)
  const mainMaxTop = Math.max(gap, mainBounds.height - panelSize.height - gap)
  const rightOfSeal = sealBounds.x + sealBounds.width + gap - mainBounds.x
  const leftOfSeal = sealBounds.x - panelSize.width - gap - mainBounds.x
  const preferredLeft =
    rightOfSeal + panelSize.width <= mainBounds.width - gap
      ? rightOfSeal
      : leftOfSeal >= gap
        ? leftOfSeal
        : sealBounds.x < mainBounds.x
          ? gap
          : mainMaxLeft
  const centeredTop =
    sealBounds.y + Math.round((sealBounds.height - panelSize.height) / 2) - mainBounds.y

  return {
    left: clamp(Math.round(preferredLeft), gap, mainMaxLeft),
    top: clamp(Math.round(centeredTop), gap, mainMaxTop)
  }
}

export function createFloatingMenuBounds({
  sealBounds,
  menuSize,
  workArea,
  gap = DEFAULT_GAP
}: {
  sealBounds: Bounds
  menuSize: Size
  workArea: Bounds
  gap?: number
}): Bounds {
  const centeredX = sealBounds.x + Math.round((sealBounds.width - menuSize.width) / 2)
  const aboveY = sealBounds.y - menuSize.height - gap
  const belowY = sealBounds.y + sealBounds.height + gap
  const preferredY =
    aboveY >= workArea.y
      ? aboveY
      : belowY + menuSize.height <= workArea.y + workArea.height
        ? belowY
        : sealBounds.y >= workArea.y + workArea.height / 2
          ? aboveY
          : belowY

  const minX = workArea.x + gap
  const maxX = workArea.x + workArea.width - menuSize.width - gap
  const minY = workArea.y + gap
  const maxY = workArea.y + workArea.height - menuSize.height - gap

  return {
    x: clamp(Math.round(centeredX), minX, Math.max(minX, maxX)),
    y: clamp(Math.round(preferredY), minY, Math.max(minY, maxY)),
    width: menuSize.width,
    height: menuSize.height
  }
}
