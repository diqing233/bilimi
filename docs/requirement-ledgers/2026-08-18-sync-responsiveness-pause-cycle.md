# 本轮需求账本：同步响应性与重复暂停/继续

## 原文区（不可改写）

### R001

原文消息：

```text
# Files mentioned by the user:

## codex-clipboard-fd27e04d-a9a1-4527-ace5-f409a03845ef.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-fd27e04d-a9a1-4527-ace5-f409a03845ef.png

Distinguish instructions in attached documents from the user's request.
## My request:
讨论这个同步过程也放在已汇总上面，
点击开始同步之后会变得特别卡，鼠标都动不了，这个设计项目书没有吗，鼠标不卡或真实操作流畅
而且点击暂停，再点击继续后，下面的按钮就变成不可点击正在暂停了，应该可以反复继续暂停
```

截图目标区域：确认执行的多批`本轮总览`执行态。目标为“正在同步到 B 站”进度与下方操作按钮、“已汇总 N/M 批”及归档目标汇总的上下顺序；截图路径如 R001 原文所列。真实交互流畅性与暂停/继续循环待 Electron 开发版验收。

### R002

原文消息：

```text
不用
```

### R003

原文消息：

```text
可以先迭代项目书，再按照项目书和账本改，开始
```

## 逐项索引表

| 状态 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 已实施待真实界面验收 | R001 | 同步过程放在“已汇总”上面。 | `OldFavoriteConfirmationStep` 的多批、本轮总览、`executing`确认执行界面。 | 仅真实 B 站同步执行中显示；当前批次与单批布局保持现状。 | 同步进度与暂停/结束操作先于“已汇总 N/M 批”和归档汇总渲染。 | 无新持久化、迁移或 B 站写入。 | 不改汇总口径、冻结计划、确认对话或非执行态布局。 | `OldFavoriteWholeRunOverview` 与执行态快照。 | `OldFavoriteConfirmationStep.tsx:220-236`；回归 `OldFavoriteConfirmationStep.test.tsx:515-538` 通过。隔离 Electron 在权限检查前停止，未能安全进入该同步界面。 |
| 已实施待真实 Electron 验收 | R001 | 开始同步后真实操作流畅，鼠标不能卡；项目书写明该设计。 | `FavoriteRepositorySyncService` 的逐项同步循环、Electron 主进程与确认执行界面。 | 长计划的每一项成功/失败收束后；远端请求期间仍允许操作窗口和确认界面。 | 每项 checkpoint 和本地投影后让出事件循环，下一项才开始；不阻塞界面消息。 | 保留逐项 checkpoint、顺序写入、暂停边界、B 站实际副作用、失败/对账语义。 | 不以真实 B 站账号测试；不更改同步排序、远端调用次数或请求内容。 | 页面桥、远端仲裁器、仓储持久化、Electron 消息循环。 | `favoriteRepositorySyncService.ts:447-492,1423-1430`；回归 `favoriteRepositorySyncService.test.ts:98-120` 通过。隔离 Electron 已启动，但无本地长同步模拟入口且网络权限检查阻断；未伪造鼠标/窗口/两轮暂停验收。 |
| 已实施待真实界面验收 | R001 | 暂停后继续，不能仍显示且禁用“正在暂停”；可以反复继续暂停。 | `OldFavoriteConfirmationStep`、主进程工作区快照的`status`与`executionProgress.syncPaused`。 | 只有暂停命令尚未收束时显示`正在暂停…`；`frozen + syncPaused`显示`继续同步`；恢复`executing`显示可点击`暂停同步`。 | 固定循环`同步中 -> 请求暂停 -> 已暂停 -> 请求继续 -> 同步中`；可重复直到终态。 | 暂停持久化已有`sync-paused`状态和进度；继续仅执行未完成项，不重复 B 站写入。 | 不改 DeepSeek、扫描、本地保存、对账和结束本轮的既有语义。 | 组件本地临时态、IPC 返回快照、同步服务暂停检查点。 | `OldFavoriteConfirmationStep.tsx:121-125,232-236`；回归 `OldFavoriteConfirmationStep.test.tsx:540-574` 覆盖两轮暂停请求。隔离 Electron 受同一权限边界阻断。 |
| 明确不做 | R002 | 不使用可视化辅助。 | 本轮讨论与实施过程。 | 始终不创建浏览器可视化辅助。 | 无。 | 无。 | 不影响实现所需的自动化测试与真实 Electron 验收。 | 无。 | R002 原文。 |
| 已实施 | R003 | 先迭代项目书，再按项目书和账本修改。 | `docs/项目功能项目书.md`、本账本及本轮实施文件。 | 代码改动前完成项目书最终功能规则。 | 无运行时行为。 | 无。 | 项目书不写调整历史，只写最终设计。 | R001。 | `docs/项目功能项目书.md:313-315` 已先于代码改动更新；本账本原文区已在实施前重新通读。 |

## 待用户决定

无。

## 被明确替代

无。

## 明确不做

- R002：不使用可视化辅助。

## 实施核对记录

- 实施前通读：已在 2026-08-18 阅读原文区与逐项索引表，并核对当前本地`main`的同步组件、同步服务、项目书和现有测试。
- 当前事实：`OldFavoriteConfirmationStep`将多批`OldFavoriteWholeRunOverview`放在同步进度块之前；`pauseRequested`只在暂停命令返回`false`或抛错时复位，收到`frozen + syncPaused`后继续再回到`executing`会遗留`正在暂停…`。
- 当前事实：`FavoriteRepositorySyncService.drive()`逐项持久化远端结果，但在每项结果投影完成后没有明确的事件循环让步契约；本轮将以服务层可注入让步测试锁定该行为，不改变远端写入边界。
- 红灯：2026-08-18 新增组件测试在旧实现失败两项，分别为同步进度仍在“已汇总”之后、`frozen + syncPaused -> executing`后按钮仍为禁用的`正在暂停…`；服务测试在旧实现收到事件序列`append:1, append:2`，缺少两次让步。
- 绿灯：`npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx` 通过`39/39`；`npm test -- --run electron/main/favoriteRepositorySyncService.test.ts`通过`60/60`。
- 全量与构建：`npm test`输出存于`.codex-artifacts/2026-08-18-sync-responsiveness-full-test.log`，通过`234/234`文件、`3856/3856`测试；`npm run build`通过；`git diff --check`通过，无空白错误。
- Electron 实机边界：以`BILIMI_TEST_USER_DATA=C:\Users\diqing\bilimi\.codex-artifacts\sync-responsiveness-e2e-profile`启动隔离开发版，日志为`.codex-artifacts/2026-08-18-sync-responsiveness-electron.log`。界面显示“启动前权限检查 / 打开 bilimi”；继续会触发 Windows 网络权限流程，且现有项目无安全本地长同步模拟入口。为避免访问真实账号、B 站或权限设置，未点击该按钮；鼠标、点击、滚动、缩放、最小化、恢复、关闭及两轮真实暂停/继续保持待验收，不能用自动化测试替代。
