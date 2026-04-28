import { contextBridge, ipcRenderer } from 'electron'
import type { AssistantPreferences } from '../main/store'
import type { VideoNote } from '../../src/shared/types'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences') as Promise<AssistantPreferences>,
  loadVideoNotes: () => ipcRenderer.invoke('video-notes:load') as Promise<VideoNote[]>,
  onOpenInTab: (callback: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)

    ipcRenderer.on('browser:open-in-tab', listener)

    return () => {
      ipcRenderer.removeListener('browser:open-in-tab', listener)
    }
  },
  savePreferences: (preferences: AssistantPreferences) =>
    ipcRenderer.invoke('assistant:save-preferences', preferences) as Promise<AssistantPreferences>,
  saveVideoNote: (note: VideoNote) =>
    ipcRenderer.invoke('video-notes:save', note) as Promise<VideoNote[]>
})
