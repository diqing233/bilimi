# 推荐收藏夹勾选、详情删除与二次整理联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复推荐来源收藏夹在非整理状态下的勾选/详情删除，以及二次整理按稳定规则 ID恢复上下联动，同时保持删除模式、整理分类和 B 站副作用边界不变。

**Architecture:** 将“账号规则目录中是否已有该稳定 ID”作为推荐取消的持久化边界；已存在的推荐来源规则进入掌库投影和二次整理映射，取消只写账号级参与状态。仅账号目录中不存在的临时推荐候选可走窄化草稿删除；详情删除始终走独立本地删除事务。所有改变均保持现有异步队列，不在点击处理器中同步遍历整轮数据。

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, Testing Library。

---

### Task 1: 建立推荐状态矩阵失败回归测试

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/shared/favoriteLedgerDraftDeletion.test.ts`
- Modify: `electron/main/favoriteLedgerDraftDeletionIpc.test.ts`

- [x] **Step 1: 写入已持久化推荐来源规则的失败测试**

在 `ControlledFavoriteLedgerPanel.test.tsx` 增加一个 `recommendation-draft + local-draft + unbacked` 且已存在于 `ledgers` 的规则，渲染无活动整理工作区，点击掌库卡片“移出同步”，断言调用 `onSaveLedgerEnabled(id, false)`，且不调用 `window.bilimiDesktop.deleteFavoriteLedgerDraft`。

- [x] **Step 2: 写入真正临时推荐草稿的失败测试**

增加一个只存在于 renderer promoted 草稿集合、账号 `ledgers` 不含该 ID的推荐项，点击取消后断言该项从 promoted 集合移除，且不向未知规则 ID写入账号级启用状态。

- [x] **Step 3: 写入稳定 ID二次整理映射失败测试**

调用并断言导出的 `createRecommendationProjection`：输入一个已持久化 `recommendation-draft/local-draft/unbacked` 规则和同 ID候选时，`candidateToLedgerId`、`ledgerToCandidateId`均建立映射；输入同名但不同 ID规则时不按名称合并。

- [x] **Step 4: 写入详情删除独立失败测试**（复用并确认现有 `keeps recommendation cancellation separate from an explicit upper-rule deletion` 回归）

在 `FavoriteLedgerOverview.test.tsx` 增加已持久化推荐来源规则，打开详情后点击明确“删除”，断言调用 `onDeleteLedger(id)` 或现有本地删除 IPC路径，而不调用 `onOrganizationRecommendationToggle(id, false)`。

- [x] **Step 5: 写入主进程窄化删除保护失败测试**

在共享删除谓词和 IPC 测试中增加 `recommendation-draft/local-draft/unbacked` 规则，断言 `isPureRecommendationLedgerDraft`/`assistant:delete-favorite-ledger-draft` 拒绝删除该账号目录中已持久化的规则；同时保留无 `bindingState` 的临时纯草稿可删除。

- [x] **Step 6: 运行新增测试确认红灯**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/shared/favoriteLedgerDraftDeletion.test.ts electron/main/favoriteLedgerDraftDeletionIpc.test.ts --reporter=dot`

Expected: 新增状态矩阵断言至少有一项失败，且失败指向当前持久化边界/投影或删除谓词。

### Task 2: 修正 renderer 推荐持久化边界与二次整理映射

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [x] **Step 1: 将已存在规则 ID定义为已保存上方规则**

调整 `isSavedUpperLedger` 的调用边界，使 `createRecommendationProjection` 和 `persistedUpperLedgerIds` 接收账号目录中存在的稳定 ID；不要用 `ruleOrigin` 单独排除 `recommendation-draft`。

- [x] **Step 2: 将纯推荐草稿限定为未持久化临时项**

让 `isPureRecommendedLocalDraft` 的业务调用同时检查账号目录是否存在该 ID；已持久化的 `recommendation-draft/local-draft/unbacked` 必须走 `saveLedgerEnabledAndRefreshWorkspace`，只有 renderer-only promoted 候选或账号目录不存在的临时项走草稿移除。

