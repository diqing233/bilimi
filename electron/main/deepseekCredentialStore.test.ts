import { describe, expect, it, vi } from 'vitest'
import {
  clearDeepSeekCredential,
  loadDeepSeekCredential,
  saveDeepSeekCredential,
  type CredentialStoreLike
} from './deepseekCredentialStore'

function createStore(initial: Record<string, string> = {}): CredentialStoreLike & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    get: (key) => values[key] ?? '',
    set: (key, value) => {
      values[key] = value
    }
  }
}

const encryptedStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace('encrypted:', ''))
}

describe('DeepSeek credential store', () => {
  it('migrates a legacy plaintext key into encrypted storage', () => {
    const store = createStore({ deepseekApiKey: 'sk-old' })

    expect(loadDeepSeekCredential(store, encryptedStorage)).toEqual({
      apiKey: 'sk-old',
      status: { configured: true, protection: 'encrypted' }
    })
    expect(store.values.deepseekApiKey).toBe('')
    expect(store.values.deepseekApiKeyEncrypted).toBe(
      Buffer.from('encrypted:sk-old').toString('base64')
    )
  })

  it('falls back to plaintext when system encryption is unavailable', () => {
    const store = createStore()
    const unavailableStorage = {
      ...encryptedStorage,
      isEncryptionAvailable: vi.fn(() => false)
    }

    expect(saveDeepSeekCredential(store, unavailableStorage, ' sk-plain ')).toEqual({
      configured: true,
      protection: 'plaintext'
    })
    expect(store.values.deepseekApiKey).toBe('sk-plain')
    expect(store.values.deepseekApiKeyEncrypted).toBe('')
  })

  it('does not expose ciphertext when decryption fails', () => {
    const store = createStore({ deepseekApiKeyEncrypted: 'not-valid-base64' })
    const brokenStorage = {
      ...encryptedStorage,
      decryptString: vi.fn(() => {
        throw new Error('DPAPI failed')
      })
    }

    expect(loadDeepSeekCredential(store, brokenStorage)).toEqual({
      apiKey: '',
      status: { configured: false, protection: 'error' }
    })
  })

  it('clears encrypted and plaintext representations together', () => {
    const store = createStore({
      deepseekApiKey: 'sk-plain',
      deepseekApiKeyEncrypted: 'ciphertext'
    })

    expect(clearDeepSeekCredential(store)).toEqual({
      configured: false,
      protection: 'unavailable'
    })
    expect(store.values).toMatchObject({ deepseekApiKey: '', deepseekApiKeyEncrypted: '' })
  })
})
