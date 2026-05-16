import { describe, expect, it } from 'vitest'
import {
  createAssistantPanelPosition,
  createFloatingMenuBounds,
  createFloatingSealDragPosition
} from './floatingSealGeometry'

describe('floating seal geometry', () => {
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
  it('places the system menu above the seal when there is room', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 520, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 868, y: 294, width: 156, height: 214 })
  })

  it('flips the system menu below the seal near the top edge', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 900, y: 24, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 868, y: 128, width: 156, height: 214 })
  })

  it('clamps the system menu inside the active work area', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: 1210, y: 790, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: 0, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: 1112, y: 564, width: 156, height: 214 })
  })

  it('supports work areas with negative screen coordinates', () => {
    expect(
      createFloatingMenuBounds({
        sealBounds: { x: -1200, y: 500, width: 92, height: 92 },
        menuSize: { width: 156, height: 214 },
        workArea: { x: -1280, y: 0, width: 1280, height: 860 }
      })
    ).toEqual({ x: -1232, y: 274, width: 156, height: 214 })
  })
})
