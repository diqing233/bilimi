# 整理收藏：项目书对账实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使“整理收藏”严格按项目书呈现真实 B 站来源、可审计的标签截止版本、完整本轮保存/同步资格和一致的推荐投影。

**Architecture:** Electron 主进程仍是工作区、来源选择、标签检查点和分类的唯一权威；渲染层只按快照展示。将旧的“绑定关系决定扫描资格”兼容规则收束为“所有已读取来源可选”，并把“采用当前标签”提升为覆盖所有批次的持久化标签截止版本；保存/同步始终使用同一个完整工作区分类范围。

**Tech Stack:** TypeScript、React、Electron IPC、Vitest、现有 `OldFavoriteWorkspaceCoordinator` 持久化 journal。

> **执行状态（2026-08-17）：** Task 1–4 已按本计划实施；逐项代码位置、定向回归和未完成的真实界面验收以需求账本“2026-08-17 实施与验证索引更新”为唯一审计记录。Task 5 的 Electron 开发版仅完成无写入的基础启动验收；由于没有可安全只读打开的既存整理工作区，截图指定的扫描/确认页面仍为“已实施待真实界面验收”，不能用空闲页替代。

---

## 需求对账

### 已确认（按讨论原文顺序）

1. `R001 / I001`：第一批 `ready`、后续批 `tagging` 时，本轮总览显示第一批推荐，不能只显示占位统计。
2. `R002 / I003`：取消未备册推荐后，推荐、上方卡片、详情和删除模式同步移除；已备册/未绑定推荐只取消本轮勾选，不能触发本地或 B 站删除。
3. `R005–R007 / I006、I008`：扫描概览只显示本次确认读取的 B 站事实；所有远端夹一视同仁可勾选/取消；保护仅影响视频级待整理数。
4. `R009 图一 / I010`：扫描概览表头精确改为 `B站收藏夹`。
5. `R009 图二 / I011`：`继续补取标签`、`采用当前标签`始终保留；无可继续/采用工作时置灰。
6. `R008、R010–R011 / I013、I014`：采用当前标签暂停后续补取，以完整扫描范围重算；补取、完整范围重算或 DeepSeek 实际运行时禁止保存与同步，否则允许完整本轮保存和同步。
7. `R009 图三 / I012`：多批本轮总览将说明、准备度、提示和本轮操作放在汇总/归档目标之前。

### 被明确替代

- `R002 / I002` 中“扫描概览独立 bilimi 工作夹区域”的方案，被 `R005–R007 / I008` 明确替代；不恢复该区域，也不按名称猜测绑定关系。

### 待用户决定

- 无。

## 文件职责与允许修改范围

