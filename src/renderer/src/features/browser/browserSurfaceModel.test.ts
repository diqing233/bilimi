import { describe, expect, it } from 'vitest'

import { createBrowserSurfaceModel } from './browserSurfaceModel'

describe('createBrowserSurfaceModel', () => {
  it('returns the persistent Bilimi Bilibili surface config', () => {
    expect(createBrowserSurfaceModel()).toEqual({
      src: 'https://www.bilibili.com',
      partition: 'persist:bilimi',
      allowpopups: 'true'
    })
  })
})
