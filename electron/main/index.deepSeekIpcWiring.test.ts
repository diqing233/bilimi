import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('DeepSeek key IPC wiring', () => {
  it('publishes only the key-status patch after clearing a DeepSeek key', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'index.ts'), 'utf8')
    const handler = source.match(/ipcMain\.handle\('deepseek:clear-key',[\s\S]{0,360}?\n  \}\)/)?.[0] ?? ''

    expect(handler).toContain('sendAssistantPreferencePatchChanged({ deepseekApiKeyStored: status.configured })')
    expect(handler).not.toContain('sendAssistantPreferencesChanged')
  })
})
