# 正式绑定投影与勾选响应性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or an equivalent task-by-task flow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 防止已创建并正式绑定的分册在恢复时被旧候选降级为未绑定，并让上方收藏夹勾选只触发一次可让步的分类与历史写入。

**Architecture:** 恢复投影在提交候选前读取最新仓库快照并重新规划分册，因此先前已登记的精确 `folderId` 保持 `bound`，另一个远端 ID 才成为待确认分册。渲染器继续将上方勾选交给 `setRoundExcludedLedgerIds` 完成工作区分类与合并历史，后续账号偏好调用只持久化参与选择。

**Tech Stack:** TypeScript、Electron 主进程、React 渲染器、Vitest、现有收藏仓库与工作区协调器。

---

### Task 1: 锁定正式绑定不可被恢复投影降级

**Files:**

- Modify: `electron/main/favoriteLibraryManagedFolderProjection.test.ts`
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `electron/main/favoriteLibraryManagedFolderProjection.ts`
- Modify: `src/shared/favoriteRepository.ts`

- [x] **Step 1: 写入失败回归**

```ts
it('keeps a newly bound folder when restore projects an older same-name candidate', async () => {
  // 先将新 ID 登记为 bound，再以旧快照投影不同 ID 的同名候选。
  // 断言新 ID 保持 bound，旧 ID 成为另一 pending-reconcile 分册。
})

it('does not downgrade a bound shard to pending reconcile', async () => {
  // 对同逻辑册/分册提交迟到 pending-reconcile 命令。
  // 断言持久化后的 shard 仍为 bound。
})
```

- [x] **Step 2: 运行 RED**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts src/shared/favoriteRepository.test.ts -t "bound|pending reconcile|older same-name candidate"`

Expected: 新增断言失败，且失败原因是恢复投影或命令层仍可覆盖 `bound`。

- [x] **Step 3: 写入最小实现**

```ts
// 恢复候选提交前重新读取 latest snapshot，并以 latest ledger 规划 shards。
// 仓库提交层拒绝用 pending-reconcile 覆盖相同逻辑册/分册的 bound shard。
```

- [x] **Step 4: 运行 GREEN**

Run: 同 Step 2。

Expected: 新增回归与既有恢复/仓库测试通过；不同 ID 候选仍保留。

### Task 2: 锁定上方勾选只提交一次分类历史

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [x] **Step 1: 写入失败回归**

```tsx
it('saves the account preference without a second history merge after toggling a saved rule', async () => {
  // 上方已保存规则触发 setRoundExcludedLedgerIds；
  // 断言 onSaveLedgerEnabled 不接收 mergeFavoriteRuleHistory 选项。
})
```

- [x] **Step 2: 运行 RED**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "second history merge"`

Expected: 断言显示偏好保存仍携带第三个 `mergeFavoriteRuleHistory` 参数。

- [x] **Step 3: 写入最小实现**

```ts
void onSaveLedgerEnabled(nextEnabled)
// 保留即时投影、稳定规则 ID 联动、setRoundExcludedLedgerIds 的唯一分类/历史提交。
```

- [x] **Step 4: 运行 GREEN**

Run: 同 Step 2。

Expected: 面板回归通过，偏好仍保存且没有第二次 journal 历史重放。

### Task 3: 聚焦回归、只读界面验收与审计

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-29-bound-projection-and-toggle-responsiveness.md`
- Evidence: `.codex-artifacts/`

- [x] **Step 1: 运行聚焦回归**

Run: `npm test -- electron/main/favoriteLibraryManagedFolderProjection.test.ts src/shared/favoriteRepository.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 所有聚焦测试通过。

- [x] **Step 2: Electron 只读验收**

启动开发版，仅观察已绑定分册不会列入`未绑定`确认；勾选/取消时检查鼠标移动、点击、滚动、缩放、最小化与关闭仍可响应。不得点击任何创建、绑定、删除或视频写入确认。截图保存至 `.codex-artifacts/`。

- [x] **Step 3: 最终验证与提交**

Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short`。

仅暂存本计划、账本、项目书、契约卡、两处生产代码及其测试；不包含 `pnpm-lock.yaml` 或 `pnpm-workspace.yaml`。通过后创建一次本地提交。
