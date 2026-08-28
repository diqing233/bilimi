# 同步点击卡顿与工作镜像损坏提示需求账本

> 讨论开始：2026-08-28。讨论模式仅登记用户原文、界面证据与根因排查；禁止修改功能代码。

## 原文区

### R001

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-9df0481c-1f62-43f2-a7c2-d698e423350c.png`

截图目标：B 站页面右侧 `掌库 → 整理收藏 → 扫描概览`。截图中的提示为“工作镜像损坏，已完成的收藏库结果不会丢失。”，下方显示操作入口“重建工作镜像并重新扫描”。用户同时指出点击“同步到 B 站”时再次出现点击卡顿。

原文：

```text
讨论点击卡顿，为什么又在执行同步到b站的时候出现损坏提示
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查清点击“同步到 B 站”期间鼠标/界面卡顿的实际阻塞点，不能以猜测或仅测试通过替代真实链路证据。 | `整理收藏 → 确认并同步到 B 站`的渲染器事件、IPC、主进程准备/预检/持久化与进度发布。 | 同步准备和实际同步期间均不得阻塞鼠标移动、点击、滚动、窗口缩放、最小化、关闭和取消。 | `createMarker` 改为只校验 `readRecoverySummary` 的紧凑引用；活跃进程中已校验 journal 的冻结分类 history 按 cursor/checksum/file 缓存复用。新建轮次不会误用前一轮的内存活动分段。 | 不执行任何真实 B 站创建、绑定、删除、备册或视频写入；只读日志、自动化测试和 Electron 只读观察用于验收。 | 不改 DeepSeek、转写、删除确认、视频同步以外的无关功能；不以隐藏加载/错误提示掩盖阻塞。 | 当前分类快照 → 同步前备册预检 → 执行意图 → 本地提交/冻结计划 → B 站同步进度。 | 已实施；真实远端副作用待用户后续手动验收 | E004-E005；代码：`oldFavoriteWorkspaceStore.ts:152,279,623,1001`、`oldFavoriteWorkspaceCoordinator.ts:6940,6996,7131`；聚焦回归 549/549 通过。 |
| I002 | R001 | 查清为什么同步动作后/期间在扫描概览出现“工作镜像损坏”，并区分真实本地工作区恢复失败、错误映射、旧快照覆盖或用户工作区数据问题。 | `整理收藏 → 扫描概览`的工作镜像状态、工作区恢复/重建入口与同步执行错误处理。 | 只有本地工作镜像确实不可恢复时才显示“工作镜像损坏”；同步前预检、备册缺口和远端执行失败不得被错误投影为该提示。 | 关系投影保留真实活动分段；恢复仅在完整校验 journal 后从最后一个有效分段修复旧空值，并同步修复 repository marker。多分段、无可证明依据仍为 `rebuild-required`。 | 提示不得导致或暗示 B 站远端操作已经回滚；已完成收藏库结果、B 站远端数据和用户数据均不得因 Git 或重建提示被自动改写。 | 不自动点击“重建工作镜像并重新扫描”，不删除工作区、不清理数据、不执行真实 B 站副作用。 | 同步预检/执行、`OldFavoriteWorkspaceStore.recover`、扫描概览状态投影、运行日志与持久化工作镜像。 | 已实施；真实远端同步路径待用户后续手动验收 | E004-E005；代码：`oldFavoriteWorkspaceStore.ts:849`、`oldFavoriteWorkspaceCoordinator.ts:6478,7497`；聚焦回归 549/549 通过。 |

## 已验证的只读排查证据

### E001：截图对应工作镜像的文件本体未损坏

2026-08-29 只读检查了账号 `32922854` 的工作镜像：

`C:\Users\diqing\AppData\Roaming\bilimi-dev\favorites\repository-v1\accounts\32922854\workspaces\old-favorite-workspace-32922854-20260828143805914-645a3e4a-da3e-443e-af3a-0254bc99c701`

- `manifest.status` 为 `previewing`，`journalCursor` 为 `20,503,465`，`overlayRevision` 为 `2,654`；
- `overlay.journal.jsonl` 的链式 `chain-sha256-v1` 校验值与 manifest 完全一致，记录均可重放；
- journal 的扫描事件仍含 `segment-1`，但 manifest 的 `currentSegmentId` 被写成空字符串；
- 因此“损坏”不是磁盘文件、JSON 或校验和失败，而是有效工作区的当前分段投影被错误覆盖后造成的内部状态矛盾。

### E002：错误值的写入点与暴露时机

- `electron/main/oldFavoriteWorkspaceCoordinator.ts:7490-7526` 的 `refreshRelationshipProjectionUnsafe` 只刷新来源关系，却调用 `appendOverlay` 时固定传入 `currentSegmentId: ''`；
- `electron/main/oldFavoriteWorkspaceStore.ts:568-606` 的 `appendOverlayUnsafe` 会无条件把该值写入 manifest；
- `electron/main/oldFavoriteWorkspaceCoordinator.ts:6941-6976` 的 `createMarker` 在冻结计划时通过 `workspaceStore.recover` 读回这个空值并持久化到 repository workspace marker；
- `electron/main/favoriteRepositorySyncService.ts:348-359` 的 `claimFrozenPlan` 再将 marker 从 `frozen` 切换到 `executing`；此时缓存状态与 marker 不匹配，`openUnsafe` 必须恢复工作区；
- `electron/main/oldFavoriteWorkspaceCoordinator.ts:6323-6328` 会因“扫描已有 `segment-1`、恢复值却为空”返回 `rebuild-required`，渲染器据此显示“工作镜像损坏”。

