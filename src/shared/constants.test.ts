import { describe, expect, it } from 'vitest'
import {
  APP_TITLE,
  BILIBILI_HOME_URL,
  BILIMI_FAVORITES_NAME,
  BILIMI_SESSION_PARTITION
} from './constants'

describe('shared constants', () => {
  it('defines the Bilimi shell defaults', () => {
    expect(APP_TITLE).toBe('Bilimi')
    expect(BILIBILI_HOME_URL).toBe('https://www.bilibili.com')
    expect(BILIMI_SESSION_PARTITION).toBe('persist:bilimi')
    expect(BILIMI_FAVORITES_NAME).toBe('Bilimi 内库')
  })
})
