import { describe, expect, it } from 'vitest'
import { INSTALL_SUBFOLDER_NAME, normalizeInstallerDirectory } from './installer-directory.mjs'

describe('normalizeInstallerDirectory', () => {
  it('keeps an explicitly selected bilimi directory unchanged', () => {
    expect(normalizeInstallerDirectory('D:\\software\\bilimi')).toBe('D:\\software\\bilimi')
    expect(normalizeInstallerDirectory('D:\\software\\Bilimi\\')).toBe('D:\\software\\Bilimi')
  })

  it('adds the bilimi subfolder when the user selects a parent folder on another drive', () => {
    expect(normalizeInstallerDirectory('D:\\software')).toBe('D:\\software\\bilimi')
  })

  it('adds the bilimi subfolder when the user selects a drive root', () => {
    expect(normalizeInstallerDirectory('E:\\')).toBe('E:\\bilimi')
  })

  it('uses the canonical lower-case folder name', () => {
    expect(INSTALL_SUBFOLDER_NAME).toBe('bilimi')
  })
})