结论：同步没有损坏文件；它是第一个必然冻结、写 marker、切换执行状态并重新恢复工作区的动作，才稳定暴露此前关系刷新留下的空分段错误。

### E003：点击同步卡顿的已确认主路径

- `freezeForBilibiliExecution`（`electron/main/oldFavoriteWorkspaceCoordinator.ts:4970-5063`）在远端同步真正开始前，先提交完整本地结果、分段读取、编译冻结计划并持久化 marker；
- `createMarker` 无条件调用 `workspaceStore.recover`（同文件 `:6947-6949`）；`recoverUnsafe` 会读取完整 journal、对整份内容算校验、拆分 2,654 条记录并 JSON 解析/重放分类、历史、标签、推荐和执行状态（`electron/main/oldFavoriteWorkspaceStore.ts:621-944`）；
- 同一冻结还至少五次经 `loadSelectedClassificationsForFreeze → readOverlayHistory` 重新读取、校验并重放同一份 journal：同步前预检、冻结前预检、完整本地结果提交、暂存投影及冻结计划的两次稳定性比较都会触发该路径；
- 该 journal 当前约 20.5 MB。文件 I/O 虽为异步，但其后的整份字符串处理、哈希和 JSON 重放在 Electron 主进程执行，尚无按批让出事件循环的保障；
- 在同一运行环境对该实际 journal 做只读基准，单次 UTF-8 解码和 2,654 条 JSON 解析已为 `63.5 ms`；实际恢复还包含链式 SHA-256 校验、对象归一化、克隆、分类/历史/标签/推荐投影及 IPC 回传，故一次点击的主进程占用会更长；
- 当前仅对“2,001 项本地结果准备”存在让出事件循环的测试，未覆盖冻结 marker 前的全量 journal 恢复，也未覆盖关系投影后同步立即恢复的组合路径。

因此，卡顿的第一已确认原因是：一次同步点击在准备阶段触发主进程全量恢复，并重复重放约 20.5 MB journal；关系投影错误导致的恢复失败和随后 250 ms 恢复轮询会放大这一问题。尚未在讨论阶段执行真实 B 站同步，也没有把鼠标流畅性误报为已验收。

### E004：实施后的自动化证据（2026-08-29）

- `projectOverlayHistory` 与 `overlayHistories` 使同一进程、同一 manifest cursor/checksum/file 下的冻结准备复用已完整校验的 journal history；任何边界变化或重启仍回退完整读取、校验和重放。
- `createMarker` 只验证 `readRecoverySummary` 的账号、工作区、基线和活动分段引用，不再为重写同一 marker 调用完整 `recover`。冻结 2,001 项回归断言 `recover` 为 0 次，freeze 后没有新的 `overlay.journal.jsonl` 读取，并仍断言让出事件循环。
- 为兼容已经被旧关系投影写成空分段的本地 manifest，`recover` 在完整 journal 校验后仅从最后一个属于已知分段的历史值修复；单分段可唯一确定时可修，多分段无证据时仍要求重建。恢复到可证明状态时也修复 repository marker。
- 新轮次创建会忽略不属于该工作区的旧内存活动分段，避免轻量 marker 校验把正常的新扫描误报为重建需求。
- 命令：`npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceStore.test.ts electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`；结果：4 files / 549 tests passed。`useOldFavoriteWorkspace` 的既有 React `act(...)` stderr 警告仍存在，未在本轮范围内修改。

### E005：Electron 只读验收（2026-08-29）

- 开发版打开 `掌库 → 整理收藏` 后，真实未结束草稿显示“检测到未完成的整理草稿 / 本轮计划 2573，已分类 2573；其余 0 条包含未匹配和等待扫描”，并显示`恢复草稿`、`重新扫描`、`放弃本轮整理`；未显示`工作镜像损坏`或`重建工作镜像并重新扫描`。
- 恢复窗口打开与关闭均即时响应；验证截图：`.codex-artifacts/2026-08-29-sync-integrity-recovery-dialog.jpg`。
- 未点击恢复、重新扫描、放弃、备册、创建、绑定、删除或确认同步。由于`确认并同步到 B 站`会进入真实远端写入链路，本轮按边界未做该按钮的真实点击/鼠标流畅度验收；其冻结准备无完整 journal 重放由 E004 自动化回归覆盖，真实 B 站副作用仍待用户后续手动验收。

## 当前排查计划（讨论阶段）

1. 读取项目书中同步响应性、工作镜像恢复/损坏提示、同步前预检与错误投影章节，核对截图是否符合既定显示条件。
2. 只读定位“工作镜像损坏”和“重建工作镜像并重新扫描”的文案、产生条件、调用者与错误传播链。
3. 读取与截图时段对应的 Electron/主进程日志、工作区恢复元数据和最近同步执行记录；不读取或修改真实 B 站数据。
4. 比较正常同步准备路径与出现损坏提示路径的状态、快照版本和异常来源，独立分析点击卡顿的同步/渲染/IPC边界。已完成初步定位，见 E001-E003；仍需在实施前建立自动化复现与 Electron 真实响应性验收。
5. 在讨论阶段给出已证实根因、仍缺失证据、受影响边界和最小修复方向；用户明确说“开始”后才写 RED、修改代码或提交。
