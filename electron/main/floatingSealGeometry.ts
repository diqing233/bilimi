type Point = {
  x: number
  y: number
}

type Size = {
  width: number
  height: number
}

type Bounds = Point & Size
type EdgePadding = {
  top: number
  right: number
  bottom: number
  left: number
}

type OverlayPosition = {
  left: number
  top: number
}

export type FloatingAssistantSide = 'left' | 'right'

type FloatingAssistantBounds = Bounds & {
  side: FloatingAssistantSide
}

const DEFAULT_GAP = 12
const FLOATING_ASSISTANT_GAP = 2
const FLOATING_SEAL_FIXED_SIZE = { width: 336, height: 380 }
const FLOATING_SEAL_MIN_SIZE = { width: 260, height: 168 }
const FLOATING_SEAL_MAX_SIZE = { width: 680, height: 560 }

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizePadding(padding: number | EdgePadding): EdgePadding {
  return typeof padding === 'number'
    ? {
        top: padding,
        right: padding,
        bottom: padding,
        left: padding
      }
    : padding
}

function chooseFloatingAssistantSide({
  leftAvailable,
  rightAvailable,
  workspaceWidth,
  currentSide
}: {
  leftAvailable: number
  rightAvailable: number
  workspaceWidth: number
  currentSide?: FloatingAssistantSide
}): FloatingAssistantSide {
  const leftFits = leftAvailable >= workspaceWidth
  const rightFits = rightAvailable >= workspaceWidth

  if (leftFits !== rightFits) {
    return leftFits ? 'left' : 'right'
  }

  if (leftAvailable === rightAvailable) {
    return currentSide ?? 'left'
  }

  return leftAvailable > rightAvailable ? 'left' : 'right'
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

export function createFloatingSealPositionInsideWorkArea({
  position,
  hostSize,
  workArea,
  padding = 0
}: {
  position: Point
  hostSize: Size
  workArea: Bounds
  padding?: number | EdgePadding
}): Point {
  const edges = normalizePadding(padding)
  const visualWidth = Math.max(0, hostSize.width - edges.left - edges.right)
  const visualHeight = Math.max(0, hostSize.height - edges.top - edges.bottom)
  const minX = workArea.x - edges.left
  const minY = workArea.y - edges.top
  const maxX = workArea.x + Math.max(0, workArea.width - visualWidth) - edges.left
  const maxY = workArea.y + Math.max(0, workArea.height - visualHeight) - edges.top

  return {
    x: clamp(Math.round(position.x), minX, Math.max(minX, maxX)),
    y: clamp(Math.round(position.y), minY, Math.max(minY, maxY))
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
  const startRatio = startBounds.width / startBounds.height
  const widthDelta = currentCursor.x - startCursor.x
  const heightDelta = currentCursor.y - startCursor.y
  const footAnchor = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height
  }
  const scale =
    1 + ((widthDelta / startBounds.width) + (heightDelta / startBounds.height)) / 2
  const minScale = Math.max(minSize.width / startBounds.width, minSize.height / startBounds.height)
  const maxScale = Math.min(maxSize.width / startBounds.width, maxSize.height / startBounds.height)
  const nextScale = clamp(scale, minScale, maxScale)
  const height = Math.round(startBounds.height * nextScale)
  const width = Math.round(height * startRatio)

  return {
    x: Math.round(footAnchor.x - width / 2),
    y: Math.round(footAnchor.y - height),
    width,
    height
  }
}

export function createFloatingSealStepResizeBounds({
  startBounds,
  step,
  stepScale = 0.1,
  minSize = FLOATING_SEAL_MIN_SIZE,
  maxSize = FLOATING_SEAL_MAX_SIZE
}: {
  startBounds: Bounds
  step: number
  stepScale?: number
  minSize?: Size
  maxSize?: Size
}): Bounds {
  const startRatio = startBounds.width / startBounds.height
  const footAnchor = {
    x: startBounds.x + startBounds.width / 2,
    y: startBounds.y + startBounds.height
  }
  const scale = 1 + step * stepScale
  const minScale = Math.max(minSize.width / startBounds.width, minSize.height / startBounds.height)
  const maxScale = Math.min(maxSize.width / startBounds.width, maxSize.height / startBounds.height)
  const nextScale = clamp(scale, minScale, maxScale)
  const height = Math.round(startBounds.height * nextScale)
  const width = Math.round(height * startRatio)

  return {
    x: Math.round(footAnchor.x - width / 2),
    y: Math.round(footAnchor.y - height),
    width,
    height
  }
}

export function createFixedFloatingSealBounds({
  startBounds,
  fixedSize = FLOATING_SEAL_FIXED_SIZE
}: {
  startBounds: Bounds
  fixedSize?: Size
}): Bounds {
  return {
    x: startBounds.x,
    y: startBounds.y,
    width: fixedSize.width,
    height: fixedSize.height
  }
}

export function createFloatingHostBounds({
  visualBounds,
  padding
}: {
  visualBounds: Bounds
  padding: number | EdgePadding
}): Bounds {
  const edges = normalizePadding(padding)

  return {
    x: visualBounds.x - edges.left,
    y: visualBounds.y - edges.top,
    width: visualBounds.width + edges.left + edges.right,
    height: visualBounds.height + edges.top + edges.bottom
  }
}

export function createFloatingHostMovementArea({
  visualWorkArea,
  padding
}: {
  visualWorkArea: Bounds
  padding: number | EdgePadding
}): Bounds {
  const edges = normalizePadding(padding)

  return {
    x: visualWorkArea.x - edges.left,
    y: visualWorkArea.y - edges.top,
    width: visualWorkArea.width + edges.left + edges.right,
    height: visualWorkArea.height + edges.top + edges.bottom
  }
}

export function createInitialFloatingSealVisualBounds({
  workArea,
  visualSize,
  rightMargin
}: {
  workArea: Bounds
  visualSize: Size
  rightMargin: number
}): Bounds {
  return {
    width: visualSize.width,
    height: visualSize.height,
    x: workArea.x + workArea.width - visualSize.width - rightMargin,
    // Keep the pet anchored from the bottom so taller hosts expand upward.
    y: workArea.y + Math.round(workArea.height * 0.84) - visualSize.height
  }
}

export function createFloatingVisualBounds({
  hostBounds,
  padding
}: {
  hostBounds: Bounds
  padding: number | EdgePadding
}): Bounds {
  const edges = normalizePadding(padding)

  return {
    x: hostBounds.x + edges.left,
    y: hostBounds.y + edges.top,
    width: Math.max(0, hostBounds.width - edges.left - edges.right),
    height: Math.max(0, hostBounds.height - edges.top - edges.bottom)
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
  currentSide,
  gap = FLOATING_ASSISTANT_GAP
}: {
  sealBounds: Bounds
  workspaceSize: Size
  workArea: Bounds
  currentSide?: FloatingAssistantSide
  gap?: number
}): FloatingAssistantBounds {
  const height = Math.min(workspaceSize.height, Math.max(0, workArea.height - gap * 2))
  const minX = workArea.x + gap
  const maxRight = workArea.x + workArea.width - gap
  const minY = workArea.y + gap
  const maxY = workArea.y + workArea.height - height - gap
  const leftAvailable = Math.max(0, sealBounds.x - gap - minX)
  const rightStart = sealBounds.x + sealBounds.width + gap
  const rightAvailable = Math.max(0, maxRight - rightStart)
  const side = chooseFloatingAssistantSide({
    leftAvailable,
    rightAvailable,
    workspaceWidth: workspaceSize.width,
    currentSide
  })
  const width = Math.min(
    workspaceSize.width,
    side === 'left' ? leftAvailable : rightAvailable
  )
  const x = side === 'left' ? sealBounds.x - gap - width : rightStart
  const centeredY = sealBounds.y + Math.round((sealBounds.height - height) / 2)

  return {
    x: Math.round(x),
    y: clamp(Math.round(centeredY), minY, Math.max(minY, maxY)),
    width,
    height,
    side
  }
}
