# Favorite Local Save Installed Implementation Plan

**Goal:** Make right-side local favorite-rule saves durable in the installed app without depending on Bilibili page automation, and keep the editor open on any non-success persistence result.

**Architecture:** Split the existing `save-ledgers` runtime route into a local rule-directory transaction for ordinary edits and the existing remote preflight/backup route for explicit backup, binding, and sync options. The panel treats an `ok: false` result as a failed save, not as a resolved save.

### Task 1: Lock the failure behavior with RED tests

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [x] Assert a non-success save response keeps the local editor and entered draft visible.
- [x] Assert an ordinary save persists the current account rule list without requiring a Bilibili page script.
- [x] Run the focused tests and confirm each fails for the current implementation.

### Task 2: Make ordinary saves local and authoritative

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/App.tsx`

- [x] Treat a resolved non-success save response as failure in the editor, restoring its previous projection and showing its message.
- [x] Persist ordinary rule-directory saves before any optional refresh; route only explicit backup/binding options through Bilibili page automation.
- [x] Keep heavy reclassification asynchronous and preserve all existing backup, binding, deletion and sync paths.

### Task 3: Verify and commit

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-31-favorite-local-save-installed.md`

- [x] Run focused and related favorite tests, `npm run build`, `git diff --check`, `git diff --stat`, and `git status --short`.
- [x] Run the available automated/read-only validation; do not create, bind, delete, move, or write Bilibili data.
- [x] Record final packaging evidence and commit only this plan, ledger, project book, code, and tests.
