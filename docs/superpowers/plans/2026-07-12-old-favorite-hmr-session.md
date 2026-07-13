# Old Favorite HMR Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the fixed-sidebar old-favorite organization session visible and locked when Vite HMR or a React remount occurs while DeepSeek or real archive execution is running.

**Architecture:** Move the key/value runtime store out of `FavoriteLedgerPanel.tsx` into a `globalThis`-backed singleton module so old async closures and refreshed components share one object. Persist every state that affects the restored plan or execution lock, bind scanned sessions to `accountMid`, and keep purely transient dialogs and drag focus local.

**Tech Stack:** React 19, TypeScript, `useSyncExternalStore`, Vitest, Testing Library, Vite Fast Refresh/HMR.

---

### Task 1: Add an HMR-stable runtime store

**Files:**
- Create: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts`
- Create: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx:144-190`

- [ ] **Step 1: Write the failing module-reload test**

Create a test that writes a value, resets Vitest's module registry, reimports the store module, and expects the value to remain available from the new module instance:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('oldFavoriteRuntimeSession', () => {
  afterEach(async () => {
    const session = await import('./oldFavoriteRuntimeSession')
    session.resetOldFavoriteRuntimeSession()
  })

  it('reuses the same store after the module is reloaded', async () => {
    const first = await import('./oldFavoriteRuntimeSession')
    first.resetOldFavoriteRuntimeSession()
    first.setOldFavoriteRuntimeValue('deepSeekArchiveStatus', 'DeepSeek 正在整理旧藏...')

    vi.resetModules()

    const reloaded = await import('./oldFavoriteRuntimeSession')
    expect(reloaded.getOldFavoriteRuntimeValue('deepSeekArchiveStatus', '')).toBe(
      'DeepSeek 正在整理旧藏...'
    )
  })
})
```

- [ ] **Step 2: Run the store test and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts
```

Expected: FAIL because `oldFavoriteRuntimeSession.ts` does not exist.

- [ ] **Step 3: Implement the stable singleton**

Create a focused module with this public API:

```ts
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
    store.values.set(key, typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue)
  }
  return store.values.get(key) as T
}

export function setOldFavoriteRuntimeValue<T>(key: string, nextValue: T | ((current: T) => T)) {
  const store = getStore()
  const current = store.values.get(key) as T
  const next = typeof nextValue === 'function'
    ? (nextValue as (current: T) => T)(current)
    : nextValue
  if (Object.is(current, next)) return
  store.values.set(key, next)
  store.listeners.forEach((listener) => listener())
}

export function resetOldFavoriteRuntimeSession() {
  const store = getStore()
  store.values.clear()
  store.handlers.clear()
  store.accountMid = ''
  store.listeners.forEach((listener) => listener())
}
```

Also export `registerOldFavoriteRuntimeHandler` and `invokeOldFavoriteRuntimeHandler`. Registration cleanup must delete a handler only when it is still the same function, so an old component cleanup cannot remove the handler registered by a refreshed component.

Refactor `useOldFavoriteRuntimeState` to call these functions and re-export `resetOldFavoriteRuntimeSession` from `FavoriteLedgerPanel.tsx` so existing tests keep their import path. Replace every read of the module-level `oldFavoriteDeepSeekCancelRequested` flag with an imperative `getOldFavoriteRuntimeValue('deepSeekArchiveCancelRequested', false)` read, allowing an old async loop to observe cancellation requested by a refreshed component.

- [ ] **Step 4: Run the store and existing remount tests and verify GREEN**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts
npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx -t "restores the old favorite archive session|keeps the canceled DeepSeek archive status"
```

Expected: all selected tests PASS.

- [ ] **Step 5: Add and verify HMR cancellation coverage**

Start a two-chunk DeepSeek run, remount the component, click the restored cancel button, resolve the first deferred chunk, and assert the second chunk is never requested. This test must fail while cancellation uses the module-level boolean and pass after the loop reads the stable Store.

### Task 2: Persist the complete preview configuration

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx:1424-1538`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write a failing remount test for draft and protected state**

Add an integration test that scans a preview containing `scanContext.protectedVideos`, selects protected videos for reorganization, changes a draft ledger keyword, unmounts, rerenders, and asserts both the `已重新纳入 1` indicator and edited keyword remain visible.

The test must use the real panel behavior and only mock IPC-facing props:

```ts
const first = renderFavoriteLedgerPanel({ onScanOldFavorites })
// Open old-favorite organization, reorganize one protected item, and edit one ledger keyword.
first.unmount()
renderFavoriteLedgerPanel({ onScanOldFavorites })

expect(screen.getByText('已重新纳入 1')).toBeInTheDocument()
expect(screen.getByDisplayValue('热更新保留词')).toBeInTheDocument()
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "restores draft ledgers and protected reorganization after remount"
```

Expected: FAIL because `draftLedgers` and `reorganizedProtectedAids` currently use component-local `useState`.

- [ ] **Step 3: Move plan-affecting fields into the runtime store**

Replace the local states with runtime-backed states:

```ts
const [draftLedgers, setDraftLedgers] = useOldFavoriteRuntimeState<FavoriteLedger[]>(
  'draftLedgers',
  () => ledgers.map(cloneArchiveDraftLedger)
)
const [reorganizedProtectedAids, setReorganizedProtectedAids] =
  useOldFavoriteRuntimeState<Set<number>>('reorganizedProtectedAids', () => new Set())
```

Update the `ledgers` synchronization effect so a remount with an active preview does not overwrite the restored draft:

