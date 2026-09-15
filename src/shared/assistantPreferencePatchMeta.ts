import type { AssistantPreferencePatchMeta } from './types'

const SAFE_ORIGIN_PATTERN = /^[A-Za-z0-9_-]+$/
const MAX_ORIGIN_LENGTH = 128

export function createAssistantPreferenceOriginId(): string {
  if (typeof crypto?.randomUUID === 'function') return `sidebar_${crypto.randomUUID()}`
  const bytes = new Uint32Array(4)
  crypto?.getRandomValues?.(bytes)
  const entropy = Array.from(bytes, (value) => value.toString(36)).join('_') || Math.random().toString(36).slice(2)
  return `sidebar_${Date.now().toString(36)}_${entropy}`
}

export function normalizeAssistantPreferencePatchMeta(value: unknown): AssistantPreferencePatchMeta | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { originId, mutationId } = value as Partial<AssistantPreferencePatchMeta>
  if (typeof originId !== 'string' || originId.length === 0 || originId.length > MAX_ORIGIN_LENGTH) return undefined
  if (!SAFE_ORIGIN_PATTERN.test(originId)) return undefined
  if (!Number.isSafeInteger(mutationId) || (mutationId ?? 0) <= 0) return undefined
  return { originId, mutationId: mutationId as number }
}
