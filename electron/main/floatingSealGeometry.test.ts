import { describe, expect, it } from 'vitest'
import {
  createAssistantPanelPosition,
  createFloatingAssistantBounds,
  createFloatingHostBounds,
  createInitialFloatingSealVisualBounds,
  createFloatingVisualBounds,
  createFloatingMenuBounds,
  createFixedFloatingSealBounds,
  createFloatingSealDragPosition,
  createFloatingSealResizeBounds,
  createFloatingSealStepResizeBounds
} from './floatingSealGeometry'

describe('floating seal geometry', () => {
  it('uses a compact square shell that only leaves room for the round seal and shadow', () => {
    expect(
      createFloatingSealDragPosition({
        startBounds: { x: 100, y: 200, width: 84, height: 84 },
        startCursor: { x: 142, y: 242 },
        currentCursor: { x: 168, y: 260 }
      })
    ).toEqual({ x: 126, y: 218 })
  })

  it('keeps the seal under the cursor using absolute screen coordinates', () => {
    expect(
      createFloatingSealDragPosition({
        startBounds: { x: 100, y: 200, width: 92, height: 92 },
        startCursor: { x: 140, y: 240 },
        currentCursor: { x: 180, y: 270 }
      })
    ).toEqual({ x: 140, y: 230 })
  })

  it('places the assistant panel beside the floating seal inside the main window', () => {
    expect(
      createAssistantPanelPosition({
        mainBounds: { x: 300, y: 80, width: 1280, height: 820 },
        sealBounds: { x: 180, y: 460, width: 92, height: 92 },
        panelSize: { width: 236, height: 212 }
      })
    ).toEqual({ left: 12, top: 320 })
  })

  it('places the assistant panel to the right of the seal when there is room', () => {
    expect(
      createAssistantPanelPosition({
        mainBounds: { x: 0, y: 0, width: 1280, height: 820 },
        sealBounds: { x: 140, y: 460, width: 92, height: 92 },
        panelSize: { width: 236, height: 212 }
      })
    ).toEqual({ left: 244, top: 400 })
  })
})

describe('floating menu geometry', () => {
  it('places the initial floating pet visual slightly closer to the right edge', () => {
    expect(
      createInitialFloatingSealVisualBounds({
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        visualSize: { width: 280, height: 352 },
        rightMargin: 12
      })
    ).toEqual({ x: 1628, y: 522, width: 280, height: 352 })
  })

  it('restores an oversized floating pet host to the fixed activity area', () => {
    expect(
      createFixedFloatingSealBounds({
        startBounds: { x: 872, y: 520, width: 655, height: 737 }
      })
    ).toEqual({ x: 872, y: 520, width: 336, height: 380 })
  })

  it('expands transparent host bounds around visual content so shadows are not clipped into a square edge', () => {
    expect(
      createFloatingHostBounds({
        visualBounds: { x: 900, y: 520, width: 92, height: 92 },
        padding: 28
      })
    ).toEqual({ x: 872, y: 492, width: 148, height: 148 })
  })

  it('uses the inset visual bounds when positioning panels around a padded transparent host', () => {
    expect(
      createFloatingVisualBounds({
        hostBounds: { x: 872, y: 492, width: 148, height: 148 },
        padding: 28
      })
    ).toEqual({ x: 900, y: 520, width: 92, height: 92 })
  })

  it('supports a wider transparent host for the pet and its speech bubble', () => {
    expect(
      createFloatingHostBounds({
        visualBounds: { x: 900, y: 520, width: 284, height: 164 },
        padding: 28
      })
    ).toEqual({ x: 872, y: 492, width: 340, height: 220 })
  })

  it('supports removing top host padding from the floating pet to avoid a visible empty strip', () => {
    const padding = { top: 0, right: 28, bottom: 28, left: 28 }
    const visualBounds = { x: 900, y: 520, width: 280, height: 352 }
    const hostBounds = createFloatingHostBounds({ visualBounds, padding })

    expect(hostBounds).toEqual({ x: 872, y: 520, width: 336, height: 380 })
    expect(createFloatingVisualBounds({ hostBounds, padding })).toEqual(visualBounds)
  })

  it('resizes the floating pet host proportionally around the pet foot anchor', () => {
    expect(
      createFloatingSealResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        startCursor: { x: 1232, y: 712 },
        currentCursor: { x: 1298, y: 756 }
      })
    ).toEqual({ x: 839, y: 449, width: 406, height: 263 })
  })

  it('shrinks naturally when the foot handle moves inward toward the pet anchor', () => {
    expect(
      createFloatingSealResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        startCursor: { x: 1232, y: 712 },
        currentCursor: { x: 1132, y: 712 }
      })
    ).toEqual({ x: 897, y: 524, width: 291, height: 188 })
  })

  it('keeps floating pet resize inside practical minimum and maximum sizes', () => {
    expect(
      createFloatingSealResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        startCursor: { x: 1232, y: 712 },
        currentCursor: { x: 1042, y: 712 }
      })
    ).toEqual({ x: 912, y: 544, width: 260, height: 168 })
  })

  it('allows several more floating pet resize steps before clamping at the maximum size', () => {
    expect(
      createFloatingSealResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        startCursor: { x: 1232, y: 712 },
        currentCursor: { x: 1832, y: 1112 }
      })
    ).toEqual({ x: 702, y: 272, width: 680, height: 440 })
  })

  it('steps the floating pet larger around the pet foot anchor', () => {
    expect(
      createFloatingSealStepResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        step: 1
      })
    ).toEqual({ x: 855, y: 470, width: 374, height: 242 })
  })

  it('steps the floating pet smaller around the pet foot anchor', () => {
    expect(
      createFloatingSealStepResizeBounds({
        startBounds: { x: 872, y: 492, width: 340, height: 220 },
        step: -1
      })
    ).toEqual({ x: 889, y: 514, width: 306, height: 198 })
  })

  it('places the system menu above the seal when there is room', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 520, width: 92, height: 92 },
        menuSize: { width: 184, height: 248 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 854, y: 260, width: 184, height: 248 })
  })

  it('flips the system menu below the seal near the top edge', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 24, width: 92, height: 92 },
        menuSize: { width: 184, height: 248 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 854, y: 128, width: 184, height: 248 })
  })

  it('clamps the system menu inside the active work area', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 1210, y: 790, width: 92, height: 92 },
        menuSize: { width: 184, height: 248 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 1084, y: 530, width: 184, height: 248 })
  })

  it('supports work areas with negative screen coordinates', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: -1200, y: 500, width: 92, height: 92 },
        menuSize: { width: 184, height: 248 },
        workArea: { x: -1280, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: -1246, y: 240, width: 184, height: 248 })
  })
})

