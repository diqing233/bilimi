# 同步工作镜像完整性与响应性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or an equivalent task-by-task flow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复关系投影导致的假性工作镜像损坏，并移除确认同步点击路径上的整份 journal 重放，保留真实损坏保护和既有 B 站同步协议。

**Architecture:** `OldFavoriteWorkspaceStore.readRecoverySummary` 已经提供只读取且校验 manifest 的紧凑工作区引用，`createMarker` 改为使用它；完整 `recover` 仍在打开/重启/不一致时执行。Store 在活跃进程内复用已校验并解析的 overlay history，避免同步准备重复读取 20 MB journal；关系投影带入当前活动分段，恢复时仅对完整 journal 可证明的历史空分段做一致性修复。

**Tech Stack:** TypeScript、Electron 主进程、Vitest、现有 `OldFavoriteWorkspaceStore` 和 `OldFavoriteWorkspaceCoordinator`。

---

### Task 1: 锁定假性损坏的回归

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Verify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write the failing test**

```ts
it('keeps a scanned active segment recoverable after relationship projection refresh', async () => {
  // 完成一个含 segment-1 的扫描，刷新绑定关系，重新创建 coordinator。
  // 断言 reopened snapshot 仍是 previewing 且 currentSegment.id 为 segment-1，
  // 而不是 recovery: rebuild-required。
})
```

- [x] **Step 2: Run the exact test and verify RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "keeps a scanned active segment recoverable after relationship projection refresh"`

Expected: FAIL，当前关系投影把 manifest 的 `currentSegmentId` 写成空值，重新打开时得到 `rebuild-required`。

- [x] **Step 3: Implement the minimal fix**

```ts
await workspaceStore.appendOverlay(accountMid, workspace.id, {
  currentSegmentId: this.currentSegment(workspace),
  classifications: [],
  history: [],
  scanMetadata
})
```

同时只为“journal 已校验且历史中存在有效分段”的旧错误状态选择最后一个有效分段并修复 manifest；真正 checksum / JSON / 分段错误仍返回 `rebuild-required`。

- [x] **Step 4: Run the exact test and verify GREEN**

Run: 同 Step 2。

Expected: PASS；现有真实损坏测试仍保留。

### Task 2: 把 marker 与冻结分类读取移出全量重放路径

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: Write failing tests**

```ts
it('freezes an opened workspace without replaying its cached overlay journal', async () => {
  // 完成扫描、分类、绑定，记录 freeze 前的 store 读取。
  // 冻结后断言没有新增 overlay.journal.jsonl 读取，且 store.recover 未被调用。
})
```

- [x] **Step 2: Run the exact tests and verify RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "without replaying its cached overlay journal"`

Expected: FAIL，因为 `createMarker` 会调用 `recover`，且每次 `loadSelectedClassificationsForFreeze` 都读取并重放 journal。

- [x] **Step 3: Implement the minimal store/coordinator boundary**

```ts
const reference = await workspaceStore.readRecoverySummary(accountMid, workspaceId)
if ('recovery' in reference) throw new Error('Old favorite workspace requires rebuild.')
// 校验 reference 与当前内存 workspace 的 ID、账号、状态、基线和活动分段一致，
// 再写入 marker；不调用完整 recover。
```

`readOverlayHistory` 在 cursor、journal checksum 和文件名仍一致的活跃进程内直接复用已校验 history；`recover` 与 `appendOverlay` 维护该缓存，新的进程或任一 journal 边界变化仍完整校验。`createMarker` 使用已有的 `readRecoverySummary`，完整恢复路径维持不变。

- [x] **Step 4: Run the exact tests and verify GREEN**

Run: 同 Step 2。

Expected: PASS；冻结 marker 的工作区引用仍与 manifest 对齐。

### Task 3: 聚焦回归与真实界面验收

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-28-sync-click-lag-workspace-corruption.md`
- Evidence: `.codex-artifacts/`

- [x] **Step 1: Run protected automated regressions**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`

Expected: PASS；包含真实损坏、同步幂等、备册预检、恢复与 UI 错误投影回归。

- [x] **Step 2: Electron read-only validation**

启动开发版，打开现有整理草稿并只读检查：正常工作区不显示“工作镜像损坏”；窗口鼠标移动、滚动、缩放、最小化和关闭在同步准备 UI 中保持响应。不得点击任何创建、绑定、删除、备册或视频写入确认。

- [x] **Step 3: Record evidence and commit only this topic**

更新账本 I001/I002 的代码位置、测试、截图和无法真实验证的 B 站副作用；执行 `git diff --check`，只暂存项目书、计划、账本、工作区 store/coordinator 及其测试后创建一次本地提交。不得包含 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。

**Execution record (2026-08-29):** 4 focused test files / 549 tests passed. The existing `previewing` workspace opened the ordinary recovery dialog rather than a rebuild prompt; opening and closing it was responsive. Evidence: `.codex-artifacts/2026-08-29-sync-integrity-recovery-dialog.jpg`. A real `确认并同步到 B 站` click was intentionally not run because it would enter Bilibili writes; that remote-side-effect check remains manual. Ledger I001/I002 contains the detailed code and verification evidence.
