# Multi-Window Runtime State Mirroring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sidebar and floating assistant render one shared DeepSeek, favorite-organization, and operation-feedback runtime state while keeping view state independent.

**Architecture:** Reuse the existing main-process versioned old-favorite runtime store as the assistant runtime-status authority through its existing preload IPC. Renderer helpers read keyed snapshots and subscribe to broadcasts; `FloatingAssistantApp` derives status lights from those snapshots, and shared operations publish updates through the helper.

**Tech Stack:** Electron, React 19, TypeScript, Vitest, Testing Library

---

### Task 1: Specify Cross-Window Runtime Behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Add a failing runtime-session test proving a second renderer reads the latest shared status snapshot.
- [x] Add a failing component regression proving a shared old-favorite status overrides the base `已备册` status.
- [x] Add a failing component regression proving a shared DeepSeek result changes `待测试` to `已连接` without another connection request.
- [x] Run `npm test -- --run src/renderer/src/features/assistant/oldFavoriteRuntimeSession.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx` and confirm the new assertions fail because final statuses are still renderer-local.

### Task 2: Extend Shared Assistant Runtime Status

**Files:**
- Modify: `electron/main/oldFavoriteRuntimeStore.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteRuntimeSession.ts`

- [x] Store DeepSeek connection, favorite organization, and operation feedback under serializable keyed snapshots.
- [x] Preserve application-wide DeepSeek connection state when account-scoped old-favorite state resets.
- [x] Reuse renderer helpers that return initial snapshots, publish updates, and notify React subscribers.
- [x] Run the focused runtime-session tests and confirm they pass.

### Task 3: Mirror DeepSeek Connection State

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Derive the DeepSeek light from the shared connection status.
- [x] Publish validating results, successful tests, failed tests, and successful real requests to the shared snapshot.
- [x] Invalidate the shared result when connection-critical configuration changes.
- [x] Keep startup validation restricted to the sidebar so the floating window never duplicates the request.
- [x] Run the focused component tests and confirm all DeepSeek mirroring assertions pass.

### Task 4: Mirror Favorite Status And Shared Feedback

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.tsx`

- [x] Route scan start, scan result, failure, organization progress, completion, cancellation, and acknowledgement through the shared runtime snapshot.
- [x] Derive the third status light from shared favorite status before falling back to the base backup result.
- [x] Publish scan and connection operation results as shared feedback while keeping navigation feedback local.
- [x] Reset shared favorite state when the bound Bilibili account changes.
- [x] Run the focused assistant component tests and confirm the status light and feedback mirror correctly.

### Task 5: Verify And Commit Once

**Files:**
- Verify all modified source, test, specification, and plan files.

- [x] Run the focused assistant tests.
- [x] Run `npm test -- --run`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and inspect `git diff --stat` plus the final diff.
- [x] Commit the complete requirement once with a concise Chinese commit message.