describe('floating assistant geometry', () => {
  it('uses a 2px safety gap around the pet and screen edges by default', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 16, y: 500, width: 92, height: 92 },
        workspaceSize: { width: 360, height: 560 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      })
    ).toEqual({ x: 110, y: 266, width: 360, height: 560, side: 'right' })
  })

  it('places the assistant workspace to the left of a right-side seal', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 1700, y: 500, width: 92, height: 92 },
        workspaceSize: { width: 360, height: 560 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        gap: 12
      })
    ).toEqual({ x: 1328, y: 266, width: 360, height: 560, side: 'left' })
  })

  it('flips the assistant workspace to the right when the seal is near the left edge', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 16, y: 500, width: 92, height: 92 },
        workspaceSize: { width: 360, height: 560 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        gap: 12
      })
    ).toEqual({ x: 120, y: 266, width: 360, height: 560, side: 'right' })
  })

  it('shrinks the assistant workspace into the wider side of a small work area', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 300, y: 330, width: 72, height: 72 },
        workspaceSize: { width: 360, height: 560 },
        workArea: { x: 0, y: 0, width: 420, height: 480 },
        gap: 12
      })
    ).toEqual({ x: 12, y: 12, width: 276, height: 456, side: 'left' })
  })

  it('never crosses the pet protection gap when neither side fits the standard width', () => {
    const sealBounds = { x: 260, y: 300, width: 160, height: 220 }
    const result = createFloatingAssistantBounds({
      sealBounds,
      workspaceSize: { width: 460, height: 680 },
      workArea: { x: 0, y: 0, width: 700, height: 760 },
      gap: 12
    })

    expect(result).toEqual({ x: 432, y: 68, width: 256, height: 680, side: 'right' })
    expect(result.x).toBeGreaterThanOrEqual(sealBounds.x + sealBounds.width + 12)
  })

  it('keeps the current side when both sides have equal space', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 440, y: 300, width: 120, height: 220 },
        workspaceSize: { width: 360, height: 560 },
        workArea: { x: 0, y: 0, width: 1000, height: 800 },
        currentSide: 'right',
        gap: 12
      })
    ).toEqual({ x: 572, y: 130, width: 360, height: 560, side: 'right' })
  })

  it('flips an existing assistant to the newly wider side after the pet moves', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: 80, y: 300, width: 160, height: 220 },
        workspaceSize: { width: 460, height: 680 },
        workArea: { x: 0, y: 0, width: 1200, height: 800 },
        currentSide: 'left',
        gap: 12
      })
    ).toEqual({ x: 252, y: 70, width: 460, height: 680, side: 'right' })
  })

  it('keeps the side-constrained assistant inside a display with negative coordinates', () => {
    expect(
      createFloatingAssistantBounds({
        sealBounds: { x: -400, y: 400, width: 336, height: 380 },
        workspaceSize: { width: 460, height: 680 },
        workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
        gap: 12
      })
    ).toEqual({ x: -872, y: 250, width: 460, height: 680, side: 'left' })
  })
})
