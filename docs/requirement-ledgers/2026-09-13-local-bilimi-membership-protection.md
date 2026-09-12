# 需求账本：仅本地 bilimi 收藏夹成员触发保护跳过

## 原文区

### R001

```text
# Files mentioned by the user:

## codex-clipboard-5de0401e-edfe-43c2-9a91-29907c9d762f.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5de0401e-edfe-43c2-9a91-29907c9d762f.png

Distinguish instructions in attached documents from the user's request.

## My request:
为什么还是保护跳过了，你把收藏库的其他收藏夹也算上了吗，应该是收藏库bilimi收藏夹有才要加保护
```

截图目标区域：收藏库右侧“扫描概览”显示“扫描总数 257”“已保护跳过 246”，并显示各来源收藏夹及其待整理数；用户质疑保护是否把其他收藏夹也算入，并明确要求只有收藏库的 bilimi 收藏夹中存在视频时才加保护。截图路径为 `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5de0401e-edfe-43c2-9a91-29907c9d762f.png`；截图用于规则和界面验收，不能替代真实数据核对。

### R002

```text
两个都要调整，这次应该没问题吧
```

截图目标区域：无新增截图；用户确认保护规则与备册速度都需要调整，并询问可靠性。该消息未出现“开始”，因此本主题仍处于讨论确认阶段，不修改功能代码。

### R003

```text
开始
```

截图目标区域：无新增截图；明确授权按本账本 R001-R002 与关联的备册速度账本已确认范围实施并本地提交。

## 逐项索引

| 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | 只有视频实际属于本地收藏库 `bilimi-logical:*` 收藏夹时，才计为“已保护跳过”；不得将其他本地收藏夹、收件箱、历史整理记录、远端工作夹成员或普通 B 站收藏夹成员算入保护 | 增量扫描初始化、分页扫描、完成扫描、扫描恢复、扫描概览/来源收藏夹统计中的保护集合 | 视频位于任意 `bilimi-logical:*` 实际成员关系时显示/计数保护；否则进入待扫描/待整理范围 | 扫描中断重启后重建相同的本地保护集合；统计与实际扫描使用同一规则 | 不删除任何既有 `organizationRecords`，不改 B 站收藏夹、视频成员或远端同步；历史记录不再参与当前扫描保护资格 | 不将 `local:*`、`local:inbox`、`bilibili:*`、`organizationRecords` 或远端观察成员当作保护；不改变已整理视频本地资料、正常同步、删除或绑定功能 | 收藏仓库快照的 `folders`、`memberships`；流式扫描、恢复流程、库存统计 | 已确认，方案待用户以“开始”授权实施 | 根因已定位：`oldFavoriteWorkspaceCoordinator.ts:1967,2075,3201,7821` 仅用 `organizationRecords` 建立保护；`6400-6418` 在恢复时还把 `readManagedMemberAids` 的远端成员并入保护。因此旧修复“远端成员不能单独保护”没有覆盖成员关系残留与恢复路径。 |
| R002 | 与备册速度并行实施，但分别验证；不能以“应当没问题”取代回归证据 | 本账本与 `2026-09-13-backup-speed-diagnostics.md` | 保护规则正确且备册主路径提速后才可声称完成 | 两项独立提交同一轮变更前需分项验收 | 不产生额外 B 站副作用 | 未获“开始”前不修改功能代码 | R001；备册账本 R005-R006 | 已确认，待用户以“开始”授权实施 | 两项触碰的模块不同；共同依赖只读仓库快照。计划测试覆盖：历史记录仅、普通本地夹、收件箱、远端成员、实际 bilimi 成员、扫描恢复，以及正常/创建/重绑备册分支。 |
| R003 | 授权实施 R001-R002 与关联备册速度账本的已确认范围 | 保护集合、扫描恢复/统计、测试和账本 | 仅实际本地 `bilimi-logical:*` 成员保护 | 统一运行时和统计的保护集合 | 无 B 站写入或历史记录删除 | 不实施被替代的 `organizationRecords` 或远端成员规则 | R001-R002、备册账本 R005-R006 | 实施中 | 已在实施前重新通读两份账本的完整原文区和逐项索引；实施计划将限定上述文件模块和测试。 |

## 讨论诊断结论（只读）

1. 截图的 246 条“已保护跳过”并非代码直接遍历所有 B 站普通收藏夹来保护；普通 B 站来源用于扫描范围。
2. 当前保护集合却只按 `organizationRecords.aid` 建立，未校验视频仍是否实际在本地 `bilimi-logical:*` 收藏夹。这会把普通本地夹、旧记录或成员已移除的历史记录误计为保护。
3. 扫描恢复另行把远端已管理工作夹成员合并到保护集合，绕开本地限定，故会在重启/恢复场景再次误跳过。
4. 最小而完整的修正是集中建立“本地 bilimi 保护 aid 集”：仅收集所有 `bilimi-logical:*` 实际成员；开始、分页、完成、恢复和统计全部调用同一个来源。远端成员读取仍保留给绑定/观察，但绝不可进入保护集合。

## 实施核对追加

本节追加不修改上方原文区及其既有索引记录；按 R 编号补充实际实现、自动化验证和界面验收状态。

| 原文编号 | 实际代码位置 | 自动化验证 | 真实界面验收 | 结果/仍无法验证条件 |
| --- | --- | --- | --- | --- |
| R001 | `electron/main/oldFavoriteWorkspaceCoordinator.ts:1046-1051` 新增 `localBilimiProtectionAids`，只读取快照 `memberships` 的 `bilimi-logical:*` 键；`1971,2078,3204,6373,6419,7828` 分别用于扫描开始、分页 fallback、完成、恢复 workspace、恢复流式状态和扫描概览。扫描恢复与预览/完成恢复均重新以当前快照生成概览；恢复不再将 `readManagedMemberAids` 并入保护。 | 新增 `oldFavoriteWorkspaceCoordinator.test.ts` 用例 `protects only actual local Bilimi members after an incremental scan restart`：`bilimi-logical` 成员 1、普通本地/收件箱历史记录 2/3、仅历史记录 4、远端 managed 成员 5，重启后仅 1 保护，计划为 2/3/4/5。新增 `rebuilds a restored scanning inventory...` 与 `rebuilds a restored preview protection set...`，先分别断言旧持久化统计和历史基线导致失败，再验证当前成员重建统计/保护。聚焦恢复用例 2/2、完整协调器 390/390、`npm test` 253 文件/4627 项通过、`npm run build` exit 0。 | `npm run preview` 已启动预览 Electron；桌面自动化因 `unsupported Codex auth method: apikey` 无法连接，未能用截图数据实际复扫验证“已保护跳过”计数。 | 不删除 `organizationRecords`，但不再以其决定保护；`local:*`、`local:inbox`、`bilibili:*`、历史记录和远端 managed 成员均不独立保护；扫描、恢复和统计同源。 |
| R002 | 本账本保护 helper 与备册快路径分别实现，不共享可写业务状态。 | 保护恢复专项 2/2、完整协调器 390/390、全量 `npm test` 253 文件/4627 项通过、`npm run build` exit 0。 | 同 R001。 | 已有回归证据，不基于“应当没问题”的推断；无 B 站写入或历史数据删除。 |
| R003 | 见 R001-R002。 | 已按授权完成：保护与备册各有专用回归，完整测试和构建均已通过；本账本与代码同次本地提交。 | 同 R001。 | 已实施。 |
