# 保存、批阅提示、展开提示与启动响应 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore four regressions without changing established整理、备册、删除、同步 semantics: local favorite saves must survive before整理, unbacked批阅 must keep Chinese feedback, expanded global feedback must be a complete clickable block, and startup/pet loading must yield to pointer input.

**Architecture:** Keep the main process as the authority for local favorite/workspace state and action feedback. Treat no-workspace as “no history sink” rather than a save failure. Render expanded feedback as one semantic control with the scroll region beginning after it. Schedule pet creation through cancellable idle phases after the main window is interactive.

**Tech Stack:** Electron, React, TypeScript, Vitest, existing IPC and CSS modules.

---

### Task 1: Local rule save without an active workspace (I001)

**Files:**
- Modify: `electron/main/favoriteLedgerHistoryWiring.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Test: existing favorite ledger history wiring test file (locate with `rg -l "getFavoriteLedgerHistoryState|favorite ledger history" electron src`)

- [ ] **Step 1: Write the failing test**

Add a test that invokes the preference patch/history wrapper with no started workspace and asserts the wrapped save resolves successfully while history append is skipped; preserve thrown I/O/workspace-corruption errors.

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- --run <history-test-file>` and confirm the failure is `Old favorite workspace has not been started.`.

- [ ] **Step 3: Write minimal implementation**

Change only the history lookup boundary so `requireWorkspace(accountMid)` returning the documented “not started” condition maps to `undefined`; let all other exceptions propagate. The preference patch must continue returning the persisted favorite rules.

- [ ] **Step 4: Run test to verify it passes**

Run the focused test and the existing `ControlledFavoriteLedgerPanel` regression suite; expect all pass.

- [ ] **Step 5: Commit**

`git add electron/main/favoriteLedgerHistoryWiring.ts electron/main/oldFavoriteWorkspaceCoordinator.ts <test> && git commit -m "fix: allow favorite saves before organize workspace"`

### Task 2: Preserve Chinese unbacked批阅 feedback (I002)

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts` (or the existing action feedback test)

- [ ] **Step 1: Write the failing test**

Exercise `runAction` with a main-page action result containing the existing Chinese unbacked prefix and assert no secondary `persistFeedback` preference patch is issued and the displayed message remains Chinese.

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- --run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`; confirm the test observes the duplicate persistence/error path.

- [ ] **Step 3: Write minimal implementation**

Make the main page action result the sole feedback/count writer. In the floating assistant action path, skip the duplicate preference persistence when a main-page result already contains feedback; do not alter `actionExecutor.ts` wording or remote action semantics.

- [ ] **Step 4: Run test to verify it passes**

Run the focused assistant suite and action executor tests; expect Chinese prefixes for 赏/藏/赐 and no duplicate write.

- [ ] **Step 5: Commit**

`git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts && git commit -m "fix: preserve unbacked action feedback"`

### Task 3: Make expanded feedback a complete control and preserve scroll boundary (I003)

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `src/renderer/src/features/assistant/feedbackContinuation.test.ts`
- Test: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: Write the failing tests**

Assert expanded feedback renders the complete continuation inside the same button/control, removes the collapsed second-line ellipsis, uses no continuation divider, and places `.menu-scroll` after the feedback block.

- [ ] **Step 2: Run tests to verify they fail**

Run `npm test -- --run src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/styles.test.ts`; confirm current DOM/CSS fails the containment and layout assertions.

- [ ] **Step 3: Write minimal implementation**

Move the expanded continuation text into the existing feedback toggle content while retaining two-line clamping only for collapsed state. Remove divider styling and ensure `.menu-scroll` wraps only backend/recent sections after the full feedback control. Keep existing toggle keyboard/click semantics.

- [ ] **Step 4: Run tests to verify they pass**

Run the focused continuation/style suites and inspect rendered snapshots for arbitrary five-line continuation.

- [ ] **Step 5: Commit**

`git add src/renderer/src/features/assistant/FloatingAssistantApp.tsx src/renderer/src/styles.css src/renderer/src/features/assistant/feedbackContinuation.test.ts src/renderer/src/styles.test.ts && git commit -m "fix: keep expanded feedback complete and clickable"`

### Task 4: Yielding, cancellable pet startup (I004)

**Files:**
- Modify: `electron/main/floatingSealIdleTask.ts`
- Modify: `electron/main/index.ts`
- Test: `electron/main/index.mainWindowPetStartup.test.ts`

- [ ] **Step 1: Write the failing test**

Assert pet creation is not scheduled until main-window interactive readiness, uses cancellable idle phases with an event-loop yield between native creation/initialization and repair, and cancellation prevents creation/repair.

- [ ] **Step 2: Run test to verify it fails**

Run `npm test -- --run electron/main/index.mainWindowPetStartup.test.ts`; confirm the current immediate scheduling violates the phase/yield assertions.

- [ ] **Step 3: Write minimal implementation**

Restore a cancellable deferred scheduler (timer/idle callback with cancellation) and split pet creation, show/interaction setup, and native repair into separate yielded phases. Keep the main window and B 站 home load gates unchanged; never await native repair before showing the main window.

- [ ] **Step 4: Run tests to verify they pass**

Run startup focused tests and verify cancellation/ordering. Record that real pointer smoothness still requires user testing in development and installed builds.

- [ ] **Step 5: Commit**

`git add electron/main/floatingSealIdleTask.ts electron/main/index.ts electron/main/index.mainWindowPetStartup.test.ts && git commit -m "fix: yield pet startup work after interactive readiness"`

### Task 5: Full verification and release package

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `git diff --check` and verify only this ledger, project book, plan, tests and scoped source files changed.
- [ ] After a clean worktree, run `npm run dist:win` and record `dist/*.exe` in the ledger.
- [ ] Perform `npm run preview` and development/installed key paths from `docs/release-checklist.md`; report pointer smoothness and visual acceptance as user-verification items rather than inferred test results.
