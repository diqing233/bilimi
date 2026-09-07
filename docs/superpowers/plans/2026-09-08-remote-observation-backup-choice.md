# Remote Observation Backup Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Bilibili-only observations out of local rule persistence and let users explicitly create selected local drafts only from the backup confirmation dialog.

**Architecture:** Replace the auto-appended `custom-remote-*` rule projection with a read-only observation result returned beside the normal ledger status. The existing backup confirmation dialog consumes that result, creates only user-selected local drafts, and then invokes the unchanged binding/create confirmation with the original target rules.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library, Electron renderer injected Bilibili API scripts.

---

## File map

- `src/shared/types.ts`: add the serializable observation and explicit-user-draft types/options.
- `src/renderer/src/features/favorites/favoriteLedgerApi.ts`: collect observations without appending them to ledgers; keep create title sourced from target rule.
- `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`: execute generated scripts against mocked Bilibili directory/create APIs.
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`: retain observations through preflight and expose default-off draft checkboxes in the existing confirmation dialog.
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`: cover ignore-and-continue and explicit draft selection.
- `src/renderer/src/App.tsx`: persist explicit selected drafts before continuing existing backup; exclude legacy observation drafts from ordinary projections.
- `src/renderer/src/App.test.tsx`: cover renderer-level persistence and title isolation.
- `docs/requirement-ledgers/2026-09-08-merlin-fit-backup-investigation.md`: record each requirement's actual code and test evidence.

### Task 1: Define read-only observations and remove automatic rule projection

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`
- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

- [x] **Step 1: Write failing script tests**

Add tests executing `buildFavoriteLedgerStatusScript` with a saved local rule and an unrelated `bilimi·远端` directory item. Assert `result.ledgers` does not contain `custom-remote-<id>` while `result.remoteObservations` equals `[{ folderId: '88', title: 'bilimi·远端', memberCount: 2 }]`. Add a second test where `88` is a formal-bound ID and assert the observations list is empty.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: the new assertions fail because the script appends a `custom-remote-*` ledger and has no `remoteObservations` result.

- [x] **Step 3: Add minimal data types and script projection**

Add a `RemoteFavoriteLedgerObservation` with `{ folderId, title, memberCount }`. Refactor the injected `appendRemoteOnlyDrafts` branch into a collector that excludes known, bound, deleted and same-title saved-rule candidates, returns observations, and leaves `ledgers` equal to the synchronized local rules. Retain legacy pure observation drafts only long enough to emit their exact remote ID as an observation; do not return them in `ledgers`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: all focused tests pass.

### Task 2: Preserve observations through backup and add explicit local draft creation

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: Write failing renderer tests**

Add one runtime save-ledgers test returning an observation and no selection: assert preferences persist only the original rule and the next backup invocation still targets its original ID. Add another passing `createRemoteObservationDrafts` with folder `88`: assert exactly one local draft is persisted with that ID/title, disabled/unbound, and the target rule is unchanged.

- [x] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: the new option/type is absent and no explicit draft is persisted.

- [x] **Step 3: Implement explicit selection persistence**

Add `createRemoteObservationDrafts?: RemoteFavoriteLedgerObservation[]` to `FavoriteLedgerSaveOptions`. In `saveFavoriteLedgers`, validate that requested observations came from the fresh preflight result, construct new `custom-remote-<folderId>` drafts only for the selected IDs, persist them locally before remote execution, and never pass them as backup targets. Keep all unselected observations out of preferences.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `npm test -- src/renderer/src/App.test.tsx`

Expected: focused renderer tests pass.

### Task 3: Add backup confirmation choices without changing recommendation behavior

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: Write failing component tests**

Mock `onSyncLedgers` to return one unbacked target and one `remoteObservations` item. Assert the confirmation dialog names the observed folder and its checkbox is unchecked. Confirm without selection and assert the second sync call has no `createRemoteObservationDrafts` but includes `confirmCreateAndBind`. Repeat selecting the checkbox and assert the selected exact observation is passed while target rule ID remains unchanged.

- [x] **Step 2: Run focused component tests and verify RED**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: no observation choice is rendered and the option is absent.

- [x] **Step 3: Implement the UI state and option forwarding**

Store `remoteObservations` from the initial backup result and selected folder IDs in local state. Render default-off checkboxes in the existing rebind/create modal. In `confirmRebinding`, pass only selected observations as `createRemoteObservationDrafts`, then preserve current `rebindRemoteFolders`, `rebindRemoteFolderIds`, and `confirmCreateAndBind` behavior.

- [x] **Step 4: Run focused component tests and verify GREEN**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: focused component tests pass.

### Task 4: Lock the Merlin FIT title regression and verify all related behavior

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx` if renderer flow needs a fixture
- Modify: `docs/requirement-ledgers/2026-09-08-merlin-fit-backup-investigation.md`

- [x] **Step 1: Write the failing title-isolation test**

Mock the Bilibili inventory with `bilimi小咪的收藏夹` and run confirmed backup for `{ id: 'custom-author-梅林fit', displayName: 'bilimi·梅林FIT', bindingState: 'unbacked' }`. Assert the only create request is `title=bilimi·梅林FIT`, that no request uses `bilimi小咪的收藏夹`, and that the returned folder ID belongs to the Merlin rule.

- [x] **Step 2: Run focused API tests and verify RED**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`

Expected: fail only if the title source is not isolated; otherwise document that existing minimal production behavior already satisfies this regression while the new observation test protects it.

- [x] **Step 3: Make the smallest necessary source fix**

If needed, pass an immutable selected-target snapshot into the generated backup script and use only `ledger.displayName` for the create body. Do not derive `title` from observations, `bilibiliFolderTitle`, or candidate titles.

- [x] **Step 4: Run full related verification**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/App.test.tsx && npm run build`

Expected: all named tests and production build exit 0.

- [x] **Step 5: Perform development UI verification and record evidence**

In the Electron development app, use a non-writing backup preflight to verify the observation choice is default-off, select and deselect it, cancel, and confirm the normal dialog path. Do not click the final B站-writing confirmation for a real account during this verification. Record screenshot paths under `.codex-artifacts/` and update the ledger index with code locations, automated tests and any unverified real-account behavior.

- [x] **Step 6: Check, commit, and report scope**

Run: `git diff --check`, `git diff --stat`, and `git status --short`. Stage only the files in this plan plus the current requirement ledger; do not stage `docs/requirement-ledgers/2026-09-08-save-round-to-library-disabled.md`. Commit with `fix: require explicit remote draft creation during backup`.
