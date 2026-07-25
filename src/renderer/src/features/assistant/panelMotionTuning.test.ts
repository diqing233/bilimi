import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_MOTION_TUNING,
  applyPanelMotionTuning,
  closeDurationFor,
  resetPanelMotionTuning,
  type PanelMotionTuning
} from './panelMotionTuning'

describe('panel motion tuning', () => {
  it('keeps only the five useful panel duration controls', () => {
    expect(Object.keys(DEFAULT_PANEL_MOTION_TUNING).sort()).toEqual([
      'drawerCloseMs',
      'drawerCollapseMs',
      'drawerExpandMs',
      'sidebarCollapseMs',
      'sidebarExpandMs'
    ])
  })

  it('uses a quick, visible default sidebar collapse instead of a delayed ease-in', () => {
    expect(DEFAULT_PANEL_MOTION_TUNING.sidebarCollapseMs).toBe(180)
  })

  it('applies independently adjustable sidebar and drawer timing variables to the document', () => {
    const tuning: PanelMotionTuning = {
      ...DEFAULT_PANEL_MOTION_TUNING,
      sidebarExpandMs: 245,
      sidebarCollapseMs: 145,
      drawerExpandMs: 230,
      drawerCollapseMs: 155,
      drawerCloseMs: 135
    }

    applyPanelMotionTuning(tuning)

    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-expand-duration')).toBe('245ms')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-collapse-duration')).toBe('145ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-expand-duration')).toBe('230ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-collapse-duration')).toBe('155ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-close-duration')).toBe('135ms')
    expect(window.localStorage.getItem('bilimi:panel-motion-tuning')).toContain('"sidebarCollapseMs":145')
    expect(closeDurationFor(tuning, 'drawer-close')).toBe(135)
  })

  it('restores default timings and clears persisted tuning', () => {
    applyPanelMotionTuning({ ...DEFAULT_PANEL_MOTION_TUNING, drawerCloseMs: 125 })

    resetPanelMotionTuning()

    expect(document.documentElement.style.getPropertyValue('--panel-drawer-close-duration')).toBe('170ms')
    expect(window.localStorage.getItem('bilimi:panel-motion-tuning')).toBeNull()
  })
})
