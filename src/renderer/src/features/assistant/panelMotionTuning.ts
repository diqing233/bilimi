export type PanelMotionTuning = {
  sidebarExpandMs: number
  sidebarCollapseMs: number
  drawerExpandMs: number
  drawerCollapseMs: number
  drawerCloseMs: number
}

export const DEFAULT_PANEL_MOTION_TUNING: PanelMotionTuning = {
  sidebarExpandMs: 220,
  sidebarCollapseMs: 180,
  drawerExpandMs: 220,
  drawerCollapseMs: 170,
  drawerCloseMs: 170
}

const PANEL_MOTION_TUNING_STORAGE_KEY = 'bilimi:panel-motion-tuning'

function savedPanelMotionTuning(): PanelMotionTuning {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_MOTION_TUNING_STORAGE_KEY) ?? '{}') as Partial<PanelMotionTuning>
    return {
      sidebarExpandMs: saved.sidebarExpandMs ?? DEFAULT_PANEL_MOTION_TUNING.sidebarExpandMs,
      sidebarCollapseMs: saved.sidebarCollapseMs ?? DEFAULT_PANEL_MOTION_TUNING.sidebarCollapseMs,
      drawerExpandMs: saved.drawerExpandMs ?? DEFAULT_PANEL_MOTION_TUNING.drawerExpandMs,
      drawerCollapseMs: saved.drawerCollapseMs ?? DEFAULT_PANEL_MOTION_TUNING.drawerCollapseMs,
      drawerCloseMs: saved.drawerCloseMs ?? DEFAULT_PANEL_MOTION_TUNING.drawerCloseMs
    }
  } catch {
    return { ...DEFAULT_PANEL_MOTION_TUNING }
  }
}

let currentPanelMotionTuning = savedPanelMotionTuning()
const listeners = new Set<(tuning: PanelMotionTuning) => void>()

export function applyPanelMotionTuning(tuning: PanelMotionTuning) {
  currentPanelMotionTuning = tuning
  const style = document.documentElement.style
  style.setProperty('--panel-sidebar-expand-duration', `${tuning.sidebarExpandMs}ms`)
  style.setProperty('--panel-sidebar-collapse-duration', `${tuning.sidebarCollapseMs}ms`)
  style.setProperty('--panel-drawer-expand-duration', `${tuning.drawerExpandMs}ms`)
  style.setProperty('--panel-drawer-collapse-duration', `${tuning.drawerCollapseMs}ms`)
  style.setProperty('--panel-drawer-close-duration', `${tuning.drawerCloseMs}ms`)
  window.localStorage.setItem(PANEL_MOTION_TUNING_STORAGE_KEY, JSON.stringify(tuning))
  listeners.forEach((listener) => listener(tuning))
}

export function panelMotionTuning() {
  return currentPanelMotionTuning
}

export function updatePanelMotionTuning(patch: Partial<PanelMotionTuning>) {
  applyPanelMotionTuning({ ...currentPanelMotionTuning, ...patch })
}

export function resetPanelMotionTuning() {
  window.localStorage.removeItem(PANEL_MOTION_TUNING_STORAGE_KEY)
  applyPanelMotionTuning({ ...DEFAULT_PANEL_MOTION_TUNING })
  window.localStorage.removeItem(PANEL_MOTION_TUNING_STORAGE_KEY)
}

export function subscribePanelMotionTuning(listener: (tuning: PanelMotionTuning) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function closeDurationFor(tuning: PanelMotionTuning, action: 'sidebar-collapse' | 'drawer-collapse' | 'drawer-close') {
  if (action === 'sidebar-collapse') return tuning.sidebarCollapseMs
  if (action === 'drawer-collapse') return tuning.drawerCollapseMs
  return tuning.drawerCloseMs
}

applyPanelMotionTuning(currentPanelMotionTuning)
