import { APP_TITLE } from '../../src/shared/constants'

type TitleGuardWindow = {
  getTitle: () => string
  on: (event: 'page-title-updated', callback: () => void) => void
  setTitle: (title: string) => void
}

export function keepMainWindowTitle(win: TitleGuardWindow) {
  win.setTitle(APP_TITLE)
  win.on('page-title-updated', () => {
    if (win.getTitle() !== APP_TITLE) {
      win.setTitle(APP_TITLE)
    }
  })
}
