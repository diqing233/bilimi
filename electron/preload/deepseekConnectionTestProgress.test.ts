import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DeepSeek connection-test progress preload contract', () => {
  it('exposes a removable retry-progress subscription without exposing the IPC sender', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')

    expect(source).toContain('onDeepSeekConnectionTestProgress: (callback:')
    expect(source).toContain("ipcRenderer.on('deepseek:connection-test-progress', listener)")
    expect(source).toContain("ipcRenderer.removeListener('deepseek:connection-test-progress', listener)")
  })
})
