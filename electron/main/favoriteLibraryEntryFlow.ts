export type FavoriteLibraryDrawerCommand = 'toggle' | 'reveal'

type FavoriteLibraryWindow = {
  isRuntimeReady: () => boolean
  onceRuntimeReady: (listener: () => void) => void
  webContents: {
    id: number
    isLoadingMainFrame: () => boolean
    once: (event: 'did-finish-load', listener: () => void) => void
    send: (channel: string, command: FavoriteLibraryDrawerCommand) => void
  }
}

export function sendFavoriteLibraryCommandWhenReady(
  window: FavoriteLibraryWindow,
  command: FavoriteLibraryDrawerCommand
) {
  const send = () => window.webContents.send('favorite-library:drawer-command', command)
  const sendWhenRuntimeReady = () => {
    if (window.isRuntimeReady()) {
      send()
      return
    }
    window.onceRuntimeReady(send)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', sendWhenRuntimeReady)
    return
  }
  sendWhenRuntimeReady()
}

export function handleFavoriteLibraryEntry<TWindow extends FavoriteLibraryWindow>(args: {
  senderId: number
  mainWindow: TWindow | null
  restoreMainWindow: () => TWindow
}) {
  const fromMainWindow = args.senderId === args.mainWindow?.webContents.id
  const target = fromMainWindow ? args.mainWindow : args.restoreMainWindow()
  if (!target) throw new Error('Favorite library main window is unavailable.')
  sendFavoriteLibraryCommandWhenReady(target, fromMainWindow ? 'toggle' : 'reveal')
}