```ts
useEffect(() => {
  if (!preview) {
    setDraftLedgers(ledgers.map(cloneArchiveDraftLedger))
  }
  // Keep the existing selection/editor cleanup.
}, [ledgers, preview, setDraftLedgers])
```

Reset both fields when acknowledging a completed run.

- [ ] **Step 4: Run the focused and panel test files and verify GREEN**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "restores draft ledgers and protected reorganization after remount"
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
```

Expected: all tests PASS.

### Task 3: Persist and enforce the real execution lock

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx:1448-1527,3134-3280`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write a failing duplicate-execution regression test**

Use a deferred first `onExecuteOldFavoritePlan` call. Start real execution, unmount and rerender the panel while the deferred call is pending, then assert the restored confirmation button remains disabled and a second click cannot invoke the callback again:

```ts
expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1)
first.unmount()
renderFavoriteLedgerPanel(props)

expect(screen.getByRole('button', { name: '整理中' })).toBeDisabled()
fireEvent.click(screen.getByRole('button', { name: '整理中' }))
expect(onExecuteOldFavoritePlan).toHaveBeenCalledTimes(1)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "keeps real archive execution locked after remount"
```

Expected: FAIL because execution state and progress currently reset on remount.

- [ ] **Step 3: Move execution state into the runtime store**

Persist the fields that determine execution behavior:

```ts
type OldFavoriteExecutionPhase = 'idle' | 'running' | 'awaiting-acknowledgement'

const [oldFavoriteExecutionPhase, setOldFavoriteExecutionPhase] =
  useOldFavoriteRuntimeState<OldFavoriteExecutionPhase>('oldFavoriteExecutionPhase', 'idle')
const [oldFavoriteExecutionProgress, setOldFavoriteExecutionProgress] =
  useOldFavoriteRuntimeState<{ completed: number; total: number } | null>(
    'oldFavoriteExecutionProgress',
    null
  )
```

Derive `oldFavoriteExecuting` and `oldFavoriteExecutionAwaitingAcknowledgement` from the phase. Before any await, use a functional update or store-level compare-and-set helper so only `idle` can transition to `running`. Transition to `awaiting-acknowledgement` on completion and back to `idle` only on acknowledgement.

- [ ] **Step 4: Run execution and full panel tests and verify GREEN**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "keeps real archive execution locked after remount"
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
```

Expected: all tests PASS and `onExecuteOldFavoritePlan` remains called once.

### Task 4: Bind restored sessions to the scanned account and finish error states

**Files:**
- Modify: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx:2242-2365,2751-2908`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: Write failing account-isolation and DeepSeek-error tests**

Store test:

```ts
expect(bindOldFavoriteRuntimeAccount('42')).toBe(false)
setOldFavoriteRuntimeValue('preview', { items: [] })
expect(bindOldFavoriteRuntimeAccount('99')).toBe(true)
expect(getOldFavoriteRuntimeValue('preview', null)).toBeNull()
```

Panel test: make the DeepSeek completion path throw and assert the global status callback receives an `error` tone rather than keeping the last `running` snapshot.

- [ ] **Step 2: Run both focused tests and verify RED**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts -t "clears a session when the account changes"
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx -t "clears the running status when DeepSeek archive organization fails"
```

Expected: FAIL because account binding does not exist and the catch path only changes the local status text.

- [ ] **Step 3: Implement account binding and terminal error status**

Add:

```ts
export function bindOldFavoriteRuntimeAccount(accountMid: string): boolean {
  const normalized = accountMid.trim()
  if (!normalized) return false
  const store = getStore()
  if (!store.accountMid || store.accountMid === normalized) {
    store.accountMid = normalized
    return false
  }
  resetOldFavoriteRuntimeSession()
  getStore().accountMid = normalized
  return true
}
```

Call it before storing a successful scan preview. In the outer DeepSeek catch path, store a terminal error snapshot:

```ts
setOldFavoriteRuntimeStatus({
  label: 'DeepSeek整理失败',
  message: failureMessage,
  tone: 'error'
})
```

Register the latest `onOldFavoriteStageFeedback` and `onDeepSeekArchiveKeywordSuggestions` callbacks in the stable Store. The async completion path must invoke the Store handler rather than the callback captured by the component instance that started the request. Add a remount assertion proving completion feedback is delivered to the newly mounted instance exactly once.

- [ ] **Step 4: Run store, panel, and assistant integration tests and verify GREEN**

Run:

```powershell
npx vitest run src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts
npx vitest run src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx
```

Expected: all three test files PASS.

### Task 5: Verify the complete change and create the single repository commit

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-07-12-old-favorite-hmr-session-design.md`
- Create: `docs/superpowers/plans/2026-07-12-old-favorite-hmr-session.md`

- [ ] **Step 1: Run formatting/diff checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only files belonging to this repair are listed.

- [ ] **Step 2: Run the full automated test suite**

Run:

```powershell
npm test
```

Expected: all Vitest tests PASS. If unrelated baseline failures remain, record exact test names and prove all affected test files pass independently before proceeding.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: exit code 0, proving the global store does not depend on development-only HMR APIs.

- [ ] **Step 4: Review the final staged diff**

Run:

```powershell
git diff --stat
git diff -- src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx
```

Expected: the diff is limited to the approved session architecture, tests, spec, and plan.

- [ ] **Step 5: Create the single required commit**

Run:

```powershell
git add -f docs/superpowers/specs/2026-07-12-old-favorite-hmr-session-design.md docs/superpowers/plans/2026-07-12-old-favorite-hmr-session.md
git add src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx
git commit -m "修复开发态旧藏整理会话中断"
```

Expected: one successful commit containing the complete repair.
