# 扫描未完成却提示已结束：需求账本

## 原文记录

### R001 · 2026-08-21

**截图文件：** `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ff7161c1-31d1-4652-9c25-82273aef16da.png`

**截图目标区域：** 右侧“整理收藏 > 扫描概览 > 本轮总览”。截图中同时出现“已汇总 1/2 批”“尚未扫描 100 条”和“本轮扫描与标签补取已完成”的引导文案；扫描进度显示“已完成”，标签补取显示“本轮 2189 / 2572 条 · 已暂停”。

**用户原文：**

> 讨论没有扫描完为什么就提示已结束

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 修复扫描概览：基础扫描完成不等于标签补取完成；标签暂停、运行、失败或仍有待办时不能提示“本轮扫描与标签补取已完成”。移除把来源关系重复误报为“尚未扫描”的投影。 | “整理收藏 > 扫描概览 > 本轮总览”；完成引导、基础扫描进度状态、标签补取状态、本轮总览文字。 | 仅当基础扫描完成，且标签补取不存在或状态为`complete`、待补取/失败均为 0 时才显示完整结束引导。标签为`running`、`paused`、`accepted`、有待办或有失败时显示“基础扫描已完成”及真实标签状态；不渲染`尚未扫描 N 条`。 | 不新增按钮、不改变扫描、暂停、继续补取、采用、分类、保存或同步命令，仅修正快照显示。 | 不改持久化格式、迁移或 B 站读写；不触发收藏夹创建、绑定、删除或视频写入。 | 不修改 DeepSeek、转写、删除确认、视频同步、备册/绑定或来源选择规则。 | `OldFavoriteScanOverviewStep` 的显示派生；`OldFavoriteWholeRunOverview` 的概览文案；协调器概览投影与共享类型；项目书第 5.2。 | 已实施；Electron 只读验收完成 | **代码：** `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx:197-205,244-255,274-277` 以标签状态、待补取和失败数派生结束引导，并将第一行明确为“基础扫描已完成”；`src/renderer/src/features/assistant/OldFavoriteOverviewControls.tsx:83-89` 不再渲染漏扫提示；`src/shared/oldFavoriteWorkspace.ts:354-369`、`electron/main/oldFavoriteWorkspaceCoordinator.ts:6218-6307` 删除`unscannedItemCount`投影。<br>**RED/GREEN：** 新增暂停且待补取 383 条的回归，旧实现曾错误输出完整结束引导；`npx vitest run src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：3 files / 480 tests passed（`ControlledFavoriteLedgerPanel`有既有 React `act(...)` warning，退出码为 0）。`npm run build`及`git diff --check`均通过。<br>**Electron 只读：** 恢复既有本地暂停草稿后，本轮总览显示“基础扫描已完成，标签补取已暂停：待补取 381 条。”及“本轮 2191 / 2572 条 · 已暂停”，不显示“本轮扫描与标签补取已完成”或“尚未扫描”；来源表保留`待整理（2639·67）`。截图：`.codex-artifacts/2026-08-21-scan-premature-completion-paused-readonly.png`、`.codex-artifacts/2026-08-21-scan-premature-completion-paused-whole-run-readonly.png`。只进入并恢复了已有的本地草稿以查看界面；未点击继续/暂停补取、采用、保存、同步、创建、绑定或删除，未验证真实 B 站读写副作用。根因：旧的结束引导仅排除了基础扫描中的状态，未检查标签完成条件；另将来源成员关系数减去去重 AID 数，错误投影为漏扫。 |
