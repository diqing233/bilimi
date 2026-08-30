# Test Isolation and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the normal Vitest suite deterministic and restore overlapping shared-modal scroll locks without changing user-facing business flows.

**Architecture:** Test setup owns browser-state cleanup between tests. `BilimiModal` owns a document-scoped lock count so nested/overlapping instances restore the original overflow only after the final release. Existing feature tests retain their local fixtures but no longer leak own `document.cookie` descriptors or raw DOM into later files.

**Tech Stack:** React 19, TypeScript, Vitest 3, Testing Library, JSDOM, Electron.

---

### Task 1: Capture test-environment leakage in a focused regression

**Files:**
- Create: `src/test/testEnvironmentIsolation.test.ts`
- Modify: `src/test/setup.ts`

- [x] **Step 1: Write the failing test**

```ts
it('receives a clean browser state after a prior test mutates global state', () => {
  expect(Object.hasOwn(document, 'cookie')).toBe(false)
  expect(document.documentElement.style.overflow).toBe('')
  expect(document.body.querySelector('[data-test-leak]')).toBeNull()
  expect(() => { document.cookie = 'DedeUserID=100' }).not.toThrow()
})
```

The preceding test in the same file sets an own `document.cookie`, locks `documentElement`, appends `[data-test-leak]`, stubs a global and installs fake timers.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run src/test/testEnvironmentIsolation.test.ts --pool=threads --poolOptions.threads.singleThread --no-file-parallelism`

Expected: the second test fails because the current global `afterEach` only calls Testing Library cleanup and deletes `window.bilimiDesktop`.

- [x] **Step 3: Implement the smallest shared reset**

```ts
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  document.documentElement.style.overflow = ''
  Reflect.deleteProperty(document, 'cookie')
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, 'bilimiDesktop')
})
```

Install a JSDOM-only no-op `window.scrollTo` once in setup so shared-modal cleanup does not emit unsupported-API errors.

- [x] **Step 4: Run GREEN verification**

Run the Task 1 command again.

Expected: `2/2` tests pass and no global state survives between them.

### Task 2: Make shared modal scroll locking composable

**Files:**
- Modify: `src/renderer/src/components/BilimiModal.test.tsx`
- Modify: `src/renderer/src/components/BilimiModal.tsx`

- [x] **Step 1: Write the failing overlap test**

```tsx
const first = render(<BilimiModal title="第一层" actions={<button>确认</button>}>内容</BilimiModal>)
const second = render(<BilimiModal title="第二层" actions={<button>确认</button>}>内容</BilimiModal>)
first.unmount()
expect(document.documentElement.style.overflow).toBe('hidden')
second.unmount()
expect(document.documentElement.style.overflow).toBe('')
```

- [x] **Step 2: Run RED verification**

Run: `npx vitest run src/renderer/src/components/BilimiModal.test.tsx`

Expected: the first unmount restores `''` too early under the current per-instance `previousOverflow` cleanup.

- [x] **Step 3: Implement a document-scoped reference count**

Capture original overflow only when count changes from zero to one. Decrement on every cleanup and restore it only when the count returns to zero. Leave focus trapping, focus restoration, Escape, scrim and `busy` logic untouched.

- [x] **Step 4: Run GREEN verification**

Run the Task 2 command again.

Expected: all modal tests pass for both normal and overlapping close order.

### Task 3: Remove fixture-local leaks and harden the affected selector

**Files:**
- Modify: `src/renderer/src/features/actions/favoriteApiAutomation.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/assistant/PetHoverShortcutSettings.test.tsx`

- [x] **Step 1: Write or adjust failing expectations**

Require test cleanup to delete an own `document.cookie` descriptor rather than leaving an immutable blank value. Select the intended “赞” shortcut by accessible name instead of `getAllByRole('button')[0]`.

- [x] **Step 2: Run RED verification**

Run: `npx vitest run src/renderer/src/features/actions/favoriteApiAutomation.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/favoriteRepositoryPageBridge.test.ts src/renderer/src/features/assistant/PetHoverShortcutSettings.test.tsx --pool=threads --poolOptions.threads.singleThread --no-file-parallelism`

Expected before cleanup fix: repository page bridge can fail to assign `document.cookie`, and the shortcut test is vulnerable to a residual first button.

- [x] **Step 3: Implement local fixture cleanup only**

Use `afterEach` to delete the own cookie and page-state descriptors in the API automation fixture. Replace the ledger fixture’s read-only blank cookie cleanup with descriptor deletion. Do not change production favorite API code or shortcut component code.

- [x] **Step 4: Run GREEN verification**

Run the Task 3 command again.

Expected: all focused fixture and shortcut tests pass without Cookie assignment errors or unsupported `scrollTo` output.

### Task 4: Verify release gate and interaction boundary

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-31-test-isolation-release-gate.md`

- [x] **Step 1: Run complete automated verification**

Run: `npm test`

Expected: exit code `0`, final Vitest summary has zero failed files and zero failed tests, and the parent process exits.

- [x] **Step 2: Build and inspect production preview**

Run: `npm run build`, then `npm run preview`.

Expected: both commands exit `0`; no business flow is changed by the test-only cleanup or modal lock count.

- [x] **Step 3: Electron read-only responsiveness check**

Open an existing harmless confirmation window, close it, move the cursor, scroll the adjacent view, resize, minimize and restore. Save a screenshot in `.codex-artifacts/`; do not perform B 站 writes.

- [x] **Step 4: Record evidence and commit only scoped files**

Record code locations, test totals, Electron screenshot or an explicit unmet condition in I001-I003. Run `git diff --check`, `git diff --stat` and `git status --short`. Stage only the project book, this ledger, this plan, setup/modal/test files. Keep `pnpm-lock.yaml` and `pnpm-workspace.yaml` untracked and out of the commit.
