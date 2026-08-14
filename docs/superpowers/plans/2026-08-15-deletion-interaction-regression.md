# 删除交互回归修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复本轮账本 I001-I007 定义的收藏夹勾选、默认卡删除、分类资格、工作夹删除弹窗和跨范围 bilimi 视频归属删除交互。

**Architecture:** 保持右侧收藏夹、收藏库工作夹、普通 B 站收藏来源三者的边界。默认卡的删除结果在共享删除状态转换中按真实远端结果投影；分类入口通过同一个共享能力判断排除未绑定规则；收藏库页面仅扩大可发现的 bilimi 归属，不授予普通 B 站文件夹删除权限。

**Tech Stack:** Electron、React、TypeScript、Vitest、Testing Library。

---

### Task 1: 验证并保留“保存后可勾选”现有行为

**Covers:** I001 (R001)

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify only if test proves absent: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [ ] **Step 1: Write a focused regression test**

Render a newly created `syncState: 'local-draft'` custom ledger, save valid rules, then assert its enabled checkbox is no longer disabled. Also assert a recovered remote draft with both `syncState: 'local-draft'` and a `bilibiliFolderId` stays disabled.

- [ ] **Step 2: Run the focused test before production edits**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: the new assertion either fails because save retains `local-draft`, or passes and proves the current `save()` normalization already meets I001.

- [ ] **Step 3: Apply the smallest valid result**

Keep `save()` limited to removing `syncState` only for `isTransientNewDraft()` and recovered remote drafts explicitly saved by the user. Do not remove `local-draft` from remote-only discovered drafts, and do not loosen default-card normal-mode selection rules.

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: all assertions pass.

### Task 2: Preserve default cards while applying the two confirmed deletion outcomes

**Covers:** I003 (R002, R004), I004 (R005)

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/shared/favoriteLedgerDeletion.ts`
- Modify: `src/shared/favoriteLedgerDeletion.test.ts`
- Modify: `src/shared/favoriteLedgerCapabilities.ts`
- Modify: `src/shared/favoriteLedgerCapabilities.test.ts`
- Modify: `src/shared/recommendation/videoClassifier.ts`
- Modify: `src/renderer/src/features/recommendation/videoClassifier.ts`
- Modify their existing focused tests when present

- [ ] **Step 1: Write failing state-transition and eligibility tests**

Add tests for these exact inputs:

```ts
// local “删除 bilimi”: default card remains, template fields are restored,
// remote binding is cleared, bindingState is 'unbound', and canClassify is false.
// remote deletion confirmed: default card remains, remote binding is cleared,
// bindingState is 'unbacked', and no fabricated deleted marker controls UI state.
// a non-default unbound ledger is not a classification candidate in renderer or shared classifier.
```

- [ ] **Step 2: Run only the new shared and classifier tests to observe RED**

Run: `npm test -- src/shared/favoriteLedgerDeletion.test.ts src/shared/favoriteLedgerCapabilities.test.ts`

Expected: current default deletion returns `unbacked` plus `managedFolderDeletedByUser`, and `unbound` remains classifiable.

- [ ] **Step 3: Implement the shared state boundary**

Use `createDefaultFavoriteLedgers()` template data when the default card's local bilimi relationship is deleted; remove binding-only fields and restore its default name, tags/rules, priority and enabled state with `bindingState: 'unbound'`. When a confirmed remote folder delete removes its last binding, retain the card with `bindingState: 'unbacked'` and no synthetic deletion marker. Update the right-side deletion plan so a selected default card reaches this conversion rather than being filtered out. Do not delete the default card or change ordinary-mode default selection.

- [ ] **Step 4: Centralize the existing unbound classification prohibition**

Make `resolveFavoriteLedgerCapabilities()` return `canClassify: false` for `bindingState === 'unbound'`, and have both classifier candidate paths honor that capability. Do not add a new persisted classification flag.

- [ ] **Step 5: Re-run the focused shared tests and assistant test**

Run: `npm test -- src/shared/favoriteLedgerDeletion.test.ts src/shared/favoriteLedgerCapabilities.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: both default deletion choices preserve the card with their specified actual state, and unbound ledgers cannot classify.

### Task 3: Split single-work-folder and batch-work-folder deletion dialogs

**Covers:** I002 (R001), I005 (R006)

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify only if error propagation is absent: `electron/main/favoriteLibraryOperationsIpc.ts`
- Modify only if preview validation is at fault: `electron/main/favoriteRepositoryManagedFolderService.ts`

- [ ] **Step 1: Write failing UI tests before changing the dialog state**

Add one test opening the left-side single folder menu delete action and assert it shows only that folder and the two existing deletion ranges, with neither candidate checkbox nor “全选”. Add one test opening the top-level bulk action and assert candidate checkboxes are initially clear, “全选” is available, and confirmation is disabled until a candidate and acknowledgement are selected. Add a rejected preview case that renders the existing alert-style error rather than throwing a blank page.

- [ ] **Step 2: Run the selected UI tests to observe RED**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: the single-delete assertion fails because `openManagedFolderDeletion([id])` is rendered as a selected batch candidate; the rejected preview lacks durable in-dialog feedback.

- [ ] **Step 3: Implement explicit dialog modes**

Represent the dialog as a discriminated `single` or `batch` request. `single` stores one fixed logical id and renders no candidate selector or select-all control. `batch` owns the candidate selection map and starts with all values false. Preserve the current local-only / also-delete-B站 range confirmation and do not mutate data while previewing or selecting.

