# 收藏库提示、同步与删除修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让收藏库的操作反馈只出现在“小咪收藏库（当前账号）”标题行，并使收藏库的同步、仅本地删除及受管 B 站删除按已有真实数据和远端执行链稳定收束。

**Architecture:** UI 只投影主进程给出的快照、运行状态和回执，不在 renderer 轮询或逐项等待远端操作。收藏库批量同步使用一个主进程持久化的轻量运行控制器，复用已有位置同步和同账号远端队列，但不借用整理收藏的冻结计划或草稿。删除以仓库的实际本地位置和实际受管远端写入事实为准；本地删除是可重放的本地收束，远端删除只有确认后才调用桥接。

**Tech Stack:** Electron main/preload IPC、TypeScript、React、Vitest、既有 favoriteRepository 同步/审计/快照服务。

---

## 文件范围与不可改边界

- 修改：`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`、`FavoriteLibraryHeader.tsx`、对应测试。
- 修改：`electron/main/favoriteLibraryCommands.ts`、`favoriteLibraryOperationsIpc.ts`、`favoriteRepositorySyncService.ts`、`favoriteRepositoryBatchOperationService.ts`、预加载和共享接口，以及对应测试。
- 修改：`docs/项目功能项目书.md`、本轮账本。
- 不修改：详情页“收藏库归属 / B站收藏夹归属 / 归属状态”三行语义；整理收藏草稿/冻结计划；普通 B站来源、档案/转写、其它账号、B站登录与 Cookie。
- 性能：任何远端 I/O、检查点写入和大批次推进都在主进程异步队列中进行；不得让 renderer 的循环、同步等待或整页 busy 遮罩影响鼠标、滚动、缩放、最小化、恢复、关闭。

### Task 1: 顶栏操作反馈（R001 / I001）

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryHeader.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Write the failing UI regression test**

Render an error/success feedback state and assert `data-testid="favorite-library-workspace-feedback"` is nested in the `FavoriteLibraryHeader` heading row containing `小咪收藏库`, while no feedback node is in `.favorite-library__workspace-heading`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "renders library action feedback in the library header"`

Expected: FAIL because the feedback is currently rendered after the working-folder `h2`.

- [x] **Step 3: Implement the smallest feedback slot move**

Pass the existing `workspaceFeedback` node into `FavoriteLibraryHeader` as an explicit `feedback`/children slot in its existing title row. Remove only the working-folder placement. Keep confirmation-dialog body copy and row-local transcription state outside this slot.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "renders library action feedback in the library header"`

Expected: PASS.

### Task 2: 本地 bilimi 归属删除的 revision 与幂等收束（R001 / I003）

**Files:**

- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`
- Test: `electron/main/favoriteRepositoryBatchOperationService.test.ts`
- Modify if required by source validation: `electron/main/favoriteLibraryOperationsIpc.ts`

- [x] **Step 1: Write failing service regressions**

Add one test where `expectedRevision` is stale but a selected video still has the target local bilimi placement: it must remove only that placement and commit against the latest revision. Add one test where the target placement was already removed by a preceding accepted submission: it must return an idempotent local result without remote bridge calls or removal of another folder.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts -t "local deletion"`

Expected: FAIL with stale revision or no matching placement under the old implementation.

- [x] **Step 3: Implement bounded latest-snapshot local deletion**

For `deleteLocal` only, read the authority snapshot after source validation, resolve targets there, and commit with that snapshot revision. Treat target positions already absent as an idempotent skipped result. Do not loosen revision rules for copy/move, and do not invoke remote delete/sync services.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- electron/main/favoriteRepositoryBatchOperationService.test.ts -t "local deletion"`

Expected: PASS.

- [x] **Step 5: Make persisted interruption recovery explicit and safe**

Expose the account’s paused/recent-unknown run through the existing command, IPC and preload layers so reopening the library restores its title-row controls or result. A persisted `running` checkpoint with no `currentAid` becomes `paused`; a checkpoint with `currentAid` becomes a completed run with that aid recorded as `unknown`, so no remote write is retried automatically. Regressions cover both cases, command forwarding, and the reopened renderer.

### Task 3: 受管 B站 bilimi 删除的确认和未同步分流（R001 / I004）

**Files:**

- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `electron/main/favoriteRepositoryBatchOperationService.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `electron/main/favoriteRepositoryBatchOperationService.test.ts`

