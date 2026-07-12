type OldFavoriteRuntimeStore = {
  values: Map<string, unknown>
  listeners: Set<() => void>
  handlers: Map<string, (...args: never[]) => unknown>
  accountMid: string
}

const GLOBAL_KEY = '__bilimiOldFavoriteRuntimeSession__' as const

type OldFavoriteRuntimeGlobal = typeof globalThis & {
  [GLOBAL_KEY]?: OldFavoriteRuntimeStore
}

function getStore(): OldFavoriteRuntimeStore {
  const runtimeGlobal = globalThis as OldFavoriteRuntimeGlobal
  runtimeGlobal[GLOBAL_KEY] ??= {
    values: new Map(),
    listeners: new Set(),
    handlers: new Map(),
    accountMid: ''
  }
  return runtimeGlobal[GLOBAL_KEY]
}

export function subscribeOldFavoriteRuntime(listener: () => void) {
  const store = getStore()
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function getOldFavoriteRuntimeValue<T>(key: string, initialValue: T | (() => T)): T {
  const store = getStore()
  if (!store.values.has(key)) {
    store.values.set(
      key,
      typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
    )
  }
  return store.values.get(key) as T
}

export function setOldFavoriteRuntimeValue<T>(
  key: string,
  nextValue: T | ((current: T) => T)
) {
  const store = getStore()
  const currentValue = store.values.get(key) as T
  const resolvedValue =
    typeof nextValue === 'function'
      ? (nextValue as (current: T) => T)(currentValue)
      : nextValue
  if (Object.is(currentValue, resolvedValue)) {
    return
  }
  store.values.set(key, resolvedValue)
  store.listeners.forEach((listener) => listener())
}

export function bindOldFavoriteRuntimeAccount(accountMid: string): boolean {
  const normalizedAccountMid = accountMid.trim()
  if (!normalizedAccountMid) {
    return false
  }

  const store = getStore()
  if (!store.accountMid || store.accountMid === normalizedAccountMid) {
    store.accountMid = normalizedAccountMid
    return false
  }

  store.values.clear()
  store.accountMid = normalizedAccountMid
  store.listeners.forEach((listener) => listener())
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
  store.handlers.clear()
  store.accountMid = ''
  store.listeners.forEach((listener) => listener())
}
