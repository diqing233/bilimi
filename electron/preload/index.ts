import { contextBridge, ipcRenderer } from 'electron'
import type { AssistantPreferences } from '../main/store'
import type { AssistantAction, VideoNote } from '../../src/shared/types'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  closeFloatingMenu: () => ipcRenderer.send('floating-menu:close'),
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadVideoNotes: () => ipcRenderer.invoke('video-notes:load') as Promise<VideoNote[]>,
  finishFloatingSealDrag: () => ipcRenderer.send('floating-seal:finish-drag'),
  moveFloatingSealBy: (deltaX: number, deltaY: number) =>
    ipcRenderer.invoke('floating-seal:move-by', deltaX, deltaY) as Promise<void>,
  moveFloatingSealTo: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:move-to', screenX, screenY),
  openAssistant: () => ipcRenderer.invoke('assistant:open-from-floating-seal') as Promise<void>,
  onOpenAssistant: (callback: (payload?: { position?: { left: number; top: number } }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload?: { position?: { left: number; top: number } }
    ) => callback(payload)

    ipcRenderer.on('assistant:open', listener)

    return () => {
      ipcRenderer.removeListener('assistant:open', listener)
    }
  },
  onOpenInTab: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)

    ipcRenderer.on('browser:open-in-tab', listener)

    return () => {
      ipcRenderer.removeListener('browser:open-in-tab', listener)
    }
  },
  onRunAssistantAction: (callback: (payload: { action: AssistantAction }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { action: AssistantAction }
    ) => callback(payload)

    ipcRenderer.on('assistant:run-action', listener)

    return () => {
      ipcRenderer.removeListener('assistant:run-action', listener)
    }
  },
  runFloatingMenuAction: (action: AssistantAction) =>
    ipcRenderer.invoke('floating-menu:run-action', action) as Promise<void>,
  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>,
  startFloatingSealDrag: (screenX: number, screenY: number) =>
    ipcRenderer.send('floating-seal:start-drag', screenX, screenY),
  toggleFloatingMenu: () => ipcRenderer.invoke('floating-menu:toggle') as Promise<void>
})
