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
const FLOATING_SEAL_MIN_SIZE = { width: 300, height: 190 }
const FLOATING_SEAL_MAX_SIZE = { width: 560, height: 440 }

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

export function createFloatingSealResizeBounds({
  startBounds,
  startCursor,
  currentCursor,
  minSize = FLOATING_SEAL_MIN_SIZE,
  maxSize = FLOATING_SEAL_MAX_SIZE
}: {
  startBounds: Bounds
  startCursor: Point
  currentCursor: Point
  minSize?: Size
  maxSize?: Size
}): Bounds {
  const widthDelta = currentCursor.x - startCursor.x
  const heightDelta = currentCursor.y - startCursor.y
  const startRatio = startBounds.width / startBounds.height
  const scale = Math.max(
    (startBounds.width + widthDelta) / startBounds.width,
    (startBounds.height + heightDelta) / startBounds.height
  )
  const minScale = Math.max(minSize.width / startBounds.width, minSize.height / startBounds.height)
  const maxScale = Math.min(maxSize.width / startBounds.width, maxSize.height / startBounds.height)
  const nextScale = clamp(scale, minScale, maxScale)
  const height = Math.round(startBounds.height * nextScale)
  const width = Math.round(height * startRatio)
  const footAnchor = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height
  }

  return {
    x: Math.round(footAnchor.x - width / 2),
    y: Math.round(footAnchor.y - height),
    width,
    height
  }
}

export function createFloatingHostBounds({
  visualBounds,
  padding
}: {
  visualBounds: Bounds
  padding: number
}): Bounds {
  return {
    x: visualBounds.x - padding,
    y: visualBounds.y - padding,
    width: visualBounds.width + padding * 2,
    height: visualBounds.height + padding * 2
  }
}

export function createFloatingVisualBounds({
  hostBounds,
  padding
}: {
  hostBounds: Bounds
  padding: number
}): Bounds {
  return {
    x: hostBounds.x + padding,
    y: hostBounds.y + padding,
    width: Math.max(0, hostBounds.width - padding * 2),
    height: Math.max(0, hostBounds.height - padding * 2)
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

export function createFloatingAssistantBounds({
  sealBounds,
  workspaceSize,
  workArea,
  gap = DEFAULT_GAP
}: {
  sealBounds: Bounds
  workspaceSize: Size
  workArea: Bounds
  gap?: number
}): Bounds {
  const width = Math.min(workspaceSize.width, Math.max(0, workArea.width - gap * 2))
  const height = Math.min(workspaceSize.height, Math.max(0, workArea.height - gap * 2))
  const minX = workArea.x + gap
  const maxX = workArea.x + workArea.width - width - gap
  const minY = workArea.y + gap
  const maxY = workArea.y + workArea.height - height - gap
  const leftOfSeal = sealBounds.x - width - gap
  const rightOfSeal = sealBounds.x + sealBounds.width + gap
  const centeredX = sealBounds.x + Math.round((sealBounds.width - width) / 2)
  const preferredX =
    leftOfSeal >= minX
      ? leftOfSeal
      : rightOfSeal + width <= workArea.x + workArea.width - gap
        ? rightOfSeal
        : centeredX
  const centeredY = sealBounds.y + Math.round((sealBounds.height - height) / 2)

  return {
    x: clamp(Math.round(preferredX), minX, Math.max(minX, maxX)),
    y: clamp(Math.round(centeredY), minY, Math.max(minY, maxY)),
    width,
    height
  }
}
