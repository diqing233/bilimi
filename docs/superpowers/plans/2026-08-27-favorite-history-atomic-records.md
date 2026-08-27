# Favorite History Atomic Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the archive-preview change log expose only complete, semantically meaningful favorite-rule history positions, so restoring one position atomically restores its original rule, participation, recommendation, exclusion, and classification state.

**Architecture:** Keep the durable workspace journal intact. The main-process coordinator will compare favorite-rule snapshots semantically, project only lossless legacy intermediate chains to the final raw cursor, and resolve an attempted selection of a hidden intermediate cursor to that final cursor. The renderer continues to render the published projection and only replaces the prohibited generic legacy fallback with a precise local-only recovery-scope label.

**Tech Stack:** Electron main process, TypeScript, Vitest, React Testing Library.

---

### Task 1: Lock the regression with coordinator tests

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: Write the failing legacy-intermediate regression test**

  Create three consecutive `favorite-rules` checkpoints for one stable rule ID, each with the same cancellation direction: recommendation adoption removed, then round exclusion added, then durable `enabled` changed to `false`. Assert that the snapshot exposes only the final raw cursor and that `moveHistoryCursor` called with the first raw cursor restores the final state:

  ```ts
  expect(snapshot.history.entries).toHaveLength(1)
  expect(snapshot.history.entries[0]).toMatchObject({ cursor: finalCursor })
  await coordinator.moveHistoryCursor('100', firstIntermediateCursor)
  expect(restoreFavoriteLedgerHistoryState).toHaveBeenLastCalledWith('100', {
    ledgers: [expect.objectContaining({ id: 'saved-honker', enabled: false })],
    adoptedCandidateIds: [],
    excludedLedgerIds: ['saved-honker']
  })
  ```

- [ ] **Step 2: Run the test and confirm RED**

  Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "projects legacy favorite-rule intermediate checkpoints"`

  Expected: FAIL because the current snapshot exposes all three checkpoints and restoring cursor 1 yields the partial adopted-only state.

- [ ] **Step 3: Write the semantic-no-op regression test**

  Pass logically identical before/after rule snapshots whose object property insertion order differs. Assert no history item is produced:

  ```ts
  await coordinator.recordFavoriteLedgerHistoryChange('100', { before, after })
  await expect(coordinator.getSnapshot('100')).resolves.toMatchObject({
    history: { length: baselineLength, entries: [] }
  })
  ```

- [ ] **Step 4: Run the test and confirm RED**

  Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "does not record a semantic no-op favorite-rule checkpoint"`

  Expected: FAIL because raw `JSON.stringify` treats the differently inserted keys as a history change.

### Task 2: Make history comparison, projection, and restore cursor atomic

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:72-121,5350-5451,5296-5346,7572-7610`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: Add a stable semantic snapshot comparison**

  Implement a local deterministic serializer which recursively orders object keys and retains array order; use it after existing set normalization when comparing `OldFavoriteWorkspaceFavoriteRuleHistoryState`. Do not move this work into a renderer handler.

  ```ts
  const favoriteRuleHistoryStatesMatch = (left, right) =>
    stableSerialize(normalize(left)) === stableSerialize(normalize(right))
  ```

- [ ] **Step 2: Project only provably one-operation legacy chains**

  Add a coordinator-local projection that collapses consecutive `favorite-rules` entries only when all are true: transitions are state-contiguous, their effective action direction and stable changed-ID set match, and classification movement is identical or absent. The projected item retains the first state as `before`, the final state as `after`, the meaningful movement set, and the final raw cursor. Do not mutate or rewrite journal overlays.

- [ ] **Step 3: Use the same projection for snapshot output and cursor selection**

  In `createSnapshot`, map history entries through the projection before publishing the user-visible list. In `moveHistoryCursor`, resolve a requested hidden intermediate raw cursor to the projected final raw cursor before applying undo/redo and `restoreFavoriteLedgerHistoryState`.

- [ ] **Step 4: Keep new writes and existing user interactions unchanged**

  Replace the raw `JSON.stringify(before) === JSON.stringify(after)` guard with the semantic comparison. Leave `ControlledFavoriteLedgerPanel.tsx`, recommendation selection, saved-rule selection, B 站 flows, and all renderer-side click sequencing unchanged.

- [ ] **Step 5: Run coordinator tests and confirm GREEN**

  Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: PASS, including both new regressions and existing saved-rule/recommendation restoration tests.

### Task 3: Replace the prohibited fallback wording without changing UI interaction

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:384-414`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx:606-614`

- [ ] **Step 1: Write the failing UI text regression**

  Keep a valid legacy `favorite-rules` entry without a derivable action and assert the archive history menu renders a readable Chinese recovery scope and does not render `收藏夹规则变更：已恢复本地规则与本轮勾选`.

- [ ] **Step 2: Run the test and confirm RED**

  Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx -t "legacy favorite-rule history"

  Expected: FAIL because the current fallback is the prohibited generic text.

- [ ] **Step 3: Implement the minimal fallback replacement**

  Change only the fallback branch to:

  ```ts
  return '历史收藏夹调整：恢复当时的本地规则、勾选与分类结果'
  ```

  Do not change layout, controls, CSS, click handlers, or the normal action-and-movement label branch.

- [ ] **Step 4: Run the focused UI test and confirm GREEN**

  Run: `npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

  Expected: PASS.

### Task 4: Verify protected behavior and document evidence

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-27-favorite-history-restore-regression.md`
- Modify: `docs/项目功能项目书.md`

- [ ] **Step 1: Run focused regressions**

  Run:

  ```powershell
  npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteLedgerHistoryWiring.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx
  ```

  Expected: PASS. The protected normal upper/lower linkage suite remains green without source changes to its handler.

- [ ] **Step 2: Run build and diff integrity checks**

  Run:

  ```powershell
  npm run build
  git diff --check
  git diff --stat
  git status --short
  ```

  Expected: Build and diff check exit 0; only this plan, project book, current ledger, coordinator, archive-preview component and their tests are candidates for staging. `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untracked and unstaged.

- [ ] **Step 3: Electron read-only acceptance**

  Launch the development app and, without B 站 writes, create, binding, deletion or video actions, inspect the archive history menu. Verify a historical cancellation exposes one entry, selecting it leaves both upper and lower projections unselected, the detailed Chinese label is visible on hover, and click/scroll/window operations remain responsive. Save screenshots to `.codex-artifacts/`.

- [ ] **Step 4: Update the ledger and commit only this topic**

  Record file locations, test output, Electron screenshot paths, and the local-only/B 站 boundary for I001–I003. Stage only the current ledger, project book, this plan, coordinator, archive-preview component, and their tests; commit with `fix: make favorite history checkpoints atomic`.
