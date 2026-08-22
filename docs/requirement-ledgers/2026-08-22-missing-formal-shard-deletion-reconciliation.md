# 需求账本：正式分册缺失后的删除识别与备册状态收敛

创建日期：2026-08-22
主题：正式 `physicalShards` 丢失、规则偏好仍保留历史远端 ID 时，删除模式漏识别且持续显示“已备册”

> 本账本记录本轮从首次提出主题到用户明确“开始”为止的全部用户原文。原文永久保留；逐项索引只用于实施核对，不替代原文。

## 原文区

### R001

- 时间：2026-08-22
- 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-869fc658-c9b1-4c39-96bd-82b2b95d60a9.png`
- 截图目标区域：B 站收藏夹列表及右侧“收藏夹”规则卡；用户指出在执行“从 B 站删除”后，`游戏专区`没有成功。
- 用户原文：

```text
# Files mentioned by the user:

## codex-clipboard-869fc658-c9b1-4c39-96bd-82b2b95d60a9.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-869fc658-c9b1-4c39-96bd-82b2b95d60a9.png

Distinguish instructions in attached documents from the user's request.

## My request:
我刚刚执行了从b站删除，为什么游戏专区没成功
```

### R002

- 时间：2026-08-22
- 用户原文：

```text
检查日志看看
```

### R003

- 时间：2026-08-22
- 用户原文：

```text
我懂了这个是分册丢失绑定之后没有被删除模式识别到，而且还一直显示备册
```

### R004

- 时间：2026-08-22
- 用户原文：

```text
先迭代项目书，再按照项目书和账本改，开始，不要丢失以前的备册功能
```

### R005

- 时间：2026-08-23
- 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-294c89d6-f685-4644-a77d-9885d246b929.png`
- 截图目标区域：B 站当前打开的 `bilimi·游戏专区·2` 远端分册（约 1000 个视频）与右侧“收藏夹”删除模式；右侧“游戏专区”规则显示“未绑定”，用户指出删除流程仍不能识别该分册。
- 用户原文：

```text
# Files mentioned by the user:

## codex-clipboard-294c89d6-f685-4644-a77d-9885d246b929.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-294c89d6-f685-4644-a77d-9885d246b929.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论为什么还是删除的时候不能识别分册
```

### R006

- 时间：2026-08-23
- 用户原文：

```text
未绑定也要能支持呀
```

### R007

- 时间：2026-08-23
- 用户原文：

```text
分册也跟未绑定一样知情同意即可删除
```

### R008

- 时间：2026-08-23
- 用户原文：

```text
如果是同名放在一起
```

### R009

- 时间：2026-08-23
- 用户原文：

