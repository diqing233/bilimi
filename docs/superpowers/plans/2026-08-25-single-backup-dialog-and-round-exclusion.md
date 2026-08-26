# 单窗口备册确认与本轮取消勾选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同步前备册在一个弹窗内完成候选 ID 选择、创建/绑定和分册确认，并使取消任何收藏夹勾选只排除当前整理轮而不删除或隐藏收藏夹。

**Architecture:** 主进程只读预检扩展为同时返回缺少首册的同名远端候选；渲染器把这些候选和容量分册投影到既有“同步前备册确认”中。确认时通过既有备册命令携带精确用户选择，禁止 `FavoriteLedgerOverview` 再创建第二层对话。推荐卡片在当前轮取消采用后仍保留为本地显示项，状态由工作区采用集决定；删除仍只有独立删除事务可达。

**Tech Stack:** Electron IPC、React 19、TypeScript、Vitest、Testing Library。

---

### Task 1: 更新规范并写单窗口预检的失败测试

**Files:**
- Modify: `docs/项目功能项目书.md:416`
- Modify: `docs/contracts/favorites.md`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [ ] **Step 1: 明确项目书和契约的验收边界**

在项目书 §5.8 与收藏夹契约中写明：一个同步前备册窗口包含逻辑收藏夹、候选精确 ID 和分册；取消勾选不删除、不隐藏；关闭不写 B 站。

- [ ] **Step 2: 写渲染器 RED 测试**

新增用例：预检返回一个 `unbacked` 逻辑收藏夹及其候选时，点击`确认备册并继续`前页面只有一个 `同步前备册确认` dialog；候选 ID 出现在同一 dialog 内；选择后调用一次备册命令，并且不出现 `确认创建并绑定 bilimi 收藏夹` dialog。

```ts
expect(screen.getAllByRole('dialog')).toHaveLength(1)
expect(within(dialog).getByText('ID：remote-genshin')).toBeInTheDocument()
expect(screen.queryByRole('dialog', { name: '确认创建并绑定 bilimi 收藏夹' })).toBeNull()
```

- [ ] **Step 3: 写主进程 RED 测试**

构造一个没有物理分册、远端存在同名候选的已选目标，断言 `getBilibiliExecutionPreflight` 把候选 ID、标题和成员数附在缺少首册条目上，且该读取不创建或绑定任何收藏夹。

- [ ] **Step 4: 运行 RED 测试**

Run: `node_modules\\.bin\\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "single backup confirmation"`

Expected: FAIL，因为当前预检不携带缺少首册候选且确认会打开第二层对话。

### Task 2: 实现一个同步前备册确认窗口

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.ts`（或声明 `OldFavoriteWorkspaceBilibiliSyncPreflight` 的现有共享类型文件）
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4290-4460`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:72,847-900`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:752-916,1123-1143`

- [ ] **Step 1: 扩展只读预检的数据**

为每个 `missingLedgers` 项添加可选的 `bindingCandidates`，按和分册候选相同的精确标题比较规则读取候选；只返回 ID、远端标题和成员数，不执行创建/绑定。

- [ ] **Step 2: 让外层弹窗维护所有必选候选的选择**

用逻辑收藏夹 ID 与分册键分别维护选择；预检展示时预选唯一/首个候选。缺少首册或分册存在候选但没有有效选择时禁用确认按钮。

- [ ] **Step 3: 让确认调用既有备册命令而不产生内部对话**

扩展 `FavoriteLedgerOverviewHandle.requestBackup` 参数以接受预先确认的 `confirmCreateAndBind`、`rebindRemoteFolderIds`、`rebindRemoteFolders` 和 `suppressConfirmationDialog`。外层确认将当前同窗选择传入；如果创建前二次读取发现候选变化，返回候选结果给外层以替换同一预检窗口，绝不设置内部 `rebindCandidates`。

- [ ] **Step 4: 重新读取预检并继续既有容量/同步路径**

首册创建/绑定完成后先重新读取预检；仍有缺口时原窗口更新；无缺口时只为无候选容量分册调用既有 `provisionBilibiliExecutionPreflightShards`，最后重检并进入原来的冻结执行。

- [ ] **Step 5: 运行 GREEN 测试**

Run: `node_modules\\.bin\\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "single backup confirmation"`

Expected: PASS，且 mock 创建/绑定/同步只在点击确认后发生。

### Task 3: 写取消推荐勾选但保留卡片的失败测试

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] **Step 1: 写推荐卡片 RED 测试**

构造已采用、纯本地推荐的收藏夹：第一次点击取消勾选后，断言卡片仍存在且为未勾选，推荐采用命令收到移除的 candidate ID；不调用 `deleteFavoriteLedgersLocal`、`deleteFavoriteLedgerDraft` 或受管远端删除接口。

- [ ] **Step 2: 写已保存规则回归测试**

取消已保存规则后，断言它仍在卡片列表，只调用 `set-round-excluded-ledger-ids`，不调用 `onSaveLedgerEnabled`、`onSaveLedgers` 或删除接口。

- [ ] **Step 3: 运行 RED 测试**

Run: `node_modules\\.bin\\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "keeps.*card|excludes.*saved"`

Expected: FAIL，因为当前纯本地推荐取消后被加入 `dismissedGeneratedRecommendationLedgerIds` 并从列表过滤。

### Task 4: 实现本轮排除而非隐藏/删除

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:205-363,390-426`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:630-710`

- [ ] **Step 1: 保留已展示的推荐卡片**

删除“取消采用即移除 promoted ledger / 加入 dismissed set”的路径。推荐候选的采用状态只控制卡片勾选与分类投影，不控制它在右侧已显示收藏夹列表中的可见性；重新勾选恢复采用即可。

- [ ] **Step 2: 保持已保存规则的本轮排除通道不变**

保留 `setRoundExcludedLedgerIds` 为已保存规则的唯一取消通道；不得把该交互接到 `onSaveLedgerEnabled`、规则保存或删除模式。

- [ ] **Step 3: 运行 GREEN 测试**

Run: `node_modules\\.bin\\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "keeps.*card|excludes.*saved"`

Expected: PASS，取消勾选后卡片仍在，且所有删除 mock 均未调用。

### Task 5: 回归、Electron 只读验收与账本

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-24-reselect-ledger-zero-targets.md`
- Modify: `docs/contracts/favorites.md`
- Create: `.codex-artifacts/2026-08-25-single-backup-dialog.png`
- Create: `.codex-artifacts/2026-08-25-round-exclusion-keeps-card.png`

- [ ] **Step 1: 运行相关回归**

Run: `node_modules\\.bin\\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS。

- [ ] **Step 2: Electron 开发版只读验收**

在本地测试数据或现有草稿中只读检查：一个备册确认窗口内显示候选 ID 与分册；取消勾选后卡片仍显示未勾选。不得点击确认备册、创建、绑定、删除或同步按钮。截图保存到 `.codex-artifacts/`。

- [ ] **Step 3: 回填账本 I013/I014**

记录代码位置、RED/GREEN 命令结果、截图路径、以及未执行真实 B 站创建/绑定/同步的边界。

- [ ] **Step 4: 完成前检查并选择性提交**

Run: `git diff --check && git diff --stat && git status --short`

仅暂存本计划列出的代码、测试、项目书、契约、账本和计划；若已有未提交文件与本次范围重叠而无法拆分，停止并报告，不能混入提交。
