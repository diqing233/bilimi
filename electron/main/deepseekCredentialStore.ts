import type { DeepSeekKeyStatus } from '../../src/shared/types'

export type CredentialStoreLike = {
  get(key: 'deepseekApiKey' | 'deepseekApiKeyEncrypted'): string | undefined
  set(key: 'deepseekApiKey' | 'deepseekApiKeyEncrypted', value: string): void
}

export type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type LoadedDeepSeekCredential = {
  apiKey: string
  status: DeepSeekKeyStatus
}

const EMPTY_STATUS: DeepSeekKeyStatus = {
  configured: false,
  protection: 'unavailable'
}

export function loadDeepSeekCredential(
  store: CredentialStoreLike,
  safeStorage: SafeStorageLike
): LoadedDeepSeekCredential {
  const encryptedValue = (store.get('deepseekApiKeyEncrypted') ?? '').trim()
  if (encryptedValue) {
    if (!safeStorage.isEncryptionAvailable()) {
      return { apiKey: '', status: { configured: false, protection: 'error' } }
    }

    try {
      const apiKey = safeStorage.decryptString(Buffer.from(encryptedValue, 'base64')).trim()
      return {
        apiKey,
        status: { configured: Boolean(apiKey), protection: apiKey ? 'encrypted' : 'unavailable' }
      }
    } catch {
      return { apiKey: '', status: { configured: false, protection: 'error' } }
    }
  }

  const plaintextValue = (store.get('deepseekApiKey') ?? '').trim()
  if (!plaintextValue) {
    return { apiKey: '', status: EMPTY_STATUS }
  }

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plaintextValue).toString('base64')
    store.set('deepseekApiKeyEncrypted', encrypted)
    store.set('deepseekApiKey', '')
    return {
      apiKey: plaintextValue,
      status: { configured: true, protection: 'encrypted' }
    }
  }

  return {
    apiKey: plaintextValue,
    status: { configured: true, protection: 'plaintext' }
  }
}

export function saveDeepSeekCredential(
  store: CredentialStoreLike,
  safeStorage: SafeStorageLike,
  value: string
): DeepSeekKeyStatus {
  const apiKey = value.trim()
  if (!apiKey) {
    return clearDeepSeekCredential(store)
  }

  if (safeStorage.isEncryptionAvailable()) {
    store.set('deepseekApiKeyEncrypted', safeStorage.encryptString(apiKey).toString('base64'))
    store.set('deepseekApiKey', '')
    return { configured: true, protection: 'encrypted' }
  }

  store.set('deepseekApiKeyEncrypted', '')
  store.set('deepseekApiKey', apiKey)
  return { configured: true, protection: 'plaintext' }
}

export function clearDeepSeekCredential(store: CredentialStoreLike): DeepSeekKeyStatus {
  store.set('deepseekApiKeyEncrypted', '')
  store.set('deepseekApiKey', '')
  return EMPTY_STATUS
}
