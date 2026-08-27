# 收藏夹取消勾选分类移动说明需求账本

> 讨论开始：2026-08-27。讨论模式仅记录原文、读取证据和讨论方案，不修改功能代码。

## 原文区

### R001

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-eed2f2e7-1a0e-4e3e-93d6-52217da898e7.png`

截图目标：`整理收藏 → 归档预览 → 改动记录`菜单。菜单显示了“勾选「原神」后，自动分类 437 条：bilimi·游戏专区 …”与紧随其后的“取消「原神」参与本轮分类，未产生分类移动”。用户要求讨论取消后为何没有说明分类移动条数/显示“无移动”。

```text
讨论勾选取消正常，但取消为什么没有说明分类移动多少条，无移动
```

### R002

```text
当前取消勾选后没有重分类或者回到原来的收藏夹分类吗，我看好像是有的
```

### R003

```text
如果有新的收藏夹符合呢
```

### R004

```text
但是归档预览不是本来就有自动分类的效果，每次新增就会重新计算呀
```

### R005

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-027cca5a-5c59-43cf-9748-8756a7ac3954.png`

截图目标：右侧“整理收藏”面板顶部已保存收藏夹区域、下方“改动记录”列表及“恢复初始改动”按钮；截图中上方仍显示并勾选 `honke...` 收藏夹，改动记录包含取消/新建收藏夹规则，用户指出恢复初始改动后上方收藏夹未被删掉，而取消勾选本身正常。

```text
恢复初始改动的时候怎么没有把上面的收藏夹删掉，取消都正常了
```

### R006

```text
整理收藏多批时默认显示本地总览好像丢失了
```

### R007

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-146b07de-658b-48b7-957b-b6de8f6a4eb4.png`

截图目标：右侧“整理收藏”面板上方已保存收藏夹区域与“改动记录”菜单；截图中点击“恢复初始改动”后，上方收藏夹仍全部显示为已勾选。该截图作为“恢复本轮起点勾选状态”的界面验收证据，当前待修复。

```text
除此之外让修复的bug仍然未完成，我恢复初始改动应该没有勾选任何收藏夹才对
```

### R008

```text
先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003、R004 | 查明：当已勾选收藏夹产生实际自动分类移动后，取消该收藏夹参与本轮时，改动记录为何显示“未产生分类移动”；区分界面投影中可见的其他现有目标/暂存回退，与分类 journal 是否真实重算和记录来源→去向；保留“新增收藏夹规则会重新自动分类”的既有效果，并明确取消后若存在新的已勾选且符合规则时应如何更新和记录。 | 整理收藏 → 归档预览 → 改动记录；`favorite-rules`历史条目、规则参与状态、分类投影。 | 只讨论已勾选规则取消后；不把无真实分类变化伪造为有移动，也不误删现有投影回退效果。 | 当前勾选/取消联动正常；本项只检验取消后的分类投影与历史说明是否一致。 | 仅本地工作区、规则参与和历史；不得在讨论/后续修复中创建、绑定、删除 B 站收藏夹或写入视频。 | 不修改正常上下联动、备册、删除模式、同步、DeepSeek、无关 UI；不以文案掩盖分类投影错误。 | 项目书 §5.5、§5.6；取消/重分类事务、历史 journal、归档预览投影。 | 已实施；自动化验收通过，真实草稿仅只读验收 | 见“实施与验收证据（2026-08-28）”。 |
| I002 | R005、R007 | 恢复“初始改动”时，上方已保存收藏夹规则、其勾选/参与状态以及下方推荐采用状态必须回到同一历史位置；本轮起点若没有勾选，恢复后上方必须全部未勾选；若规则是在初始快照之后新建，恢复后应从上方收藏夹区域移除（本地规则恢复到初始快照），但不删除 B 站远端收藏夹；取消勾选本身仍只取消参与，不删除规则。 | 整理收藏 → 改动记录 → 恢复初始改动；本轮初始快照、上方已保存收藏夹目录、下方推荐候选采用状态、`favoriteRuleState.before/after`。 | 仅历史恢复到初始改动/历史游标时；恢复直接读取本轮起始快照，而不是从后续第一条历史记录反推；上方新建规则应隐藏，原有规则保留并恢复对应勾选；远端观察到的未绑定/未保存草稿不属于本地规则撤销目标。 | 恢复必须一次性回写本地规则目录、账号级勾选、本轮排除集合和推荐采用状态，并重新投影预览；普通取消勾选继续保留规则；恢复前的乐观渲染状态不得覆盖权威起点。 | 只恢复本地规则和整理轮状态；不得因恢复删除、解绑或修改 B 站收藏夹、分册、视频归属，也不得把远端草稿误删。 | 不修改正常上下联动、取消勾选语义、备册/删除模式、同步、DeepSeek。 | `moveHistoryCursor()`、本轮起始快照、`favoriteRuleHistoryStateAtCursor()`、`restoreFavoriteLedgerHistoryState()`、上方收藏夹目录水合与推荐投影。 | 已实施；自动化验收通过，真实草稿待只读验收 | 见“实施与验收证据（2026-08-28）”。 |
| I003 | R006 | 查明并恢复：整理收藏为多批时，进入归档预览、切换到预览步骤或恢复草稿后的默认视图应为“本轮总览 / 本地总览”，不能无故回到“当前批次”；单批仍沿用其既定本轮三选一视图。 | 整理收藏 → 归档预览，`OldFavoriteGuide`受控`viewScope`初始化及多批工作区/恢复草稿快照。 | `hasMultipleSegments === true` 且存在可显示的本轮总览时默认总览；单批、总览尚不可用或用户本轮明确切换到当前批次的情形保持现有设计。 | 初次进入、恢复草稿和批次数由单批变多批时正确选择默认范围；不得在用户明确切换后每次刷新强制抢回总览。 | 仅本地 UI 范围选择；不触发重分类、B 站扫描、创建、绑定、删除或视频写入。 | 不改变多批当前批次隐藏 B 站来源区域、单批本轮三选一、归档统计和其它整理流程。 | 项目书 §5.4；`viewScope`状态、workspace快照`hasMultipleSegments`与`overview.available`。 | 已实施；自动化验收通过，真实草稿仅只读验收 | 见“实施与验收证据”。 |