- `src/shared/oldFavoriteWorkspace.ts`：来源选择/指标的跨端权威语义。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：来源选择、标签截止版本、完整范围保存和同步前置条件。
- `electron/main/oldFavoriteWorkspaceStore.ts`：标签截止版本/恢复的 journal delta（仅在现有 delta 无法安全表达全轮采用、继续补取失效时改动）。
- `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`：总览推荐可见性门槛。
- `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`：纯 B 站来源表、标签按钮可见/禁用状态。
- `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`：完整本轮资格、阻止原因和多批总览顺序。
- `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：推荐取消后的卡片投影与删除入口一致性。
- 对应 `*.test.ts(x)`：每一条行为的先红后绿回归；`docs/requirement-ledgers/...`：逐项证据；`docs/项目功能项目书.md`：仅保留已确认最终设计。

### Task 1: 锁定总览推荐与推荐取消投影

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteGuide.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [x] **Step 1: 写 R001、R002 的失败回归**

  - 渲染两批快照：第一批 `ready` 并有推荐，第二批 `tagging`，全局标签状态 `running`；选择“本轮总览”后断言第一批推荐卡片和“已汇总 1/2 批”均出现。
  - 驱动“已保存、未备册”的推荐从选中变为取消；等待权威保存 promise 后断言推荐未选、上方卡片/详情/删除模式均不存在，且删除 IPC 未对该已移除 ID 再调用。
  - 另建已备册或未绑定规则，断言取消推荐只改变候选选中态而保留规则卡片。

- [x] **Step 2: 运行定向测试，确认 RED**

  Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 新断言因总览守卫或陈旧 promotion 投影而失败；不能因测试夹具错误报错。

- [x] **Step 3: 最小实现并保持单一投影**

  - 总览内容资格严格为“存在任一 `ready`/`saved` 批”；当前批仍沿用自身 readiness。
  - 推荐取消成功后，以真实保存结果清除纯本地生成候选的 promotion，并标记该候选卡片在刷新前不可再走删除 IPC；真实规则只取消推荐选择。

- [x] **Step 4: 运行定向测试，确认 GREEN**

  Run: 同 Step 2。

### Task 2: 使扫描概览成为纯 B 站来源表

**Files:**
- Modify: `src/shared/oldFavoriteWorkspace.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/shared/oldFavoriteWorkspace.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`

- [x] **Step 1: 写 R005–R007、R009 图一的失败回归**

  - 构造普通、`bound`、`reconcile-required` 和名称含 `bilimi` 的四个已读取远端夹；断言全选包含四项、单独取消任意项有效、已保护视频只从该项待整理数排除。
  - 断言旧持久化里的 `scanEligible: false` 不再拒绝选择 `bound` 远端夹，且指标中该夹仍显示真实成员数。
  - 渲染表格，断言标题/可访问名称为 `B站收藏夹`，不存在 `已备册`、`未绑定` 与禁用复选框。

- [x] **Step 2: 运行定向测试，确认 RED**

  Run: `npm test -- --run src/shared/oldFavoriteWorkspace.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`

  Expected: 新测试明确因关系资格过滤、关系徽标或旧表头失败。

- [x] **Step 3: 最小实现来源事实语义**

  - 保留关系字段仅供掌库/收藏库的其他投影和旧快照恢复；在扫描来源域中不再用它过滤、清空选择或决定指标。
  - `projectOldFavoriteInventoryMetrics` 按已选远端来源去重并扣除失效/保护视频；0 和保护数均不影响行存在或可选性。
  - 扫描概览移除关系文字/禁用条件，`全选`覆盖全部已读取行；只改该表的标题文案。

- [x] **Step 4: 运行定向测试，确认 GREEN**

  Run: 同 Step 2。

### Task 3: 实现全轮标签截止版本与完整范围保存

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.test.ts`（若新增全轮 accept/resume journal delta）
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceStore.ts`（仅若需持久化新 delta）
- Modify: `src/shared/oldFavoriteWorkspace.ts`（仅若需向渲染层投影可执行资格/阻止原因）
- Modify: `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`

- [x] **Step 1: 写 R009 图二、R008、R010–R011 的失败回归**

  - 多批工作区基础扫描完成、后一批仍有 pending tags 时，调用 `acceptCurrentTags` 后断言：所有批都有同一轮的采用版本、补取安全暂停、完整范围分类包含未补取项的 `inbox` 归宿，且 `saveWholeRunToLocalLibrary` 不再因 `tagging/waiting` 拒绝。
  - 恢复补取后断言标签截止版本失效，保存/同步再次被拒绝；DeepSeek `running` 时同样拒绝。
  - 无 pending 或无增量时断言 `继续补取标签` 和 `采用当前标签`均可见且 disabled；有工作时恢复 enabled。
  - 确认执行组件断言采用截止版本后完整保存/同步 enabled，实际补取/重算/DeepSeek 运行分别 disabled 并显示正确原因。

- [x] **Step 2: 运行定向测试，确认 RED**

  Run: `npm test -- --run electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

  Expected: 现有实现只接受当前批、隐藏不可用按钮、并要求每批 ready/saved，故新测试失败。