- [x] **Step 1: Write failing UI and service regressions**

Verify single-video remote delete remains clickable when its remote placement evidence is empty and opens a modal containing exactly `没有实际存入B站bilimi收藏夹`. Verify batch preview reports an empty managed target set without throwing; renderer shows the same copy and makes no execute IPC call. Verify an observed, bound target still reaches the existing confirmation and execute route.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBatchOperationService.test.ts -t "没有实际存入B站bilimi收藏夹|remote.*delete"`

Expected: FAIL because the button is disabled and empty preview currently throws.

- [x] **Step 3: Implement evidence-only modal branching**

Never disable the entry merely for lack of remote evidence. Keep the existing confirmation path for actual managed `remoteObserved` facts. Make preview return a typed empty plan for no facts, render the exact missing-target text, and never execute the remote action in that branch. Do not derive evidence from local desired positions or the ownership-consistency label.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBatchOperationService.test.ts -t "没有实际存入B站bilimi收藏夹|remote.*delete"`

Expected: PASS.

### Task 4: 收藏库专用的主进程批量同步控制（R001 / I002）

**Files:**

- Modify: `src/shared/favoriteRepository.ts`
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Modify: `electron/main/favoriteLibraryCommands.ts`
- Modify: `electron/main/favoriteLibraryOperationsIpc.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `electron/main/favoriteLibraryCommands.test.ts`
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`

- [x] **Step 1: Write failing command and UI regressions**

Specify a library sync run containing two aids: start returns a run snapshot, work is scheduled by the main process through the existing same-account remote queue, pause stops before the next item, resume continues from the persisted item/checkpoint, and finish abandons remaining items without touching the organize-workspace frozen plan. Specify a one-aid command completes through the same service and renderer refreshes its library snapshot. Verify renderer does not use a timed aid loop.

- [x] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts electron/main/favoriteLibraryCommands.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "favorite library.*sync run|library sync.*pause|single.*library sync"`

Expected: FAIL because no library-owned run controller exists and renderer owns `setTimeout` polling.

- [x] **Step 3: Implement the minimal persistent library run adapter**

Add a library-owned run/checkpoint record keyed by account/run id, with pending/running/paused/stopped/completed states and per-aid result records. Start/preflight only accepts existing formal bindings; each item calls existing `synchronizePlacements`, which retains existing operation keys, remote queue and success/unknown/failed audit behavior. Expose start/read/pause/resume/stop IPC; the renderer starts or controls it and renders its snapshot without a per-aid loop. It must never create/replace `frozenSyncPlan`, regenerate classification, or implicitly bind/backup.

- [x] **Step 4: Run focused tests to verify they pass**

Run: `npm test -- electron/main/favoriteRepositorySyncService.test.ts electron/main/favoriteLibraryCommands.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "favorite library.*sync run|library sync.*pause|single.*library sync"`

Expected: PASS.

### Task 5: 文档、账本和交叉回归（R001 / I001–I004）

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-06-favorite-library-sync-delete-feedback-discussion.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: Record evidence per index item**

For I001–I004, record exact implementation files, individual automated test names/results, and whether real Electron UI and an authorized real B站 account have been checked. Never infer actual remote write/delete from mocks.

- [x] **Step 2: Run quality and regression commands**

Run: `git diff --check`; the focused test files; `npm test`; `npm run build`.

Expected: all commands exit 0. If any fail, preserve the failure and repair before commit.

- [x] **Step 3: Perform mandatory real UI validation**

In Electron development mode, validate: all library feedback appears only on the `小咪收藏库` row; batch sync permits pause/resume/finish without mouse or window interaction stutter; local delete updates selection/detail/count and sends no B站 bridge call; synced remote delete confirms then refreshes; unsynced delete shows exactly `没有实际存入B站bilimi收藏夹` and sends no remote request. Record unavailable external-account evidence honestly in the ledger.