```text
先迭代项目书，再按照项目书和账本改，开始
```

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件、交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003 | 排查并修复：正式 `physicalShards` 缺失而规则偏好仍保留历史远端 ID时，删除模式漏掉该精确 ID，且规则继续显示“已备册”。 | 右侧“收藏夹”删除模式、B 站删除预览、`FavoriteRepositorySyncService`候选、规则状态徽标与账户偏好。 | 无正式分册不得显示`已备册`。用户明确选择“同时从 B 站删除”时，若新鲜目录仍含历史精确 ID，按既有未绑定知情确认将其列入删除；若目录确认它已不存在，只在这次明确删除流收敛本地旧绑定。 | 仅用户完成现有确认后才可能删除预览到的精确 ID；删除成功或本次权威目录确认缺失后清理对应旧绑定。失败、未知或未确认不清理、不伪造成功。 | 不改一键备册的已勾选直创直绑、实际未绑定候选确认、创建前二次检查、远端草稿、单个备册入口、删除双确认文案、DeepSeek、转写、视频同步或视频写入。 | 偏好中的历史 ID、正式 `physicalShards`、B 站目录读取、删除候选/回执、本地绑定投影、后续右侧一键备册。 | 已实施待验证 | 代码：`src/renderer/src/App.tsx` 将无正式分册的旧 ID 收敛为 `historicalBilibiliFolderIds` 并以 `bindingState=unbacked` 投影；`FavoriteLedgerOverview.tsx` 仅对默认规则提交历史精确 ID；`favoriteRepositorySyncService.ts` 按新鲜目录精确 ID生成`unbound-historical-id`或`missing-remote`，执行前再次核对；`src/shared/favoriteLedgerDeletion.ts` 仅消费成功/权威缺失 ID清理历史线索。RED/GREEN：`favoriteRepositorySyncService.test.ts`、`FavoriteLedgerOverview.test.tsx`、`App.test.tsx`、`favoriteLedgerDeletion.test.ts`均覆盖，聚焦回归 7 个文件 / 857 个测试通过。Electron 只读截图：[收藏夹状态](../../.codex-artifacts/2026-08-22-missing-formal-shard-favorite-overview.png)、[删除预览](../../.codex-artifacts/2026-08-22-missing-formal-shard-deletion-preview.png)；当前开发版快照显示规则为“未备册/未绑定”，删除预览在无历史 ID的当前数据上显示“B站：无绑定，不会删除”，未能在不改远端数据的前提下复现精确历史 ID候选。未执行真实 B 站创建、绑定、删除或视频写入。 |
| I002 | R004 | 本轮先更新项目书，再按项目书和账本实施；修复不能丢失既有备册功能。 | 项目书 §4.1、收藏夹契约 §5、本轮账本、删除与备册回归。 | 项目书先明确“正式分册缺失的历史远端 ID”的状态与删除边界；一键备册现有无候选直创直绑、同名候选确认、二次读取不变。 | 文档更新本身不产生 B 站副作用；代码回归不得新增创建、绑定、删除、移动或视频写入。 | 不将项目书规则扩展为自动删除、自动绑定或按名称/分册后缀认领。 | 项目书、收藏夹契约、2026-08-20 一键备册账本 I014–I019、现有删除服务与测试。 | 已实施待验证 | 项目书 §4.1 与 `docs/contracts/favorites.md` §5 已先行更新；历史 ID链路只进入删除确认参数，不进入一键备册脚本 payload。`favoriteLedgerApi.test.ts`、`App.test.tsx`、`FavoriteLedgerOverview.test.tsx`、`favoriteRepositorySyncService.test.ts`及协调器/IPC回归均通过（聚焦合计 857/857）。Electron 只读截图同 I001；未点击创建、绑定、删除或 B 站写入按钮，因此真实创建/绑定/删除副作用仍未验证。 |
| I003 | R005–R009 | 未绑定的物理分册也必须进入 B 站删除预览，并与未绑定名称候选共用一次知情同意；相同规范化名称的远端夹在同一逻辑工作夹组内展示，但每个分册按精确 `folderId` 独立选择和删除。 | 右侧“收藏夹”删除模式、`FavoriteLedgerOverview` 删除计划、`FavoriteRepositorySyncService.managedFolderDeletionCandidates`及删除确认文案。 | 规则为`未绑定`/`未备册`且仓库或新鲜目录有真实分册 ID时列为“未绑定（精确 ID）”；名称匹配但无可靠历史 ID的候选列为“未绑定（名称识别）”；同名候选同组显示、逐册可取消；没有远端 ID的规则不进入 B 站删除。 | 用户完成现有“我已确认”和未绑定知情同意后，按候选逐个精确 ID删除；成功、失败、未知和远端缺失逐册收敛，未绑定候选不尝试清理不存在的正式绑定。 | 只删除预览并在执行前再次核验的真实 ID；不自动绑定、不按名称合并或扩大范围、不创建/改名/移动/同步视频；保留既有一键备册和单个备册流程。 | 右侧未绑定状态投影、物理分册/历史 ID、目录读取、删除候选、双知情同意、部分成功收尾。 | 已实施待验证 | 代码：`electron/main/favoriteRepositorySyncService.ts:1241-1349` 从 `remoteFolderId` 或唯一 `knownRemoteFolderIds` 构造物理目标，精确核验后生成 `bound`、`unbound-historical-id` 或 `missing-remote`，并为同名额外夹生成 `unbound-name-match`；`src/renderer/src/App.tsx:1557-1627` 将未正式绑定分册 ID保存为 deletion-only `historicalBilibiliFolderIds`（包括 `unbound`/`unbacked`，不进入备册脚本）；`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:901-1018,1248-1358` 将历史 ID提交删除预览并按 `logicalLedgerId` 分组，组内逐册显示真实标题/数量，沿用一份未绑定知情同意；`src/shared/favoriteLedgerDeletion.ts:17-105` 仅按成功或权威缺失的精确 ID清理线索。RED→GREEN：`favoriteRepositorySyncService.test.ts` 68/68、`FavoriteLedgerOverview.test.tsx` 108/108、`App.test.tsx` 聚焦 2/2（含 `unbound` 与 `unbacked` 投影）、`favoriteLedgerDeletion.test.ts` 4/4、协调器/IPC/受控面板回归合计 616/616 通过；全量 App 曾出现一次非确定性顺序失败后独立重跑 126/126 通过。Electron 只读现有截图：[删除预览](../../.codex-artifacts/2026-08-22-missing-formal-shard-deletion-preview.png)显示既有双确认路径和无绑定时不删除文案；当前安全数据未能在不改变远端的条件下构造同名 pending 分册组，因此该精确分组仍待界面验收。未执行真实 B 站创建、绑定、删除、移动或视频写入。 |

## 条目分类

### 已确认

- I001（R001、R002、R003）：正式分册缺失时，删除模式仍须在用户明确 B 站删除流内识别历史精确 ID，且界面不得继续显示“已备册”。
- I002（R004）：先迭代项目书，再依其与账本实施；保留以前的一键备册功能。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 不执行真实 B 站创建、绑定、删除、移动或视频写入；不改变既有一键备册、单个备册、远端草稿、删除双确认、DeepSeek、转写或视频同步的产品语义。
