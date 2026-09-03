# Recommendation Toggle Relink Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recommendation-origin ledgers usable outside the visible organizer, initialize repeated organizer rounds from saved enabled rules, and make lower recommendation cancellation delete its mapped local ledger without Bilibili mutation.

**Architecture:** Separate “an editable organizer is visibly open” from “a completed workspace snapshot remains mounted”. The upper-card toggle falls back to the narrow account preference write when the guide is not visible; only visible, previewing organization routes through candidate selection. Main-process recommendation initialization derives adopted IDs from the saved enabled account-rule directory, while lower cancellation uses the existing local deletion transaction followed by an authoritative workspace refresh.

**Tech Stack:** TypeScript, React 19, Electron IPC, Vitest, existing old-favorite workspace coordinator.

---

### Task 1: Define the revised recommendation contract

**Files:**
- Modify: `docs/项目功能项目书.md:686-695`
- Modify: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

- [x] **Step 1: Update the project book before behavior code**

  Replace §9.4’s old persisted-rule cancellation wording with these fixed rules:

  ```text
  visible previewing guide -> candidate queue and bidirectional linkage
  guide closed/completed/recovery snapshot -> upper card writes account-level enabled state
  first lower adoption -> create and save an account rule with the candidate stable ID
  lower cancellation of an adopted candidate -> delete that same local rule and local projection
  no recommendation cancellation -> Bilibili deletion, rename, binding, move, or sync
  ```

- [x] **Step 2: Record the replacement relationship in the ledger index**

  Mark I003/I005’s old “saved rule remains after lower cancellation” behavior as explicitly replaced by I010/R009, retain their original text unchanged, and add the project-book location to I008–I010’s acceptance evidence fields.

- [x] **Step 3: Verify documentation scope**

  Run: `git diff --check -- docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

  Expected: exit 0 with no whitespace errors.

### Task 2: Make the non-visible upper recommendation toggle use account state

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:55-60,772-830,1575-1695`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Write failing renderer regressions**

  Add tests that mount an upper persisted recommendation ledger with:

  ```ts
  // completed workspace snapshot + guide closed
  // click enabled true -> saveFavoriteLedgerEnabled('custom-author-a', false)
  // rerender with authoritative enabled false -> checkbox remains false
  // repeat false -> true
  ```

  Assert no `setRecommendedCandidates` or `setRoundExcludedLedgerIds` command occurs. Add a companion `FavoriteLedgerOverview` test proving the card is not re-overwritten by a stale organization map when the guide is closed.

- [x] **Step 2: Run the focused test to verify RED**

  Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: new completed/guide-closed toggling assertion fails because it calls an organization selection callback or restores the former enabled value.

- [x] **Step 3: Implement the smallest routing boundary**

  Add an explicit predicate that requires both `snapshot.status === 'previewing'` and `guideOpen` before producing organization enabled maps or passing organization callbacks to `FavoriteLedgerOverview`. Preserve `isOrganizationSelectionSnapshot` for currently-supported completed-round coordinator commands; do not change its coordinator semantics. When the predicate is false, pass no organization maps/callbacks so the existing narrow `onSaveLedgerEnabled` route persists the click.

- [x] **Step 4: Run the focused test to verify GREEN**

  Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: PASS, including existing previewing-round optimistic-toggle coverage.

### Task 3: Initialize a new organization round from saved enabled recommendation rules

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:928-962,2467-2472,3277-3285`

- [x] **Step 1: Write failing coordinator regressions**

  Add a test that seeds `listSavedEnabledLedgers` with one recommendation rule whose ID exactly equals a generated candidate, starts a fresh second round, and expects:

  ```ts
  expect(snapshot.recommendations.adoptedCandidateIds).toContain(candidateId)
  ```

  Add negative cases for disabled saved rules and different stable IDs with identical display names/keywords.

- [x] **Step 2: Run the focused test to verify RED**

  Run: `npm.cmd test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: the fresh-round expected adopted ID is missing.

- [x] **Step 3: Implement stable-ID hydration at round creation**

  Add one coordinator helper that reads `listSavedEnabledLedgers`, intersects their trimmed IDs with `recommendationsFromIndex(...).candidates`, and returns a copy with those exact candidate IDs as `adoptedCandidateIds`. Invoke it in every new recommendation-index creation path before writing the first workspace overlay and before capturing round-start history. Do not use titles, keywords, or rule shape as fallback identity.

- [x] **Step 4: Run the focused test to verify GREEN**

  Run: `npm.cmd test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: PASS, including existing completed-round stable-ID cancellation regression.

### Task 4: Delete the adopted local rule when lower recommendation is cancelled

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:556-641,740-830`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Write failing cancellation regressions**

  In a visible previewing guide with a lower candidate mapped by exact stable ID to a persisted local recommendation ledger, uncheck the lower candidate and assert:

  ```ts
  expect(deleteFavoriteLedgersLocal).toHaveBeenCalledWith('100', [candidateId])
  expect(saveLedgerEnabled).not.toHaveBeenCalledWith(candidateId, false)
  expect(setRecommendedCandidates).toHaveBeenCalledWith([])
  ```

  Assert the upper card disappears after the authoritative parent rerender and that a remote-bound/ordinary ledger never uses this deletion route.

- [x] **Step 2: Run the focused test to verify RED**

  Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: the old participation-only route keeps the persisted ledger or writes `enabled: false` instead of calling local deletion.

- [x] **Step 3: Implement one local deletion transaction**

  In the lower-candidate cancellation path, resolve only an exact stable candidate-to-ledger mapping. For a persisted, recommendation-origin ledger without remote action, call `deleteFavoriteLedgersLocal(accountMid, [ledgerId])`, remove the candidate from the workspace selection, refresh the workspace, then refresh the parent account snapshot. Keep detail deletion and deletion-mode code unchanged. Propagate failure by restoring the optimistic lower selection; never call remote deletion APIs.

- [x] **Step 4: Run the focused test to verify GREEN**

  Run: `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

  Expected: PASS with the old pure-candidate, details deletion, deletion-mode, and remote-bound regressions intact.

### Task 5: Validate, audit, and integrate

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

- [x] **Step 1: Update ledger evidence after each verified requirement**

  Record exact code locations, named automated tests, and real Electron evidence for I001–I011. Mark I003/I005 as replaced by I010/R009 rather than deleting their original entries.

- [x] **Step 2: Run static and automated verification**

  Run:

  ```powershell
  git diff --check
  npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts
  npm.cmd test
  npm.cmd run build
  ```

  Expected: commands pass, or any pre-existing unrelated failures are documented with exact output and not claimed as fixed.

- [x] **Step 3: Perform real Electron development verification**

  Use a test-only/local account data set. Verify: upper card check/uncheck with guide closed; detail delete immediate disappearance; first adoption; second-round initial linkage; lower cancel deletes the corresponding upper local card; then move mouse continuously, click, scroll, resize, minimize, restore, and close while operations settle. Record screenshot/diagnostic evidence only under `.codex-artifacts/recommendation-toggle-relink-rework/`.

- [x] **Step 4: Inspect the final diff and commit**

  Run:

  ```powershell
  git status --short
  git diff --stat
  git diff --check
  ```

  Commit only the project book, this ledger, tests, and implementation files for this topic using `git commit -m "fix: repair recommendation ledger lifecycle"`.

- [x] **Step 5: Merge the verified branch into local main**

  Confirm root `main` is unchanged except its pre-existing user work; merge only the verified topic commit with a non-destructive local merge. Re-run `git status --short`, `git diff --stat`, and the targeted regression suite on `main` before reporting completion.
