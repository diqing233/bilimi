type OldFavoriteRuntimeStore = {
  values: Map<string, unknown>
  revisions: Map<string, number>
  listeners: Set<() => void>
  handlers: Map<string, (...args: never[]) => unknown>
  accountMid: string
  bridgeSubscribed: boolean
}

const GLOBAL_KEY = '__bilimiOldFavoriteRuntimeSession__' as const
const ACCOUNT_INDEPENDENT_KEYS = new Set(['deepSeekConnectionStatus'])

type OldFavoriteRuntimeGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: OldFavoriteRuntimeStore
}

function getStore(): OldFavoriteRuntimeStore {
  const runtimeGlobal = globalThis as OldFavoriteRuntimeGlobal
  runtimeGlobal[GLOBAL_KEY] ??= {
    values: new Map(),
    revisions: new Map(),
    listeners: new Set(),
    handlers: new Map(),
    accountMid: '',
    bridgeSubscribed: false
  }
  const store = runtimeGlobal[GLOBAL_KEY]
  ensureBridgeSubscription(store)
  return store
}

function canUseMainRuntime(key: string): boolean {
  return key !== 'deepSeekArchiveRunId'
}

function notifyRuntimeListeners(store: OldFavoriteRuntimeStore) {
  store.listeners.forEach((listener) => listener())
}

function clearAccountScopedRuntime(store: OldFavoriteRuntimeStore) {
  for (const key of store.values.keys()) {
    if (!ACCOUNT_INDEPENDENT_KEYS.has(key)) {
      store.values.delete(key)
      store.revisions.delete(key)
    }
  }
}

function ensureBridgeSubscription(store: OldFavoriteRuntimeStore) {
  if (store.bridgeSubscribed || typeof window === 'undefined') {
    return
  }

  const subscribe = window.bilimiDesktop?.onOldFavoriteRuntimeChanged
  if (!subscribe) {
    return
  }

  store.bridgeSubscribed = true
  subscribe((message) => {
    if ('type' in message && message.type === 'reset') {
      clearAccountScopedRuntime(store)
      store.accountMid = message.accountMid
      notifyRuntimeListeners(store)
      return
    }

    store.values.set(message.key, message.value)
    store.revisions.set(message.key, message.revision)
    store.accountMid = message.accountMid
    notifyRuntimeListeners(store)
  })
}

export function subscribeOldFavoriteRuntime(listener: () => void) {
  const store = getStore()
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function getOldFavoriteRuntimeValue<T>(key: string, initialValue: T | (() => T)): T {
  const store = getStore()
  if (!store.values.has(key)) {
    const resolvedInitial =
      typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
    const snapshot = canUseMainRuntime(key)
      ? window.bilimiDesktop?.getOldFavoriteRuntimeSnapshot?.(key, resolvedInitial)
      : undefined
    store.values.set(key, snapshot?.value ?? resolvedInitial)
    store.revisions.set(key, snapshot?.revision ?? 0)
    if (snapshot?.accountMid) {
      store.accountMid = snapshot.accountMid
    }
  }
  return store.values.get(key) as T
}

export function setOldFavoriteRuntimeValue<T>(
  key: string,
  nextValue: T | ((current: T) => T)
): boolean {
  const store = getStore()
  const currentValue = store.values.get(key) as T
  const resolvedValue =
    typeof nextValue === 'function'
      ? (nextValue as (current: T) => T)(currentValue)
      : nextValue
  if (Object.is(currentValue, resolvedValue)) {
    return false
  }

  const result = canUseMainRuntime(key)
    ? window.bilimiDesktop?.setOldFavoriteRuntimeValue?.(
        key,
        resolvedValue,
        store.revisions.get(key) ?? 0
      )
    : undefined
  store.values.set(key, (result?.value ?? resolvedValue) as T)
  store.revisions.set(key, result?.revision ?? (store.revisions.get(key) ?? 0) + 1)
  if (result?.accountMid) {
    store.accountMid = result.accountMid
  }
  notifyRuntimeListeners(store)
  return result?.accepted ?? true
}

export function bindOldFavoriteRuntimeAccount(accountMid: string): boolean {
  const normalizedAccountMid = accountMid.trim()
  if (!normalizedAccountMid) {
    return false
  }

  const store = getStore()
  const bridgeChanged = window.bilimiDesktop?.bindOldFavoriteRuntimeAccount?.(normalizedAccountMid)
  if (bridgeChanged) {
    clearAccountScopedRuntime(store)
    store.accountMid = normalizedAccountMid
    notifyRuntimeListeners(store)
    return true
  }
  if (!store.accountMid || store.accountMid === normalizedAccountMid) {
    store.accountMid = normalizedAccountMid
    return false
  }

  clearAccountScopedRuntime(store)
  store.accountMid = normalizedAccountMid
  notifyRuntimeListeners(store)
  return true
}

export function registerOldFavoriteRuntimeHandler<Args extends unknown[]>(
  key: string,
  handler: (...args: Args) => unknown
) {
  const store = getStore()
  const storedHandler = handler as (...args: never[]) => unknown
  store.handlers.set(key, storedHandler)
  return () => {
    if (store.handlers.get(key) === storedHandler) {
      store.handlers.delete(key)
    }
  }
}

export function invokeOldFavoriteRuntimeHandler<Args extends unknown[]>(key: string, ...args: Args) {
  const handler = getStore().handlers.get(key) as ((...args: Args) => unknown) | undefined
  return handler?.(...args)
}

export function hasOldFavoriteRuntimeHandler(key: string) {
  return getStore().handlers.has(key)
}

export function resetOldFavoriteRuntimeSession() {
  const store = getStore()
  window.bilimiDesktop?.resetOldFavoriteRuntime?.()
  store.values.clear()
  store.revisions.clear()
  store.handlers.clear()
  store.accountMid = ''
  notifyRuntimeListeners(store)
}
