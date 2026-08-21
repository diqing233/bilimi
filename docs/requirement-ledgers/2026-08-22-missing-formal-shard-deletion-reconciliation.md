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

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件、交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R002、R003 | 排查并修复：正式 `physicalShards` 缺失而规则偏好仍保留历史远端 ID时，删除模式漏掉该精确 ID，且规则继续显示“已备册”。 | 右侧“收藏夹”删除模式、B 站删除预览、`FavoriteRepositorySyncService`候选、规则状态徽标与账户偏好。 | 无正式分册不得显示`已备册`。用户明确选择“同时从 B 站删除”时，若新鲜目录仍含历史精确 ID，按既有未绑定知情确认将其列入删除；若目录确认它已不存在，只在这次明确删除流收敛本地旧绑定。 | 仅用户完成现有确认后才可能删除预览到的精确 ID；删除成功或本次权威目录确认缺失后清理对应旧绑定。失败、未知或未确认不清理、不伪造成功。 | 不改一键备册的已勾选直创直绑、实际未绑定候选确认、创建前二次检查、远端草稿、单个备册入口、删除双确认文案、DeepSeek、转写、视频同步或视频写入。 | 偏好中的历史 ID、正式 `physicalShards`、B 站目录读取、删除候选/回执、本地绑定投影、后续右侧一键备册。 | 已实施待验证 | 代码：`src/renderer/src/App.tsx` 将无正式分册的旧 ID 收敛为 `historicalBilibiliFolderIds` 并以 `bindingState=unbacked` 投影；`FavoriteLedgerOverview.tsx` 仅对默认规则提交历史精确 ID；`favoriteRepositorySyncService.ts` 按新鲜目录精确 ID生成`unbound-historical-id`或`missing-remote`，执行前再次核对；`src/shared/favoriteLedgerDeletion.ts` 仅消费成功/权威缺失 ID清理历史线索。RED/GREEN：`favoriteRepositorySyncService.test.ts`、`FavoriteLedgerOverview.test.tsx`、`App.test.tsx`、`favoriteLedgerDeletion.test.ts`均覆盖，聚焦回归 7 个文件 / 857 个测试通过。Electron 只读截图：[收藏夹状态](../../.codex-artifacts/2026-08-22-missing-formal-shard-favorite-overview.png)、[删除预览](../../.codex-artifacts/2026-08-22-missing-formal-shard-deletion-preview.png)；当前开发版快照显示规则为“未备册/未绑定”，删除预览在无历史 ID的当前数据上显示“B站：无绑定，不会删除”，未能在不改远端数据的前提下复现精确历史 ID候选。未执行真实 B 站创建、绑定、删除或视频写入。 |
| I002 | R004 | 本轮先更新项目书，再按项目书和账本实施；修复不能丢失既有备册功能。 | 项目书 §4.1、收藏夹契约 §5、本轮账本、删除与备册回归。 | 项目书先明确“正式分册缺失的历史远端 ID”的状态与删除边界；一键备册现有无候选直创直绑、同名候选确认、二次读取不变。 | 文档更新本身不产生 B 站副作用；代码回归不得新增创建、绑定、删除、移动或视频写入。 | 不将项目书规则扩展为自动删除、自动绑定或按名称/分册后缀认领。 | 项目书、收藏夹契约、2026-08-20 一键备册账本 I014–I019、现有删除服务与测试。 | 已实施待验证 | 项目书 §4.1 与 `docs/contracts/favorites.md` §5 已先行更新；历史 ID链路只进入删除确认参数，不进入一键备册脚本 payload。`favoriteLedgerApi.test.ts`、`App.test.tsx`、`FavoriteLedgerOverview.test.tsx`、`favoriteRepositorySyncService.test.ts`及协调器/IPC回归均通过（聚焦合计 857/857）。Electron 只读截图同 I001；未点击创建、绑定、删除或 B 站写入按钮，因此真实创建/绑定/删除副作用仍未验证。 |

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
