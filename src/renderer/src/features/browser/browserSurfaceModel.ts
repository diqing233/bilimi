import { BILIBILI_HOME_URL, BILIMI_SESSION_PARTITION } from '@shared/constants'
import type { BrowserSurfaceModel } from '@shared/types'

export function createBrowserSurfaceModel(): BrowserSurfaceModel {
  return {
    src: BILIBILI_HOME_URL,
    partition: BILIMI_SESSION_PARTITION,
    allowpopups: 'true'
  }
}
