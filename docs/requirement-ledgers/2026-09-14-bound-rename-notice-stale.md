# 2026-09-14 已绑定收藏夹改名后提示未即时收束：需求账本

> 用户已在 R002 明确说“开始”。以下计划只覆盖 I001；实现前已重新通读本账本全部原文区、逐项索引、当前工作树和相关运行时状态链路。

## 原文区（不可改写、合并、删除或重排）

### R001（2026-09-14）

附件截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-65a0743a-14ca-4498-a1fd-f19722aeede9.png`

截图目标区域：

- 已绑定 bilimi 收藏夹名称变更的处理弹窗，以及掌库右侧“检测到…已绑定收藏夹名称变更”提示；B 站左侧对应收藏夹已显示改名后的名称，但处理完成后旧提示仍存在，手动刷新后才消失。

用户原文：

```text
# Files mentioned by the user:

## codex-clipboard-65a0743a-14ca-4498-a1fd-f19722aeede9.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-65a0743a-14ca-4498-a1fd-f19722aeede9.png

Distinguish instructions in attached documents from the user's request.

## My request:
这个处理好之后，提示还在，需要刷新一下才消失
```

### R002（2026-09-14）

用户原文：

```text
开始
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R002 | 已绑定收藏夹名称变更处理成功后，处理弹窗与右侧“检测到…已绑定收藏夹名称变更”提示应立即按最新权威状态收束，不要求用户手动刷新。 | 掌库 `FavoriteLedgerOverview` 远端发现处理弹窗、外部发现提示；父层 `FavoriteLedgerStatus` 的已绑定改名候选投影。 | B 站改名实际成功且本地同步返回成功、最新候选为空时，关闭弹窗并隐藏右侧提示；远端状态仍有候选或请求失败时，保留最新候选/错误。 | 用户点击“开始处理”后，等待现有改名同步完成；成功结果必须使 renderer 使用最新观察结果，而不是沿用发起前的候选数组。 | 不新增 B 站写入、扫描或绑定；只消费已有同步操作已获得的权威返回/状态发布结果。 | 不以纯 renderer 乐观隐藏掩盖失败；不改变未绑定发现、草稿生成、备册续办和“暂不提醒”的语义。 | `onSyncLedgers`、主进程同步服务结果、`FavoriteLedgerStatus` 发布和 `FloatingAssistantApp` 属性投递。 | 已确认，待实施 | 截图表明远端名称已更新，但旧候选与外部提示仍显示；待完成代码链路和自动化/真实界面验收。 |

## 条目分类

### 已确认

- I001（R001, R002）：改名成功后，旧的弹窗与右侧名称变更提示无需刷新即消失。

### 待用户决定

- 无。

### 被后续明确替代

- 无。

### 明确不做

- 不新增一次 B 站扫描或写操作；不通过仅在 renderer 隐藏提示来掩盖状态未更新；不改变其它远端发现、备册或绑定流程。

## 实施前核对与计划（2026-09-14）

### 已确认（按原文顺序）

1. `R001 / I001`：已绑定收藏夹改名处理成功后，旧处理弹窗和右侧名称变更提示必须即时消失，不需要用户刷新。
2. `R002 / I001`：开始实施该修复。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 不改 B 站改名请求、绑定、备册、未绑定发现、草稿生成或“暂不提醒”。
- 不额外读取 B 站目录；不得只靠面板局部 state 隐藏提示。

### P001（R001–R002 / I001）：在改名成功时定向收束已解决候选的运行时投影

- **允许修改：** `src/renderer/src/App.tsx`、`src/renderer/src/App.test.tsx`、本需求账本。
- **数据与 UI 结果：** `renameBoundOnly` 的已确认改名成功后，运行时发现缓存仅移除本次成功逻辑收藏夹的 `boundRenameCandidates`；保留同一账户的 `remoteObservations` 与其它逻辑收藏夹的未处理候选。下一次既有快照通知读取此缓存时，`FavoriteLedgerOverview` 现有成功关闭逻辑不再被旧候选重新打开或显示右侧提示。
- **回归风险：** 不得将失败、回执未知、预检候选变化或未选择候选视为成功；不得清空其它逻辑收藏夹的候选；不得触发新 B 站目录读写。
- **测试与界面验收：** 先在 `App.test.tsx` 建立两个候选的运行时回归：手动发现缓存包含 game/music 两项，确认仅 game 改名成功后请求快照，预期 game 候选消失、music 候选保留；当前代码应 RED（game 仍在）。GREEN 后运行该测试、相关 `FavoriteLedgerOverview` 测试、完整 `npm test`、构建、开发版及预览版关键路径。真实 B 站改名将由用户在开发版验证，不执行真实账号操作。

## 实施与验收记录（2026-09-14）

### I001（R001, R002）

- **实际代码位置：** `src/renderer/src/App.tsx` 的 `removeResolvedBoundRenameCandidates`；只在 `renameBoundOnly` 的远端改名已成功、且 `savePreferences` 返回成功后调用。该函数按账号和本次 `directRename.renamedLedgerIds` 从 `favoriteLedgerDiscoveryCacheRef` 移除候选，并保留同账号其它候选及 `remoteObservations`。
- **根因核对：** `createAssistantSnapshot` 会以该运行时缓存覆盖最新 `FavoriteLedgerStatus` 的 `boundRenameCandidates`。原路径只清空 status/snapshot 缓存，未收束发现缓存，因而下一次快照会重新投递已处理候选。
- **自动化 RED/GREEN：** 在 `src/renderer/src/App.test.tsx` 新增 `removes only a successfully renamed candidate from the next assistant snapshot`。修改前，确认 game 改名后的快照仍含 game/music 候选（RED）；修改后，快照仅保留 music，仍保留远端观察，且没有执行收藏夹写入脚本（GREEN）。
- **已运行验证：** 新增回归测试通过；`npm test -- --run src/renderer/src/App.test.tsx`（197/197）、`npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`（164/164）、`npm test`（255 文件、4690 项）、`npm run build`、`npm run dev`、`npm run preview`均通过。测试输出含项目既有 React `act(...)` 警告及既有 coordinator 日志，无测试失败；构建仅有既有分块提示。
- **真实界面验收：** 待用户在开发版对真实 B 站账号执行一次“已绑定收藏夹改名 → 开始处理”验证：成功后弹窗关闭且右侧提示立刻消失；本轮未执行任何真实 B 站写入、扫描、绑定或删除操作。
- **结果：** 已实施待真实界面验收。
