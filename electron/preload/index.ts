import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0',
  loadPreferences: () => ipcRenderer.invoke('assistant:load-preferences'),
  savePreferences: (preferenceCounts: Record<string, number>) =>
    ipcRenderer.invoke('assistant:save-preferences', preferenceCounts)
})
