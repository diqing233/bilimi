# Favorite Folder Sync And Toggle Emphasis Implementation Plan

> For agentic workers: Execute this plan in the current session with test-first checkpoints; preserve all unrelated behavior.

**Goal:** Make bilimi work-folder deletion, binding, physical shard identity, per-folder backup, shard browsing, toggle emphasis, and cross-window refresh follow the approved project book and ledger.

**Architecture:** Keep the Electron repository snapshot and persisted account preferences authoritative. Extend the existing physical-shard and folder projections instead of adding a second binding model. Renderer views send narrow commands, refresh through the existing repository subscription, and keep shard selection as a local read-only view state.

**Tech Stack:** Electron, React, TypeScript, Vitest, existing repository IPC and Bilibili page bridge.

---

### Task 1: Lock the ledger and project-book contract

**Files:**
- Modify: docs/requirement-ledgers/2026-08-20-favorite-folder-sync-and-toggle-emphasis.md
- Modify: docs/项目功能项目书.md

- [x] Append R024 and I033 without changing historical text.
- [x] Add only final behavior: deletion matrix, deleted-folder recovery, scoped backup, physical-shard identity/order, shard read-only selector, and global responsiveness rule.
- [x] Re-read R001-R024 and classify confirmed, pending, replaced, and explicitly excluded items before code changes; classification and evidence are in the ledger implementation-check section.

### Task 2: Protect physical shard identity and ordinary backup

**Files:**
- Modify: src/renderer/src/features/favorites/favoriteLedgerApi.ts
- Test: src/renderer/src/features/favorites/favoriteLedgerApi.test.ts

- [x] Add a regression asserting ordinary backup does not call the Bilibili folder edit endpoint for an existing remote folder ID.
- [x] Remove automatic rename from ordinary backup/save scripts; leave explicit binding-confirmation data path unchanged.
- [x] Preserve remote title from inventory and existing ID; keep create and binding behavior intact.
- [x] Run focused API tests.

### Task 3: Make binding candidate order explicit and stable

**Files:**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx
- Modify: related CSS files
- Test: corresponding FavoriteLibraryApp.test.tsx and FavoriteLedgerOverview.test.tsx

- [x] Add a UI assertion that selected candidates are submitted in displayed order and can move up/down before confirmation.
- [x] Initialize candidate order from persisted shard evidence/title suffix/list order, render the final 分册 1/2 preview, and add narrow up/down controls.
- [x] Submit ordered candidates so the existing registration assigns deterministic shard numbers; do not infer identity from title/count.
- [x] Keep cancellation and failure side-effect free.

### Task 4: Preserve deleted-folder recovery and cross-page projections

**Files:**
- Modify: src/shared/types.ts and src/shared/favoriteLedgerDraftDeletion.ts
- Modify: electron/main/index.ts and electron/main/managedFavoriteLedgerDeletionPersistence.ts
- Modify: src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx, src/renderer/src/features/favorites/favoriteLedgerModel.ts, src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Test: existing deletion, projection, and renderer tests

- [x] Add tests for right-side local rule deletion retaining a recoverable deleted-folder record and exposing 收藏夹已删除.
- [x] Persist the deleted rule snapshot and original IDs; make 恢复当前收藏夹 restore only the rule and never call backup or Bilibili.
- [x] Keep local video deletion, local work-folder deletion, and remote-folder deletion separate; apply the confirmed remote result only after a successful remote receipt.
- [x] Publish the existing preference/repository changes so both windows refresh from the same snapshot.

### Task 5: Add the read-only physical-shard selector

**Files:**
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.tsx
- Modify: src/renderer/src/features/favorites/FavoriteLibraryApp.css
- Test: src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx

- [x] Add tests for 0/1/2+ physical shards and default 全部.
- [x] Use existing physical-shard membership folder IDs for read-only page queries; keep logical-folder backup scope unchanged.
- [x] Recompute search, counts, pagination, selection, empty state, and detail when the local shard view changes; clear invalid selection.
- [x] Hide the control for 0/1 shards and ensure no Bilibili IPC is called on view changes.

### Task 6: Apply toggle emphasis without changing operation semantics

**Files:**
- Modify: existing shared toggle CSS/component styles discovered by tests
- Test: existing notes/review toggle tests

- [x] Add or adjust regression assertions for blue, bold selected text, no underline, transparent idle border, and hover/focus border.
- [x] Keep the existing two-option click behavior and card actions unchanged.

### Task 7: Verification and submission

**Files:**
- All files above plus ledger/plan.

- [x] Run focused regression tests for each task.
- [x] Run full npm test, npm run build, git diff --check.
- [x] Perform available Electron startup/control-tree verification; report real-window conditions that cannot be automated.
- [x] Update ledger index with code locations, tests, and verification evidence for each implemented item.
- [ ] Commit all theme files once on local main, then execute one system sleep command.