## 讨论证据（2026-08-27）

1. 勾选推荐项走 `setRecommendedCandidates()` → `applyRecommendedLedgerDeltaUnsafe()`；后者对受影响 AID 执行分类并把 `changes` 写入分类 journal。因此截图中的“勾选「原神」后，自动分类 437 条”有真实、可恢复的移动记录。
2. 从上方收藏夹区域取消勾选走 `setRoundExcludedLedgerIds()`。该事务只写入 `excludedLedgerIds`，分类和历史数组均为空；其后仅写入收藏夹规则启用偏好。分类 journal 没有任何 `changes`。
3. 归档预览再从既有 `classification.targetLedgerIds` 过滤排除的规则；失去所有目标的视频只在投影中计入未匹配/`bilimi·暂存`，不会写回分类 journal。因此现有“未产生分类移动”是当前持久化历史的真实描述，却不能解释用户看到的归档去向变化。
4. 项目书 §5.5 要求勾选状态投影和分类重排通过主进程异步队列完成，§5.6 又写“本轮勾选/全选只改变同步投影，不得作为重分类触发器”。当前实现遵循后者；后续开始前必须先统一为一条明确规则。

## 已确认并实施的修复语义

- 推荐：上方已保存规则的勾选和取消均只对该规则新旧精确命中的 AID 走主进程有界异步局部重分类；取消后实际改到更匹配的其他规则或`bilimi·暂存`，并与规则参与状态合并为一个可恢复历史条目。
- 历史文案使用真实最终差异，例如`取消「原神」后，自动分类 437 条：bilimi·原神 → bilimi·游戏专区；… → bilimi·暂存`；只有重算后确实没有 AID 目标变化时才保留“未产生分类移动”。
- 不在渲染器同步全量遍历；不创建、绑定、删除 B 站收藏夹，不写入视频；不改变现有上下联动、备册、删除模式、同步或 DeepSeek 流程。

## 实施与验收证据（2026-08-27）

### I001 — 上方参与状态产生真实分类迁移

- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:3482-3525`将最终参与的已保存规则传入有界主进程分类队列；`:4213-4283`保持未传参与集时的既有分类器调用形态；`electron/main/index.ts:2360-2377`只在本轮参与集存在时投影已保存规则的`enabled`。`favorite-rules`状态变化与分类迁移使用同一历史位置发布。
- 自动化：`oldFavoriteWorkspaceCoordinator.test.ts:5770`覆盖取消较高优先级规则后实际迁移到另一个仍参与的规则，并写入来源→去向；完整协调器套件 343/343 通过。全量 `npm test` 为 240 文件、4113 用例通过；`npm run build` 通过。
- Electron：已只读启动开发版；不点击收藏夹勾选，避免改动用户当前未完成草稿。历史菜单证据见`.codex-artifacts/2026-08-27-favorite-history-readonly-menu.png`，其中展示实际“勾选/取消「honker233」后，自动分类 24 条…”的迁移条目。
- 边界：本次没有创建、绑定、删除 B 站收藏夹，也没有写入视频；真实账号的取消勾选重分类留待用户愿意操作草稿时验收。

### I002 — 历史恢复回放权威规则目录

- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:194-230,5436-5449,7710-7721`将可无损合并的旧中间历史投影为最终游标，并将选中的隐藏游标解析为最终一致状态；`ControlledFavoriteLedgerPanel.tsx:340-368`在历史游标变化且没有在途保存时清除无权威依据的渲染器推荐草稿。
- 自动化：`oldFavoriteWorkspaceCoordinator.test.ts:5896`断言采用→排除→`enabled=false`的连续旧检查点只暴露完整终点；`ControlledFavoriteLedgerPanel.test.tsx:4139`断言恢复无该规则的目录后上方不残留本地草稿。相关四套渲染器/接线回归 213/213 通过；全量与构建结果同 I001。
- Electron：历史菜单截图同上；为不改变用户正在使用的草稿，没有点击历史条目。完整的上方勾选、下方采用、排除集、规则目录和分类投影组合由上述主进程恢复测试覆盖。
- 边界：只恢复本地规则与工作区状态；没有远端创建、绑定、删除或视频写入。

