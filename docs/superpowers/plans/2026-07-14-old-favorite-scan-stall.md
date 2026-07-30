# Old Favorite Scan Stall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make old-favorite scans bounded, truthful, and visibly active when Bilibili resource requests fail.

**Architecture:** Keep the existing webview-owned scan and local-storage progress channel. Add run-aware operation metadata at the API layer, classify retryable failures explicitly, and render that snapshot without allowing a previous completed run to mask a new run.

**Tech Stack:** TypeScript, React, Electron webview `executeJavaScript`, Vitest, Testing Library.

---

### Task 1: API failure classification and bounded requests

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [ ] Add a failing test proving a resource response containing HTML is fetched once and returns a failed-folder diagnostic without advancing retry timers.
- [ ] Add failing fake-timer tests proving the folder list and full resource body read settle with `request timeout` when their deadlines expire.
- [ ] Run `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts` and confirm the new assertions fail because HTML is retried and the reads are unbounded.
- [ ] Add a typed/script-local error classification (`retryable` versus terminal HTML/auth/protection response) and one helper whose timeout covers fetch plus `ensureApiOk` body parsing.
- [ ] Use the bounded helper for folder-list and resource-list calls; retry only retryable failures.
- [ ] Re-run the focused test and require zero failures.

### Task 2: Run-aware detailed progress

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerPanel.tsx`
- Modify if required by the existing public shape: `src/renderer/src/features/favorites/favoriteLedgerPreview.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerPanel.test.tsx`

- [ ] Add an API test that holds a retryable page request pending and asserts the persisted snapshot contains a new run id, folder id/title, page, attempt, and `retrying` phase.
- [ ] Add an API test with two pages that holds page two and asserts page-one video IDs already contribute to basic progress.
- [ ] Add a panel test seeded with an old `2337 / 2337 complete` snapshot, start a pending rescan, return a new-run `0 / 0 running` snapshot, and assert the old count disappears while folder/page/retry text appears.
- [ ] Run both focused test files and confirm each new behavior fails for the intended missing-state reason.
- [ ] Persist operation metadata before requests/reties and update discovered IDs per successful page.
- [ ] Make panel progress merging compare run identity before applying monotonic same-run rules, then render `正在读取“<folder>”第 <page> 页` and `第 <attempt>/3 次请求` or retry wording.
- [ ] Re-run both focused files and require zero failures.

### Task 3: Correct managed-folder failure attribution

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] Add a failing test where an ordinary source fails first and the managed bilimi folder fails second; require the user message to identify the managed-folder failure.
- [ ] Run `npm test -- src/renderer/src/App.test.tsx` and confirm the assertion fails because `folderFailures[0]` is selected.
- [ ] Select the diagnostic by the managed folder id/status used to compute `managedFolderScanComplete`, retaining a generic fallback only when no matching diagnostic exists.
- [ ] Re-run the focused test and require zero failures.

### Task 4: Review and verification

**Files:**
- Review all modified tracked files; do not inspect, delete, or stage `tmp/`.

- [ ] Request a read-only subagent review of the diff for correctness, cancellation/revision races, secret leakage, and test quality.
- [ ] Address Critical/Important findings with another red-green cycle.
- [ ] Run focused scan/panel/App tests.
- [ ] Run `npm test`, record total files/tests/skips/failures, then run `npm run build` and `git diff --check`.
- [ ] Repeat the real dev scan path and verify visible live state and bounded HTML failure without performing likes, coins, comments, migration, or archive confirmation.

### Task 5: Release checklist and publication

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/releases/v1.0.2-release-notes.md`
- Modify: `docs/releases/v1.0.2-verification.md`

- [ ] Restart the checklist from dev and complete every safe key path, explicitly recording prohibited Bilibili write actions as not executed.
- [ ] Run and validate preview only after dev passes.
- [ ] Run `npm run dist:win`, install the produced package, and validate the real installed application only after preview passes.
- [ ] Verify packaged tools/models and compute the installer SHA-256.
- [ ] Update v1.0.2 release documentation with commands, outcomes, differences, and checksum.
- [ ] Run final `npm test`, `npm run build`, and `git diff --check` immediately before committing.
- [ ] Stage tracked remediation/release files plus ignored `docs/superpowers` files with `git add -f`; do not stage `tmp/`.
- [ ] Create exactly one overall commit, push `codex/project-reliability-security`, create tag `v1.0.2`, push it, create the GitHub Release, upload the installer, and verify the published SHA-256.
