# 2026-09-14 扫描本地暂存误投影为正式暂存：需求账本

> 主题：核验扫描期间左侧正式 `bilimi·暂存`为什么仍显示扫描数据，并区分后台 `local:inbox` 与真实 `bilimi-logical:inbox`。
>
> R003 已授权实施。本账本保留讨论阶段原始约束；实现、验证和界面验收证据以逐项索引表为准。

## 原文需求区（按对话顺序，永久保留）

### R001

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a7d1e4df-b990-41dd-acd8-d8f82a1b133e.png`

用户圈定/描述的目标区域：扫描进行时，收藏库左侧“bilimi 工作夹”中的`bilimi 暂存`显示 253；右侧扫描概览同时显示扫描总数 257、本轮待整理 253、已保护跳过 0、标签补取中。截图已读取。

用户消息原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-a7d1e4df-b990-41dd-acd8-d8f82a1b133e.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a7d1e4df-b990-41dd-acd8-d8f82a1b133e.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 扫描过程中，怎么bilimi暂存还有数据

### R002

截图文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c594478f-f926-459e-8051-4039c373c458.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5d4041ef-582a-41b9-a8fe-aa7e6a7b8492.png`

用户圈定/描述的目标区域：图一删除确认弹窗中勾选“仅从收藏库删除 bilimi 工作夹（保留右侧规则和 B 站收藏夹）”，对象为 `bilimi·创意美学`；图二删除完成后同一规则状态显示“未绑定”，其余规则仍显示“已备册”。截图已读取，待界面验收。

用户消息原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-c594478f-f926-459e-8051-4039c373c458.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c594478f-f926-459e-8051-4039c373c458.png
>
> ## codex-clipboard-5d4041ef-582a-41b9-a8fe-aa7e6a7b8492.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5d4041ef-582a-41b9-a8fe-aa7e6a7b8492.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 等会一起改，仅删除收藏库工作夹，为什么收藏夹会变成了未绑定，删除收藏库不影响收藏夹使用吧，为什么要变成未绑定

### R003

用户消息原文：

> 开始

## 逐项索引表

| 索引 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R003 | 修正扫描中`bilimi·暂存 253`的错误来源：`local:inbox`不得投影为正式`bilimi-logical:inbox`成员或计数。 | 收藏库摘要/左侧工作夹；`FavoriteRepositoryService.getLibrarySummary()`与按工作夹查询。 | 本地扫描安全暂存`local:inbox`不应显示、计数或查询为真实`bilimi-logical:inbox`；真实正式暂存只显示自身正式成员。 | 修复后仅调整读模型投影；扫描安全暂存、正式工作夹和保护集合仍分离。 | 不迁移、清空、同步或写入 B 站；不把本地暂存转入正式工作夹。 | 不改正式`bilimi-logical:inbox`真实成员、精确 ID绑定、扫描流程或保护的既有边界。 | 扫描位置投影、仓库摘要投影、工作夹页面查询、`localBilimiProtectionAids()`。 | 已实施，待人工界面验收 | 实际代码：`electron/main/favoriteRepositoryService.ts:637-651,2092-2110`移除`local:inbox`和`bilimi-logical:inbox`的合并计数/查询；`docs/项目功能项目书.md:237,517`写入正式与扫描暂存边界。自动化：先见 focused RED（正式暂存计数预期 1、实际 2），后`npm test -- electron/main/favoriteRepositoryService.test.ts` 106 项通过；边界回归合计 235 项通过；补跑`npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts` 392 项通过，恢复扫描和预览保护集继续仅取当前`bilimi-logical:*`成员；全量`npm test`成功；`npm run build`成功。窗口级：2026-09-14 Electron 开发版实际启动，界面现有 0 数正式`bilimi·暂存`未混入扫描数；生产预览也成功启动。未以真实扫描流程重放 253 项，仍待人工界面验收。 |
| I002 | R002, R003 | 修复选择“仅从收藏库删除 bilimi 工作夹（保留右侧规则和 B 站收藏夹）”后，`bilimi·创意美学`规则由“已备册”变为“未绑定”的错误；本地删除不得影响 B 站收藏夹的使用。 | 收藏库工作夹删除确认、右侧规则卡状态、逻辑工作夹/物理分片绑定。 | 仅本地删除后，左侧工作夹及其分类关系不再显示；右侧规则、B 站收藏夹和精确绑定仍可用，规则继续显示“已备册”，不显示“未绑定”。 | 实施时，本地删除只更新本地工作夹投影；不得触发解绑状态、重新绑定流程或 B 站目录读取。 | 不删除、不新建、不移动 B 站收藏夹或其成员；不清除已保存的绑定 ID。 | 不扩大到远端删除、重新绑定、同步或其他规则编辑。 | `delete-local-managed-folder(s)`命令、主进程删除服务、规则偏好持久化、右侧状态投影、左侧导航投影。 | 已实施，待人工界面验收 | 实际代码：`src/shared/favoriteRepository.ts:2637-2736`使无`confirmedRemoteFolderIds`的本地删除只删逻辑工作夹/本地归属，保留`physicalShards`和物理成员；有确认远端删除或删除正式 inbox 时保持原先清除正式分片的路径。`src/shared/favoriteLedgerBindingProjection.ts:9-78`由保留的 bound 分片继续投影规则 ID 91 为`bound`；`electron/main/favoriteRepositoryManagedFolderService.ts:203-239`本地路径没有调用远端写入器。`docs/项目功能项目书.md:237`同步该范围和 B 站边界。自动化：先见 focused RED（本地删除后分片丢失），后`npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteLedgerBindingProjection.test.ts` 86 项通过；服务回归明确断言注入的`removeRemoteFolder`为零调用；四组边界回归共 235 项、全量`npm test`及`npm run build`成功。窗口级删除确认未执行，避免改变用户本地/B 站数据，待人工验收右侧继续显示“已备册”。 |

## 条目分类

### 已确认

- I001（R001、R003）：`local:inbox`不得显示、计数或查询为正式`bilimi-logical:inbox`。
- I002（R002、R003）：仅从收藏库删除工作夹不应影响右侧规则、正式精确绑定或 B 站收藏夹使用；右侧必须继续显示“已备册”。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 在用户明确说“开始”前，不修改产品代码、应用数据、B 站数据或构建产物。