- [ ] **Step 4: Make preview failure actionable without widening deletion scope**

Map the managed-folder preview failure to the existing alert surface with a retryable explanatory message. Keep the dialog/collection mounted and make an empty candidate result visibly distinct from “no candidate selected”; do not treat it as successful deletion.

- [ ] **Step 5: Re-run the UI test file**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

Expected: existing 138 cases plus the new single/batch/error cases pass.

### Task 4: Make bilimi-only deletes available from ordinary and all-favorites scopes

**Covers:** I006 (R007, R008), I007 (R009, R010)

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/shared/favoriteLibraryOperations.ts`
- Modify: `src/shared/favoriteLibraryOperations.test.ts`
- Modify: `electron/main/favoriteLibraryOperationsIpc.ts`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`
- Modify: `electron/main/favoriteLibraryOperationSource.ts`
- Modify: `electron/main/favoriteLibraryOperationsIpc.test.ts`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.test.ts`

- [ ] **Step 1: Write focused renderer and IPC tests**

For `other` and `virtual` sources, assert batch and detail views hide “移动至” and “同步到 B 站”, retain refresh/reorganize/transcription/export, and display both existing bilimi delete actions. Assert selected videos with a bilimi relation can select their other bilimi relations; a video with no bilimi relation is skipped. Assert a source that is ordinary B站 never sends an ordinary folder id as a deletion target.

- [ ] **Step 2: Run the target tests and observe RED**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/shared/favoriteLibraryOperations.test.ts electron/main/favoriteLibraryOperationsIpc.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: current action matrices hide deletes in at least one scope and main-process scope validation rejects the virtual/ordinary request before its per-video bilimi targets can be resolved.

- [ ] **Step 3: Expand only authoritative bilimi target resolution**

Keep ordinary and virtual folders read-only as sources. Let their deletion requests carry no ordinary source target; resolve each selected video's existing `bilimi-logical:*` memberships from the authoritative repository index, then validate those targets in IPC/service. Reuse the current “同时从其他 bilimi 工作夹移除” selection data rather than adding a new picker. Do not give ordinary folders move, sync, local deletion, or remote B站 mutation permission.

- [ ] **Step 4: Preserve existing recycle semantics**

After the selected bilimi memberships are removed, leave every ordinary B站/user favorite untouched. Route only videos with no remaining actual favorite source through the existing recycle decision; preserve metadata, archive, transcript, and history records.

- [ ] **Step 5: Re-run focused renderer, shared, and main-process tests**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/shared/favoriteLibraryOperations.test.ts electron/main/favoriteLibraryOperationsIpc.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: actions are visible in the requested scopes, targets remain bilimi-only, and non-bilimi sources survive.

### Task 5: Audit the ledger, build, and real desktop flows

**Covers:** I001-I007

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-15-deletion-interaction-regression.md`
- Modify: this plan file

- [ ] **Step 1: Record per-index implementation evidence**

Append code locations, test commands/results, and true UI evidence to each I001-I007 row without altering R001-R010 original text. Correct the existing I001 diagnosis only in the appended implementation record when the test proves current save logic already covers it.

- [ ] **Step 2: Run final static and targeted verification**

Run: `git diff --check`

Run: `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/shared/favoriteLedgerDeletion.test.ts src/shared/favoriteLedgerCapabilities.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/shared/favoriteLibraryOperations.test.ts electron/main/favoriteLibraryOperationsIpc.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts`

Expected: exit code 0 and no test failures.

- [ ] **Step 3: Verify in Electron development mode**

Exercise: save a custom local ledger then select it; both default-card delete scopes; unbound classification exclusion; left single and top batch work-folder deletion; ordinary/all batch/detail bilimi deletes with and without another ordinary source. Confirm mouse click, scroll, resize, minimize, and close remain responsive. Store screenshots/logs under `.codex-artifacts/`.

- [ ] **Step 4: Re-read R001-R010 and the index, update task markers, then commit**

Run: `git status --short`

Run: `git diff --stat`

Run: `git diff --check`

Stage only the ledger, this plan, tests, and code directly required by I001-I007. Commit once on local `main` with an accurate scoped message. Do not push, merge, rebase, reset, stash, or clean.

## Execution Record (2026-08-15)

- Task 1: Implemented before this session and independently verified by the focused assistant test within the 312-test command. The persisted local-draft normalization is already present; recovered remote drafts remain drafts.
- Task 2: Implemented and covered by `FavoriteLedgerOverview.test.tsx`, `favoriteLedgerDeletion.test.ts`, `favoriteLedgerCapabilities.test.ts`, and both classifier test files.
- Task 3: Implemented and covered by `FavoriteLibraryApp.test.tsx`; the dialog now has explicit `single` and `batch` modes. The single-file test was rerun after one async test wait fix: 139 passed with no `act(...)` warning.
- Task 4: Implemented and covered by `FavoriteLibraryApp.test.tsx`, `favoriteLibraryOperations.test.ts`, `favoriteLibraryOperationsIpc.test.ts`, and `favoriteRepositoryBatchOperationService.test.ts`.
- Task 5: `npm test --` for the nine focused files completed with 312 passed; `npm run build` completed with exit 0. `@oai/sky` cannot supply the required desktop automation documentation API, so destructive Electron paths were not invoked against real account data. The ledger records every item as implemented but pending real Electron UI acceptance.
