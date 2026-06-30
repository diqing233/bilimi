import { describe, expect, it } from 'vitest'
import {
  APP_TITLE,
  BILIBILI_HOME_URL,
  BILIMI_FAVORITES_NAME,
  BILIMI_LEDGER_PREFIX,
  BILIMI_SESSION_PARTITION
} from './constants'

describe('shared constants', () => {
  it('keeps the core app constants stable', () => {
    expect(APP_TITLE).toBe('bilimi')
    expect(BILIBILI_HOME_URL).toBe('https://www.bilibili.com')
    expect(BILIMI_SESSION_PARTITION).toBe('persist:bilimi')
    expect(BILIMI_FAVORITES_NAME).toBe('Bilimi 内库')
    expect(BILIMI_LEDGER_PREFIX).toBe('Bilimi·')
  })
})
