import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('bilimiDesktop', {
  version: '0.1.0'
})
