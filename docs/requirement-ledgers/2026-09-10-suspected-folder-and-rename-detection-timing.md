# 疑似 Bilimi 收藏夹与已绑定收藏夹改名的发现时机

## 原文记录

### R001

时间：2026-09-10

截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-13a2009c-a6fe-4fa9-86e1-1f50b56d6ae8.png`

截图目标区域：B 站收藏夹列表中被红色箭头指向的 `bilimi·哈哈`；右侧 bilimi 工作夹的“未备册”状态。截图用于澄清“疑似 Bilimi 收藏夹”与“已绑定后 B 站收藏夹改名”分别在何时发现；不执行截图中的任何操作。

原文：

```text
什么时候发现疑似和b站改名收藏夹
```

### R002

时间：2026-09-10

原文：

```text
b站创建改名的时候不触发吗
```

### R003

时间：2026-09-10

原文：

```text
你卡了吗，我让你查现有功能，实际b站改名创建的时候触发  【发现疑似和b站改名收藏夹  】
```

### R004

时间：2026-09-10

原文：

```text
继续
```

### R005

时间：2026-09-10

原文：

```text
继续
```

### R006

时间：2026-09-11

原文：

```text
codex://threads/01a087a9-9c69-73c2-a450-c6119b37e406  你继续做这个对话最后的要求，实际b站改名创建的时候触发  【发现疑似和b站改名收藏夹  】
```

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | 说明“疑似 Bilimi 收藏夹”及“已绑定收藏夹需要改名”的发现时机与边界。 | B 站收藏夹目录读取、收藏库侧栏投影、备册确认流程。 | 已由 R002-R006 明确为：B 站手动创建或改名确认后，应触发已有发现提示。 | 仅解释现状，不触发交互。 | 不写入本地数据；不发起 B 站创建、绑定、改名、删除或同步。 | 不修改现有扫描、投影、备册或改名实现。 | 名称能力判定、整理收藏扫描、正式绑定的备册预检。 | 被 R002-R006 明确细化。 | 只读代码追踪：`src/shared/favoriteLedgerCapabilities.ts`、`electron/main/oldFavoriteWorkspaceScanService.ts`、`electron/main/oldFavoriteWorkspaceCoordinator.ts`、`src/renderer/src/features/favorites/favoriteLedgerApi.ts`、`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`。 |
| R002-R006 | B 站页面中手动成功创建或改名收藏夹时，实际触发右侧现有提示区的“疑似 bilimi 收藏夹”和“已绑定收藏夹名称变更”发现；目录刷新暂时 `pending` 后恢复 `idle` 也不能丢失该次发现。 | `BiliWebview` 成功 API 观察信号 → `App.tsx` 的账号目录刷新和助手快照 → `FavoriteLedgerOverview.tsx` 既有浅蓝提示区及“查看详情”。 | 仅限已确认、账号匹配的页面 `create`、`rename` 信号；创建/改名的目录刷新完成为 `idle` 后发布。`pending`、刷新报错、账号不匹配、删除及程序化备册创建仍不发布。 | 记录待完成的手动观察；若首轮刷新为 `pending`，监听既有刷新状态在同账号变为 `idle` 后重做一次只读发现，更新快照并通知提示区。 | 只读取 B 站目录和已绑定精确 ID；不保存本地草稿、不绑定、不创建、不改名、不删除、不同步 B 站收藏夹。 | 不改收藏库投影、备册确认链、程序化创建抑制、删除延迟刷新或提示区的既有“查看详情”交互。 | `BilibiliFavoriteSpaceRefreshCoordinator` 状态回调、预加载 IPC、`App.tsx` 观察读取、`FavoriteLedgerOverview` 既有摘要。 | 已实施待真实界面验收。 | 根因：原 `App.tsx:1324-1329` 在 `retryBilibiliFavoriteSpaceRefresh` 返回 `pending` 时直接返回；主进程协调器会通过 `bilibili-favorite-space-refresh:status-changed` 发布后续 `idle`，但 App 未订阅它。实施：`App.tsx:834` 以账号缓存待完成手动观察；`:1292-1328` 提取只读发现/快照发布；`:1364-1382` 在手动 create/rename 初次 `pending` 时登记，订阅同账号 `idle` 后只读续跑。自动化：新增 `App.test.tsx:3478`，参数化覆盖 create、rename；初始 RED（未注册状态监听器），GREEN：`npm test -- src/renderer/src/App.test.tsx --reporter=dot` 为 182/182；关联 `App`、`BiliWebview`、`FavoriteLedgerOverview` 回归为 364/364；`npm run build` exit 0；`git diff --check` exit 0。测试验证状态快照含远端疑似项，且未调用收藏夹写入脚本。真实 Electron：尚未手动在 B 站成功新建和改名后观察右侧浅蓝提示区；本轮不执行该远端写入，待用户手动验证。 |

## 实施计划（2026-09-11）

已确认条目：

1. R002-R006：手动 B 站创建、改名在目录最终可读取后，刷新右侧“疑似 / 改名”检测提示；不得丢失 `pending → idle` 的同一次观察。

待用户决定：无。

被明确替代：R001 的“仅说明现状”被 R002-R006 明确细化为实现需求；R001 原文保留。

明确不做：不执行真实 B 站创建、改名、绑定、删除或同步；不自动弹出详情、不自动创建草稿、不改收藏库投影或备册/删除保护流程。

1. 覆盖 R002-R006；允许修改 `src/renderer/src/App.tsx`、`src/renderer/src/App.test.tsx` 和本账本。先为“手动 create/rename 初始刷新 pending、同账号后续 idle”写回归测试，期望现状失败；风险是状态事件与账号切换竞态，测试将验证仅同账号、仅仍待处理的手动观察可触发。
2. 在 App 中以账号为键暂存待完成的手动 create/rename 观察，订阅既有刷新状态 IPC；状态变为 idle 后复用同一只读目录 / 已绑定精确 ID 发现并通知助手快照。预期 UI 仍是既有浅蓝摘要及“查看详情”；自动化测试验证没有 B 站写脚本，界面验收验证实际手动创建和改名后提示出现。
3. 运行 App 定向测试、相关浏览器观察回归、构建和 `git diff --check`；逐项将命令输出、代码位置与真实 Electron 尚待条件登记本账本。只在没有混入无关文件时创建本地提交。

## 实施后逐项复核（2026-09-11）

| 原文编号 | 代码位置 | 自动化验证 | 真实界面验收 | 结果 / 未验证条件 |
| --- | --- | --- | --- | --- |
| R002-R006 | `src/renderer/src/App.tsx:834,1292-1382`；现有提示区未改，仍为 `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1879-1885`。 | 先 RED：新增测试因 App 未注册刷新状态监听器失败；后 GREEN：`npm test -- src/renderer/src/App.test.tsx --reporter=dot` 182/182，`npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/browser/BiliWebview.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot` 364/364，`npm run build` exit 0，`git diff --check` exit 0。 | 尚未执行：应由用户在开发版 B 站收藏夹页手动成功新建一个 `bilimi·…` 收藏夹、再手动改名一个已绑定收藏夹，确认右侧浅蓝区出现“检测到 N 个疑似 bilimi 收藏夹、M 个已绑定收藏夹名称变更。”及“查看详情”；不点击会写 B 站的确认操作。 | 已实施，真实 B 站界面待验收；不能据自动化宣称已完成真实远端验证。 |
