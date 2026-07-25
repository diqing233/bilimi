import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PANEL_MOTION_TUNING,
  applyPanelMotionTuning,
  closeDurationFor,
  resetPanelMotionTuning,
  type PanelMotionTuning
} from './panelMotionTuning'

describe('panel motion tuning', () => {
  it('uses a quick, visible default sidebar collapse instead of a delayed ease-in', () => {
    expect(DEFAULT_PANEL_MOTION_TUNING.sidebarCollapseMs).toBe(180)
    expect(DEFAULT_PANEL_MOTION_TUNING.sidebarCollapseEasing).toBe(
      'cubic-bezier(0.16, 1, 0.3, 1)'
    )
  })

  it('applies independently adjustable sidebar and drawer timing variables to the document', () => {
    const tuning: PanelMotionTuning = {
      ...DEFAULT_PANEL_MOTION_TUNING,
      sidebarExpandMs: 245,
      sidebarCollapseMs: 145,
      sidebarExpandEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      sidebarCollapseEasing: 'cubic-bezier(0.7, 0, 1, 0.5)',
      sidebarCollapseOffsetPx: 19,
      drawerExpandMs: 230,
      drawerCollapseMs: 155,
      drawerCloseMs: 135,
      drawerExpandEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      drawerCollapseEasing: 'cubic-bezier(0.7, 0, 1, 0.5)',
      drawerCloseEasing: 'cubic-bezier(0.7, 0, 1, 0.5)',
      drawerCollapseOffsetPx: 17
    }

    applyPanelMotionTuning(tuning)

    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-expand-duration')).toBe('245ms')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-collapse-duration')).toBe('145ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-expand-duration')).toBe('230ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-collapse-duration')).toBe('155ms')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-close-duration')).toBe('135ms')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-expand-easing')).toBe('cubic-bezier(0.16, 1, 0.3, 1)')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-close-easing')).toBe('cubic-bezier(0.7, 0, 1, 0.5)')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-collapse-offset')).toBe('19px')
    expect(document.documentElement.style.getPropertyValue('--panel-drawer-collapse-offset')).toBe('17px')
    expect(window.localStorage.getItem('bilimi:panel-motion-tuning')).toContain('"sidebarCollapseOffsetPx":19')
    expect(closeDurationFor(tuning, 'drawer-close')).toBe(135)
  })

  it('restores default timings and clears persisted tuning', () => {
    applyPanelMotionTuning({ ...DEFAULT_PANEL_MOTION_TUNING, drawerCloseMs: 125 })

    resetPanelMotionTuning()

    expect(document.documentElement.style.getPropertyValue('--panel-drawer-close-duration')).toBe('170ms')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-expand-easing')).toBe('cubic-bezier(0.2, 0.72, 0.24, 1)')
    expect(document.documentElement.style.getPropertyValue('--panel-sidebar-collapse-offset')).toBe('14px')
    expect(window.localStorage.getItem('bilimi:panel-motion-tuning')).toBeNull()
  })
})
