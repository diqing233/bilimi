import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { downloads } from './setup-media-tools.mjs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

describe('Windows installer packaging config', () => {
  it('includes release metadata used by the Windows installer', () => {
    expect(packageJson.description).toContain('Bilibili')
    expect(packageJson.author).toBe('diqing')
  })

  it('builds an assisted NSIS installer with the custom user-selectable directory page', () => {
    expect(packageJson.scripts).toMatchObject({
      dist: 'npm ci && npm run build && electron-builder',
      'dist:win':
        'npm ci && npm run build && npm run setup:electron && npm run setup:media-tools && set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/&& electron-builder --win nsis --publish never'
    })
    expect(packageJson.build.nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: false,
      include: 'electron/installer/installer.nsh'
    })
  })

  it('uses bilimi as the packaged executable and install subfolder name', () => {
    expect(packageJson.build.executableName).toBe('bilimi')
    expect(packageJson.build.win.executableName).toBe('bilimi')
  })

  it('uses the locally installed Electron runtime for reproducible packaging', () => {
    expect(packageJson.build.electronDist).toBe('node_modules/electron/dist')
  })

  it('ships the compiled app, local tools, and the shared app icon', () => {
    expect(packageJson.build.files).toContain('out/**')
    expect(packageJson.build.files).toContain('build/icon.ico')
    expect(packageJson.build.win.icon).toBe('build/icon.ico')
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'tools/win32',
      to: 'tools/win32'
    })
  })

  it('pins SHA-256 checksums for every bundled Windows media artifact', () => {
    expect(downloads.win32.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true)
  })
})
