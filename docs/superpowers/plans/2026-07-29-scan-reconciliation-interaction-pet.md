# Scan Reconciliation, Interaction, and Pet Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile a cleared local favorite repository from a complete Bilibili scan, keep counts/order/rule drafts consistent, remove avoidable UI stalls, and make the desktop pet reliably interactive.

**Architecture:** Treat a completed scan as one immutable remote observation: derive unique video counts, managed-folder order, bindings, and placements from that snapshot. Adopt remote managed placement as local intent only when no local intent exists after a full reset; otherwise preserve pending local changes. Keep lightweight disclosure state local and defer persistence, while moving pet hit testing away from a renderer event that cannot fire reliably once the native window is mouse-transparent.

**Tech Stack:** Electron, React, TypeScript, Vitest, Testing Library, Windows BrowserWindow APIs.

---

### Task 1: Complete-scan reconciliation

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/shared/oldFavoriteWorkspace.ts`

- [x] Add a failing full-reset scan test proving a uniquely bound managed folder restores local and remote placement to `aligned` without a remote write.
- [x] Add failing tests proving incremental scans preserve an existing local pending placement and ambiguous bindings remain reviewable.
- [x] Implement scan-finalization reconciliation from the same managed-member snapshot.
- [x] Run the focused coordinator tests and confirm the new cases pass.

### Task 2: Counts, grouping, and remote order

**Files:**
- Modify: `electron/main/favoriteRepositoryService.test.ts`
- Modify: `electron/main/favoriteRepositoryService.ts`
- Modify: `electron/main/favoriteRepositoryManagedFolderService.test.ts`
- Modify: `electron/main/favoriteRepositoryManagedFolderService.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [x] Add failing tests for the union of ordinary-source and managed-folder AIDs.
- [x] Add a failing group-deletion preview test requiring a deduplicated affected-video count from one repository revision.
- [x] Add failing navigation tests requiring no inline group count and a tooltip containing folder count, placement count, and unique-video count for both groups.
- [x] Implement the shared count fields and render the clarified labels.
- [x] Preserve complete-scan remote folder order in the local projection and verify it in focused tests.

### Task 3: Recovered work-folder rule drafts

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/store.test.ts`
- Modify: `electron/main/store.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] Add a failing test proving a newly discovered unique `bilimi` work folder creates one reusable unsaved local rule draft linked to the existing remote folder.
- [x] Add failing tests proving the draft is disabled for classification until saved/enabled and repeated scans do not duplicate it.
- [x] Implement draft persistence and the concise recovery/migration hint without creating or renaming a remote folder.
- [x] Run focused store, coordinator, and ledger UI tests.

### Task 4: Lightweight interaction responsiveness

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.contract.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryNavigation.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/styles.css`

- [x] Add failing render-count tests proving disclosure toggles do not rerender unrelated heavy content.
- [x] Isolate disclosure state, memoize stable subtrees, and defer preference persistence.
- [x] Remove layout-heavy disclosure animation while retaining immediate arrow/selection feedback.
- [x] Run focused renderer tests at reduced-motion and standard settings.

### Task 5: Native pet hit testing

**Files:**
- Modify: `electron/main/floatingSealMouseTransparency.test.ts`
- Modify: `electron/main/floatingSealMouseTransparency.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.test.tsx`
- Modify: `src/renderer/src/features/assistant/PalaceMaidPetApp.tsx`

- [x] Add a failing test proving a visible/woken pet is immediately interactive without waiting for renderer `pointerenter`.
- [x] Add a failing test proving transparent background pass-through cannot strand the whole window in an ignored state.
- [x] Implement main-process-owned recovery/reset of native mouse hit testing and renderer interaction locks.
- [x] Run focused pet and native-window tests.

### Task 6: Verification and real UI acceptance

**Files:**
- Update checkboxes in this plan as evidence is produced.

- [x] Run all focused suites changed above.
- [x] Run `npm test`.
- [x] Run `npm run build`.
- [x] Run `git diff --check` and compare TypeScript diagnostics against the existing baseline.
- [x] Restart the normal development app without clearing `%APPDATA%\\bilimi-dev`.
- [x] Use the permitted real scan, verify counts/order/status/draft behavior, test settings/library disclosures and pet interaction, and capture screenshots.
- [x] Confirm no background writes remain, then put Windows to sleep.
