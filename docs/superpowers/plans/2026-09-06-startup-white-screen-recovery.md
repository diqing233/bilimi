# Startup White Screen Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a temporary Vite dynamic-module request failure from leaving the Electron main window permanently blank.

**Architecture:** The renderer’s root cause is Chromium development-profile HTTP cache corruption (`ERR_CACHE_READ_FAILURE`), so append Electron’s `disable-http-cache` switch only for development. Statically load the main `App` route, because it is the only route needed in the main-window first frame. Keep floating-window modules lazy. Wrap those three lazy module loaders in a narrowly-scoped retry helper that retries only Electron/Vite’s known dynamic fetch failure with a cache-distinct URL. An error boundary turns any second floating-window failure into an actionable visible recovery screen.

**Tech Stack:** Electron, electron-vite, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Prove the module-load recovery contract

**Files:**
- Create: `src/renderer/src/startupModuleLoader.test.ts`
- Create: `src/renderer/src/startupModuleRecovery.test.tsx`

- [x] **Step 1: Write failing tests for a temporary dynamic-import failure and permanent failure.**

```ts
const loader = vi.fn()
  .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
  .mockResolvedValueOnce({ default: 'App' })

await expect(loadStartupModuleWithRetry(loader)).resolves.toEqual({ default: 'App' })
expect(loader).toHaveBeenCalledTimes(2)
```

- [x] **Step 2: Run the focused test and confirm the import fails because the helper does not exist.**

Run: `npm test -- src/renderer/src/startupModuleLoader.test.ts`

Expected: Vite reports that `./startupModuleLoader` cannot be resolved.

- [x] **Step 3: Add an error-boundary test for a visible main-window recovery action.**

```tsx
render(<StartupModuleRecoveryBoundary><BrokenStartupRoute /></StartupModuleRecoveryBoundary>)
expect(screen.getByRole('button', { name: '重新载入' })).toBeVisible()
```

### Task 2: Recover only from the observed dynamic-import request race

**Files:**
- Modify: `electron/main/appIdentity.ts`
- Modify: `electron/main/appIdentity.test.ts`
- Create: `src/renderer/src/startupModuleLoader.ts`
- Create: `src/renderer/src/startupModuleRecovery.tsx`
- Modify: `src/renderer/src/main.tsx`
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`

- [x] **Step 1: Implement the minimal retry helper.**

Only errors matching `Failed to fetch dynamically imported module` retry. Yield for 150ms, then use the supplied cache-distinct loader once; non-network evaluation errors propagate immediately.

- [x] **Step 1a: Disable Chromium HTTP disk caching for development only.**

Add `app.commandLine.appendSwitch('disable-http-cache')` inside `configureDevelopmentRuntimeSwitches` after its packaged-build guard. Test that it is present for every development launch and absent for packaged builds.

- [x] **Step 2: Restore the main route to a static import and retain lazy loading for the three floating routes.**

The main `App` no longer depends on the failing first dynamic request. The three floating retry imports carry `?startup-retry`; this forces a fresh Vite request while preserving their per-window lazy loading.

- [x] **Step 3: Add the recovery boundary outside the existing suspense boundary.**

The fallback must visibly offer `重新载入`, rather than retaining the current visually-hidden loading status after a rejected lazy promise.

- [x] **Step 4: Update the existing startup performance source contract.**

Require a static main `App` import and require the three floating modules to remain lazy, including their initial and retry dynamic requests.

- [x] **Step 5: Run focused checks.**

Run: `npm test -- src/renderer/src/startupModuleLoader.test.ts src/renderer/src/startupModuleRecovery.test.tsx electron/main/index.mainWindowPetStartup.test.ts`

Expected: all focused tests pass.

### Task 3: Verify actual startup and record evidence

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-06-startup-white-screen.md`

- [x] **Step 1: Stop only the prior development-process tree and launch a fresh `npm run dev` process.**

Expected: renderer server reports port 5173 and Electron reports no dynamic-import error.

- [x] **Step 2: Inspect the fresh main window.**

Expected: nonblank UI appears and the window remains responsive to mouse movement, click, resize, minimize, and close.

- [x] **Step 3: Run the full build and worktree checks.**

Run: `npm run build; git diff --check; git status --short`

Expected: build exits 0 and this task has no whitespace errors or unrelated file changes.

- [x] **Step 4: Update the ledger’s per-item evidence and commit only the listed startup-recovery files.**
