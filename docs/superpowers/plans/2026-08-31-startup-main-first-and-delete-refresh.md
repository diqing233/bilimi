# Main-first Startup and Delete Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an interactive main Electron window before starting the Xiaomi pet, and immediately reproject deleted favorite rules as unbacked from the authoritative account snapshot.

**Architecture:** The main process receives a one-way renderer-ready signal after the main shell has painted, then schedules the non-critical pet wake on a later event-loop turn. The favorite deletion UI stops suppressing real backup state and requests the existing authoritative snapshot refresh after the workspace deletion transaction completes.

**Tech Stack:** Electron main/renderer, TypeScript, React, Vitest.

---

### Task 1: Defer automatic pet wake until the main renderer is ready

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/global.d.ts`
- Create: `electron/main/index.mainWindowPetStartup.test.ts`

- [x] **Step 1: Write the failing test**

Add a test that starts automatic pet wake, emits no renderer-ready signal, and asserts no pet wake request occurs. Then emit the ready signal and advance the queued task; assert exactly one wake request occurs.

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/main/index.mainWindowPetStartup.test.ts`

Expected: FAIL because automatic wake currently executes during startup without a main-renderer readiness condition.

- [x] **Step 3: Write minimal implementation**

Add a typed one-way IPC handler from the main renderer shell to the main process. Replace unconditional startup wake with an idempotent deferred wake scheduled only after that signal. Keep explicit user wake and hidden/click-through pet behavior unchanged.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/main/index.mainWindowPetStartup.test.ts`

Expected: PASS.

### Task 2: Reproject confirmed deletion immediately as unbacked

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [x] **Step 1: Write the failing tests**

Replace the guide-open state test so a default unbacked rule renders `未备册`. Add a panel test that proves successful deletion asks the parent to perform the existing authoritative organization/snapshot refresh after `workspace.refresh()`.

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: FAIL because the guide suppresses the status and deletion only refreshes the local workspace.

- [x] **Step 3: Write minimal implementation**

Always expose the actual unbacked/unbound card status. Thread the existing `refreshOrganizationState` callback into the controlled ledger panel and call it once after a successful deletion refresh so the page consumes the authoritative account snapshot.

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: PASS.

### Task 3: Regression and real UI verification

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-31-startup-mouse-and-delete-backup-refresh.md`

- [x] **Step 1: Run focused regression**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/index.favoriteHistoryWiring.test.ts electron/main/floatingSealWakeController.test.ts electron/main/floatingSealMouseRecovery.test.ts`

- [x] **Step 2: Run application gates**

Run: `npm test`, `npm run build`, `git diff --check`.

- [x] **Step 3: Perform read-only Electron verification**

Start the development application. Verify first-frame main-window interaction before the pet appears, then verify the saved-favorite card/detail presentation without invoking Bilibili writes. Save screenshots under `.codex-artifacts/`.

- [ ] **Step 4: Update evidence and commit**

Record per-item code paths, automated results, screenshots, and any unavailable installed-app or remote-side verification in the ledger. Stage only the task files and create one local commit.