- [x] **Step 3: 最小实现可审计的全轮截止版本**

  - `acceptCurrentTags` 对完整工作区的每个批记录当前标签版本并安全暂停未完成请求；在途结果仍按原有 durable delta 落库，任何新增/变化会使截止版本失效。
  - 恢复补取显式清除完整本轮的执行资格而不丢已读标签、人工分类、候选或检查点。
  - 标签 ready 断言在存在有效完整截止版本时允许完整范围分类/保存；未补取项不成为“确认无标签”，而以默认 `inbox`/未匹配归宿进入本地计划。
  - 本地保存和冻结同步都先验证基础扫描完成、有效完整截止版本、重算完成与非 DeepSeek 运行，再遍历完整范围；不得执行真实 B 站写入测试。
  - UI 始终渲染两按钮，并用 disabled 属性和真实状态区分“运行中”“无待办”“无新版本”。

- [x] **Step 4: 运行定向测试，确认 GREEN**

  Run: 同 Step 2。

### Task 4: 重排多批总览操作区并做回归验证

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`
- Modify: `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`

- [x] **Step 1: 写 R009 图三的失败回归**

  - 多批、`viewScope === 'all'` 渲染后，通过 DOM 顺序断言“本轮操作”在“已汇总 N/M 批”之前；当前批和单批断言保持原顺序。

- [x] **Step 2: 运行测试，确认 RED**

  Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 3: 最小重排并记录账本证据**

  - 只在多批本轮总览调整 JSX 排列；复用同一操作组件/事件，不能复制状态或更改按钮副作用。
  - 在账本索引逐项附上实际代码位置、测试名称、命令结果和待完成的真实 Electron 验收位置。

- [x] **Step 4: 定向回归**

  Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteGuide.test.tsx src/renderer/src/features/assistant/OldFavoriteRecommendationStep.test.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts src/shared/oldFavoriteWorkspace.test.ts`

### Task 5: 总体验收与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`
- Modify: `docs/项目功能项目书.md`（仅在代码与项目书仍有最终语义不一致时）
- Create: `.codex-artifacts/2026-08-17-organize-favorites-reconciliation/`（真实 Electron 截图/命令证据）

- [x] **Step 1: 原文逐项回读并更新账本**

  对 `R001–R011` 逐项写入代码位置、自动化测试、真实界面验收和未能验证条件；被替代的 `I002` 保留引用且写明排除依据。

- [x] **Step 2: 运行质量门槛**

  Run: `git diff --check; npm test; npm run build`

  Expected: 无 diff 空白错误，测试与构建通过。

- [ ] **Step 3: Electron 开发版只读验收（部分完成；具体工作区验收待进行）**

  - 启动开发版，不启动扫描、不保存、不备册、不点同步。
  - 在可控测试/静态工作区中检查 B站收藏夹文案、已绑定行仍可勾选、标签按钮 disabled/visible、总览操作顺序、窄侧栏不遮挡；将截图保存到 `.codex-artifacts/2026-08-17-organize-favorites-reconciliation/`。

- [x] **Step 4: 提交前检查与单次本地提交**

  Run: `git status --short; git diff --stat; git diff --check; npm test`

  只在所有已确认条目都有证据、没有无关文件且当前本地 `main` 通过检查时执行：

  `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md docs/superpowers/plans/2026-08-17-organize-favorites-reconciliation.md src/shared/oldFavoriteWorkspace.ts electron/main/oldFavoriteWorkspaceCoordinator.ts electron/main/oldFavoriteWorkspaceStore.ts src/renderer/src/features/assistant/OldFavoriteGuide.tsx src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx ...`

  `git commit -m "fix: reconcile favorite organization workflow"`

## 自查

- 覆盖：Task 1=`R001,R002`，Task 2=`R005–R007,R009 图一`，Task 3=`R008,R009 图二,R010,R011`，Task 4=`R009 图三`。
- 旧独立工作夹扫描区只在账本保留，不被任何任务恢复。
- 保存与同步测试只验证命令资格和本地 repository 计划；不得执行 B 站真实写入。