### I003 — 仅实际多批时默认本轮总览

- 代码：`OldFavoriteGuide.tsx:198-207`不让单批快照消费多批初始化标记，工作区首次实际成为多批才切到`all`。
- 自动化：`OldFavoriteGuide.test.tsx:185`覆盖同一工作区从单批扩展为多批时切到本轮总览，同时保留用户主动切换后的范围；相关 16/16 用例和全量 `npm test` 通过。
- Electron：当前本地存在未完成整理草稿，打开“整理收藏”后只显示恢复/重新扫描/放弃选项；为不写入或改变该草稿，未点击恢复，故未进行真实多批切换截图验收。
- 边界：该改动仅为本地观察范围初始化；没有触发扫描、重分类、B 站创建、绑定、删除或视频写入。

## 实施与验收证据（2026-08-28）

### I001 — 参与规则集合变更必须重分类

- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts` 以持久化的`participatingSavedLedgerIds`比较本轮实际参与规则 ID 集合，不再只比较排除数组；全轮分类改为使用完整`segmentDescriptors`。上方已保存规则重新勾选时，`ControlledFavoriteLedgerPanel.tsx`将本次确定的稳定参与 ID 集合随同同一工作区命令传给`oldFavoriteWorkspaceCoordinatorIpc.ts`，不等待账号级`enabled`偏好异步写入。`electron/main/oldFavoriteWorkspaceStore.ts`随 overlay 保存并恢复该集合。
- 自动化：新增`oldFavoriteWorkspaceCoordinator.test.ts`用例`reclassifies when the participating rule set changes while exclusions stay empty`、`reclassifies an explicit upper-card re-enable before the enabled preference write completes`；均先 RED 后通过。IPC 与面板回归覆盖稳定 ID 集合的规范化、透传与上方已保存规则重新勾选。聚焦六组回归共 646 项通过；完整协调器 350/350 通过；`npm run build`通过。
- Electron：本轮未对用户当前草稿点击勾选或取消勾选，避免改动本地数据；因此未产生新的只读截图。真实账号的勾选→归档预览/同步预检刷新仍待用户操作时验收。
- 边界：未创建、绑定、删除 B 站收藏夹，未写入视频；未改 DeepSeek、删除确认、备册或视频同步流程。

### I002 — 恢复初始改动回到本轮起点状态

- 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts`在可预览工作区建立时捕获本轮起始规则目录、勾选状态、推荐采用状态和参与 ID 集合；恢复到初始分类基线时优先使用该快照，并将该快照的参与集显式传给同一次主进程重分类。`electron/main/oldFavoriteWorkspaceStore.ts`把快照以追加式 overlay 持久化、重启恢复并保留于压缩日志。
- 自动化：新增`oldFavoriteWorkspaceCoordinator.test.ts`用例`restores the persisted round-start checkbox state instead of a later history before-state`、`reclassifies a restored baseline with that baseline participation set`；均先 RED 后通过，分别断言起始`enabled: false`不会被后续历史的`before`状态覆盖、恢复不能受偏好写入时序影响。聚焦六组回归共 646 项通过；`npm run build`通过。
- Electron：未点击“恢复初始改动”，以免更改用户当前草稿；该真实界面动作和截图仍待只读/用户授权验收。
- 边界：恢复只回写本地规则与本轮投影；不创建、绑定、删除 B 站收藏夹，不写入或移动视频。

## 提交前验证（2026-08-28）

- 已完成的聚焦回归：`oldFavoriteWorkspaceCoordinator.test.ts`、`oldFavoriteWorkspaceStore.test.ts`、`oldFavoriteWorkspaceCoordinatorIpc.test.ts`、`ControlledFavoriteLedgerPanel.test.tsx`、`useOldFavoriteWorkspace.test.tsx`、`OldFavoriteGuide.test.tsx`共 `646` 项通过；其中新增回归覆盖起始未勾选规则不会被隐式重新纳入、上方重新勾选不会等待偏好写入、恢复后按本轮起点参与集重分类，以及恢复后的参与集合重启后仍保持。
- 全量自动化：`npm test -- --reporter=dot`重新运行，`240`个测试文件、`4123`个用例全部通过；此前偶发的`App.test.tsx`历史绑定保护断言本次未复现，未为它修改绑定功能。
- 构建：本轮代码补强后重新运行`npm run build`，通过。
- Electron 只读验收：当前多批工作区显示“本轮总览”，可见上方已保存规则和下方推荐候选；仅进行只读查看与滚动，未点击勾选、取消、恢复、备册、绑定、删除或同步。截图：`.codex-artifacts/2026-08-28-favorite-round-readonly.png`、`.codex-artifacts/2026-08-28-favorite-round-readonly-scroll.png`。
- 差异检查：`git diff --check`通过；本轮未执行任何 B 站创建、绑定、删除、移动或视频写入。