- [x] **Step 3: 保持两侧 toggle 共用稳定 ID映射**

确保上方卡片和下方候选都通过 `createRecommendationProjection(...).candidateToLedgerId/ledgerToCandidateId` 分流；取消已映射规则只更新参与状态，取消纯草稿才移除采用记录和草稿投影；不添加名称合并逻辑。

- [x] **Step 4: 运行 renderer 定向测试确认绿灯**

Run: `npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`

Expected: 新增非整理勾选、二次整理映射、详情删除测试通过，既有测试无新增失败。

### Task 3: 收窄主进程推荐草稿删除 IPC

**Files:**
- Modify: `src/shared/favoriteLedgerDraftDeletion.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/favoriteLedgerDraftDeletionIpc.test.ts`

- [x] **Step 1: 让删除谓词只接受临时纯推荐草稿**

删除谓词不能仅凭 `ruleOrigin`、`syncState` 和无远端 ID判定可删除；由 IPC 先读取当前账号规则目录并拒绝目录中已有稳定 ID的持久化推荐规则。保留远端观察草稿判定和历史恢复集合。

- [x] **Step 2: 验证 IPC 拒绝持久化推荐规则**

Run: `npx vitest run electron/main/favoriteLedgerDraftDeletionIpc.test.ts src/shared/favoriteLedgerDraftDeletion.test.ts --reporter=dot`

Expected: 持久化推荐规则返回可读的草稿不可用错误，临时纯推荐草稿仍删除成功。

### Task 4: 全量回归、构建与项目书/账本验收记录

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md`

- [x] **Step 1: 运行定向与全量测试**

Run: `npx vitest run ControlledFavoriteLedgerPanel.test.tsx FavoriteLedgerOverview.test.tsx favoriteLedgerApi.test.ts src/shared/favoriteLedgerDraftDeletion.test.ts electron/main/favoriteLedgerDraftDeletionIpc.test.ts --reporter=dot`

Then run: `npm test`

Expected: 定向和全量测试均通过；仅允许既有 `act(...)` 警告，不得新增失败。

- [x] **Step 2: 构建并检查差异**

Run: `npm run build`; `git diff --check`; `git status --short`; `git diff --stat`

Expected: 构建成功、无空白错误、只包含本轮项目书/账本/计划和推荐收藏夹代码与测试。

- [ ] **Step 3: 真实 Electron 开发版验收（部分完成；真实账号勾选/删除与二次整理仍待隔离数据）**

启动开发版，构造或导入包含已持久化推荐来源规则的账号状态，依次验证：非整理状态上方勾选/取消；详情独立删除；删除模式仍可删除；第一轮结束后第二轮同 ID候选上下双向联动；取消下方纯草稿删除草稿；整个操作期间鼠标移动、点击、滚动、缩放、最小化、恢复、关闭连续响应。将截图和诊断输出统一放入 `.codex-artifacts/`。

- [x] **Step 4: 回填账本索引证据**

按 `I001`-`I005` 分别记录实际代码位置、自动化测试名称、Electron 界面证据和仍无法验证的条件；未完成真实界面验收的条目不得标记完成。

- [ ] **Step 5: 创建本轮单个提交并合并回 main**

在隔离分支执行：

```bash
git add docs/项目功能项目书.md docs/requirement-ledgers/2026-09-03-recommendation-toggle-relink.md docs/superpowers/plans/2026-09-03-recommendation-toggle-relink.md src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/shared/favoriteLedgerDraftDeletion.ts src/shared/favoriteLedgerDraftDeletion.test.ts electron/main/index.ts electron/main/favoriteLedgerDraftDeletionIpc.test.ts
git commit -m "fix: restore recommendation ledger toggles and relinking"
```

回到主工作树后先确认原有未提交文件仍原样存在，再执行非破坏性的 `git merge --no-ff codex/recommendation-toggle-relink`；不得提交或覆盖其它主题文件。
