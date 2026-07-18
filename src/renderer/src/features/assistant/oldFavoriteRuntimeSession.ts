type OldFavoriteRuntimeStore = {
  values: Map<string, unknown>
  revisions: Map<string, number>
  listeners: Set<() => void>
  keyListeners: Map<string, Set<() => void>>
  handlers: Map<string, (...args: never[]) => unknown>
  accountMid: string
  bridgeSubscribed: boolean
  bridgeUnsubscribe?: () => void
}

const GLOBAL_KEY = '__bilimiOldFavoriteRuntimeSession__' as const
const ACCOUNT_INDEPENDENT_KEYS = new Set(['deepSeekConnectionStatus'])
const BROADCAST_ONLY_KEYS = new Set(['oldFavoriteRuntimeStatus', 'sharedOperationFeedback'])
const RENDERER_ONLY_KEYS = new Set([
  'archiveEditorState',
  'archiveRedoChanges',
  'archiveRedoStack',
  'archiveUndoChanges',
  'archiveUndoStack',
  'baseScanPreview',
  'deepSeekConnectionStatus',
  'deepSeekArchiveRunSnapshot',
  'oldFavoriteUserBatches',
  'oldFavoriteRuntimeStatus',
  'preview',
  'sharedOperationFeedback'
])

type OldFavoriteRuntimeGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: OldFavoriteRuntimeStore
}

function getStore(): OldFavoriteRuntimeStore {
  const runtimeGlobal = globalThis as OldFavoriteRuntimeGlobal
  runtimeGlobal[GLOBAL_KEY] ??= {
    values: new Map(),
    revisions: new Map(),
    listeners: new Set(),
    keyListeners: new Map(),
    handlers: new Map(),
    accountMid: '',
    bridgeSubscribed: false
  }
  const store = runtimeGlobal[GLOBAL_KEY]
  ensureBridgeSubscription(store)
  return store
}

function canUseMainRuntime(key: string): boolean {
  void key
  return false
}

function notifyRuntimeListeners(store: OldFavoriteRuntimeStore, key?: string) {
  store.listeners.forEach((listener) => listener())
  if (key) {
    store.keyListeners.get(key)?.forEach((listener) => listener())
  } else {
    store.keyListeners.forEach((listeners) => listeners.forEach((listener) => listener()))
  }
}

function notifyAllKeyListeners(store: OldFavoriteRuntimeStore) {
  store.keyListeners.forEach((listeners) => listeners.forEach((listener) => listener()))
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
  const unsubscribe = subscribe((message) => {
    if (!('key' in message)) {
      if (message.accountMid && store.accountMid && message.accountMid !== store.accountMid) return
      clearAccountScopedRuntime(store)
      store.accountMid = message.accountMid
      notifyRuntimeListeners(store)
      return
    }

    if (store.accountMid && message.accountMid !== store.accountMid) return
    if (message.revision <= (store.revisions.get(message.key) ?? -1)) return
    store.values.set(message.key, message.value)
    store.revisions.set(message.key, message.revision)
    store.accountMid = message.accountMid
    notifyRuntimeListeners(store, message.key)
  })
  if (typeof unsubscribe === 'function') store.bridgeUnsubscribe = unsubscribe
}

export function subscribeOldFavoriteRuntime(listener: () => void) {
  const store = getStore()
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function subscribeOldFavoriteRuntimeKey(key: string, listener: () => void) {
  const store = getStore()
  const listeners = store.keyListeners.get(key) ?? new Set<() => void>()
  listeners.add(listener)
  store.keyListeners.set(key, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) store.keyListeners.delete(key)
  }
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
  if (!canUseMainRuntime(key) && BROADCAST_ONLY_KEYS.has(key)) {
    void window.bilimiDesktop?.setOldFavoriteRuntimeTransientValue?.(
      key,
      resolvedValue,
      store.revisions.get(key) ?? 0
    )
  }
  store.values.set(key, (result?.value ?? resolvedValue) as T)
  store.revisions.set(key, result?.revision ?? (store.revisions.get(key) ?? 0) + 1)
  if (result?.accountMid) {
    store.accountMid = result.accountMid
  }
  notifyRuntimeListeners(store, key)
  return result?.accepted ?? true
}

export function setOldFavoriteTransientRuntimeValue<T>(key: string, value: T): boolean {
  const store = getStore()
  const currentValue = store.values.get(key) as T
  if (Object.is(currentValue, value)) return false
  const revision = store.revisions.get(key) ?? 0
  store.values.set(key, value)
  store.revisions.set(key, revision + 1)
  notifyRuntimeListeners(store, key)
  void window.bilimiDesktop?.setOldFavoriteRuntimeTransientValue?.(key, value, revision)
    .then((result) => {
      if (!result || result.accepted || result.revision < (store.revisions.get(key) ?? 0)) return
      store.values.set(key, result.value)
      store.revisions.set(key, result.revision)
      notifyRuntimeListeners(store, key)
    })
  return true
}

export function bindOldFavoriteRuntimeAccount(accountMid: string): boolean {
  const normalizedAccountMid = accountMid.trim()
  const store = getStore()
  if (!normalizedAccountMid) {
    if (!store.accountMid) return false
    clearAccountScopedRuntime(store)
    store.accountMid = ''
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
  store.values.clear()
  store.revisions.clear()
  store.handlers.clear()
  store.accountMid = ''
  notifyAllKeyListeners(store)
  store.listeners.clear()
  store.keyListeners.clear()
  store.bridgeUnsubscribe?.()
  store.bridgeUnsubscribe = undefined
  store.bridgeSubscribed = false
}
