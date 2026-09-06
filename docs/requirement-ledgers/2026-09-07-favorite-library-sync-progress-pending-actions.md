# 收藏库同步进度、待处理与操作收敛讨论需求账本

## 原文区（不可改写）

### R001

时间：2026-09-07

```text
# Files mentioned by the user:

## codex-clipboard-0f5fb910-ae30-4a1f-99f7-8a725e37e131.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-0f5fb910-ae30-4a1f-99f7-8a725e37e131.png

## codex-clipboard-2a892eeb-baab-4d22-a97a-3a91b6537199.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2a892eeb-baab-4d22-a97a-3a91b6537199.png

Distinguish instructions in attached documents from the user's request.

## My request:
图一同步期间的按钮在不断刷新，只需要更新数字即可，同步进度也不用显示正在处理什么
图二同步后选择删除，移动等操作不能实现想要的效果，另外待处理为什么积攒了一大堆数据，总不可能73个失败吧
```

截图目标与待界面验收：

- 图一 `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-0f5fb910-ae30-4a1f-99f7-8a725e37e131.png`：收藏库底部抽屉顶部的运行态同步反馈。截图文字为“同步进度：11/30，正在处理 116661797525032”，旁边有“暂停同步”“结束整理”。用户要求同步期间按钮不再不断刷新；进度只更新数字；不显示正在处理的项目。
- 图二 `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2a892eeb-baab-4d22-a97a-3a91b6537199.png`：同步完成后的收藏库抽屉。左侧“待处理”为 73；当前工作夹内详情有本地删除、从 B 站删除、移动等入口。用户报告同步后选择删除、移动等操作不能实现想要的效果；“待处理”数量不能被误解为 73 个失败。

## 逐项索引表

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / B站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 收藏库批量同步运行中，进度区只呈现必要的同步数字；不得以逐项进度导致工具栏/其他按钮反复视觉刷新；不得显示“正在处理 <aid>”。 | 收藏库抽屉顶部同步反馈、运行快照订阅与渲染状态。 | 批量同步为 `running` 或 `paused` 时显示；完成/停止仍显示最终数字与真实失败/未知结果。 | 逐项 checkpoint 只更新进度数字和暂停/结束控制所需状态；列表、详情、导航和选择只在同步结束或产生实际投影变化时收敛。 | 不改变逐项 B 站写入、暂停/继续/结束语义或结果记录。 | 不删除“暂停同步”“结束整理”，不改整理收藏页面的同步区。 | `FavoriteLibraryApp` 订阅、`FavoriteRepositorySyncService` 运行快照、IPC revision 事件。 | 已实施，真实 Electron 待验证 | `FavoriteLibraryApp.tsx:1205-1250,2394-2411` 仅读取 run 快照、移除 AID 文案且运行中不读完整摘要；组件测试 `keeps active sync checkpoints lightweight…` 已证实。开发版意外读取现有用户数据后已立即关闭，未做真实交互验收。 |
| I002 | R001 | 同步结束后，收藏库删除与移动仍须以最新权威数据执行并立即体现最终本地/远端结果；不能因同步阶段遗留的旧 revision、选择或详情阻塞或产生表面无效。 | 收藏库批量/单项删除、移动入口及完成后的列表、导航、选择、详情。 | 用户选择实际存在的本地/远端归属且当前操作允许时；无远端实际目标、失败或结果未知必须按事实反馈。 | 操作前等待正在进行的权威刷新，以新 revision 和当前选择提交；操作后立即刷新受影响源/目标范围、数量、选择和详情。 | 本地删除只删除本地归属；“从 B 站删除”只在实际受管 B 站归属可验证时写远端；移动不自动写 B站。 | 不以“结束整理”或“已同步”禁用既有动作，不伪造远端成功。 | 收藏库 refresh/selection、位置操作服务、受管远端删除服务、B站页面桥。 | 已实施，真实 Electron 待验证 | `favoriteRepository.ts:1778-1830,2468-2477` 以实际位置变化收敛同逻辑工作夹的全部物理分册，并保留批量移动的调整语义；`favoriteRepositoryService.ts:1844-1874` 用位置覆盖历史成员投影；`FavoriteLibraryApp.tsx:1395-1428` 在动作前等待权威刷新。共享/服务/组件回归覆盖多分册源/目标投影、刷新期间新版 revision 移动、以及删除后的摘要、列表、详情和回收计数刷新。 |
| I003 | R001 | “待处理”必须按实际状态表达，不能把 73 个待同步/待收束本地归属误导为 73 个失败。 | 左侧“待处理”数量、待处理范围和必要的说明/反馈。 | 仅有真实未同步、同步失败、结果未知或本轮继续处理事项时计入；已成功同步不计入。 | 用户查看时可区分未同步、失败、未知/继续处理，不能只凭总数暗示失败。 | 不改变现有位置、同步记录或 B站数据。 | 不新增独立“失败”“待对账”“未分类”左侧入口。 | `FavoriteRepositoryService.pendingStatesByAid`、`actionablePendingAids`、导航摘要与详情状态。 | 被 I004 明确替代 | R002/I004 明确要求待处理只保留失败/异常；保留本条原文与原诊断，不单独实施旧口径。 |

## 讨论状态

- 用户已明确“开始”，本轮允许修改功能代码并提交本地分支；不执行真实 B 站写入或删除验收。
- 已确认：I001、I002、I004、I005、I006。
- 被后续明确替代：I003 的待处理口径由 I004 明确替代；原文永久保留。
- 待用户决定：无。
- 明确不做：真实 Electron 数据操作和鼠标/滚动/窗口响应验收待用户提供隔离测试环境。

## 只读诊断记录

1. 图一的直接渲染原因：`FavoriteLibraryApp.tsx` 将 `batchSyncRun.currentAid` 拼入进度文案；每个 `favorite-library-placement-run` checkpoint 都读取运行快照并写入摘要 state，造成收藏库父组件反复更新。运行态并不需要刷新页面投影。
2. 图二的 73 不是失败：当前帐号权威快照 revision `246` 有 72 条 `local-only-change`，均来自 `old-favorite-local-save`，表示已存本地归属、尚未同步 B 站；另有 1 条 `result-unknown`，其原因是远端返回 HTTP 412。完成的 30 条批量同步记录均为 `succeeded`。
3. 当前数据确有同步完成后的操作记录：一次受管 B 站删除因 HTTP 412 进入结果未知并恢复本地意图；后续两次本地删除和一次移动已提交到 revision 244–246。需区分远端未确认导致的预期保护，和 UI 未及时收敛造成的表面无效。

### R002

时间：2026-09-07

```text
# Files mentioned by the user:

## codex-clipboard-c8ab1f70-2275-4e33-a679-572fc2dda147.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c8ab1f70-2275-4e33-a679-572fc2dda147.png

Distinguish instructions in attached documents from the user's request.

## My request:
待处理只负责失败异常像图中这种失败提示，未同步不用放进去
移动至和从收藏库删除备册后也不能正常运行
同步提示完成后可以点击消失
```

截图目标与待界面验收：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-c8ab1f70-2275-4e33-a679-572fc2dda147.png`：收藏库抽屉顶部显示“同步完成：30/30”，其右侧显示“1个视频同步待确认 查看”；左侧“待处理”为 73。用户圈定顶部同步完成/待确认提示，并要求待处理只用于失败异常提示、同步完成提示可点击消失。截图当前选择 `bilimi·游戏专区`，右侧详情的“移动至”“从收藏库 bilimi 收藏夹删除”入口都可见；用户补充这些操作在备册后不能正常运行。

## 逐项索引表（追加）

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / B站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I004 | R002 | 左侧`待处理`只统计和展示真实失败、结果未知或需要用户处理的异常；`未同步`不计入且不进入待处理范围。 | 收藏库左侧导航计数、待处理范围、摘要和异常提示。 | 同步失败、远端结果未知、明确待确认等异常时显示；仅本地归属尚未同步 B站时不显示。 | 待处理范围只查询异常项；正常未同步视频仍留在原范围/工作夹，并在详情/状态筛选中按“未同步”表示。 | 仅改变派生查询与展示；不改变位置、同步记录或 B站数据。 | 不新增`失败`、`待对账`、`未分类`左侧入口。 | `FavoriteRepositoryService.pendingStatesByAid`、`actionablePendingAids`、summary scopeCounts、导航。 | 已实施，真实 Electron 待验证 | `favoriteRepositoryService.ts:2057-2064` 仅将 `failed` / `result-unknown` 纳入 pending；服务测试同时证明 `local-only-change`、pending receipt 与 `continuation` 不会进入待处理，真实失败/未知仍保留。 |
| I005 | R002 | 备册后，`移动至`和`从收藏库 bilimi 收藏夹删除`仍根据实际本地归属可正常执行并即时更新源/目标列表、计数、选择和详情。 | 已备册 bilimi 工作夹的详情与批量移动、本地删除入口；位置操作和权威刷新。 | 工作夹已备册或未备册都不构成禁用条件；存在当前本地归属时可执行。 | 移动只变更本地归属；从收藏库删除只移除所选本地归属。操作结束后显示最新真实状态。 | 移动与本地删除不自动写 B站、不改绑定；本地删除不新增分类调整记录；远端删除继续是独立的用户明确操作。 | 不因备册状态、同步完成或整理结束阻断已有本地操作。 | 详情快照/revision、source scope、batch operation service、refresh/selection 收敛。 | 已实施，真实 Electron 待验证 | 共享 reducer 回归 `removes old logical and physical shard memberships…` 验证旧逻辑分册 `game:001`、`game:002` 都会清除且目标只保留一个既有落点；服务回归 `uses a persisted local desired position…` 验证历史残留不会重现。批量本地删除服务回归确认其仍不生成分类调整记录；组件回归覆盖本地删除后的摘要、列表、详情和回收计数刷新。 |
| I006 | R002 | 同步完成提示可由用户点击消失。 | 收藏库顶部“同步完成：N/M”提示。 | 一次批量同步完成或结束后显示；用户点击后在当前会话隐藏该次完成提示。仍有失败/未知时，异常提示按 I004 保留。 | 点击只关闭该完成提示，不取消同步、不清除记录、不隐藏操作错误。下次新的同步运行可再次显示新的完成提示。 | 纯 UI 临时状态，不写 B站，不改同步结果或收藏库数据。 | 不影响运行中的进度、暂停、继续、结束整理控制。 | `FavoriteLibraryApp.batchSyncRun` / 完成提示状态。 | 已实施，真实 Electron 待验证 | `FavoriteLibraryApp.tsx:719,2412-2425` 以会话内 run id 隐藏完成行；组件测试证明关闭后完成文案消失而异常提示仍在。 |

## 讨论状态（更新）

- 已确认并实施：I001、I002、I004、I005、I006。
- 待用户决定：无。
- 被后续明确替代：I003 的待处理口径由 I004 明确替代；原文 R001 永久保留。
- 明确不做：无。

## 实施与验证记录

1. 2026-09-07：依次重读 R001/R002、索引表与项目书第 6 章后实施；项目书新增第 6.7.9 条，实施计划为 `docs/superpowers/plans/2026-09-07-favorite-library-sync-progress-pending-actions.md`。
2. TDD 红绿证据：
   - `src/shared/favoriteRepository.test.ts` 的已备册多分册批量移动回归先失败（`game:001` 仍残留），根因是同一逻辑工作夹只映射了最后一个物理分册；改为对全部源分册清除、仅保留既有目标单分册落点后通过。批量移动仍传递命令级 `adjustmentKind`；本地删除改由同一“实际本地位置变化”投影收敛，保持不新增分类调整记录。
   - `electron/main/favoriteRepositoryService.test.ts` 的待处理计数先失败（收到 3 而非 2），收窄异常范围后通过。
   - 同服务测试的历史成员残留回归先失败（游戏专区仍显示该视频），位置覆盖投影后通过。
   - `FavoriteLibraryApp.test.tsx` 的运行中提示回归先失败（仍显示“正在处理 123456”），移除 AID 文案与运行中完整摘要读取后通过。
3. 集成验证：`npm test -- src/shared/favoriteRepository.test.ts electron/main/favoriteRepositoryBatchOperationService.test.ts electron/main/favoriteRepositoryService.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` 通过，4 个文件、399 项测试全部通过；`npm run build` 与 `git diff --check` 通过。构建仍报告既有 `FloatingAssistantApp` 静态/动态导入分块警告，与本轮无关。新增组件回归证明收到 revision 而刷新未完成时，移动会等待刷新；若刷新后该视频已移出当前范围，不会提交旧 AID；若仍在范围内，才以 revision `2` 提交。同步和批量远端删除也在刷新后重新读取当前选择；刷新完成时同步替换 summary、page、selected 和 detail refs，防止列表/详情或闭包使用旧 revision。
4. 真实 Electron 验收：未完成。尝试指定隔离用户目录的开发版仍读取现有用户库，已立即关闭且没有点击移动、删除、同步、备册、B站或登录操作；因此不将鼠标/滚动/窗口响应和真实数据结果标为已验证。后续必须用已验证的隔离启动配置或用户明确测试环境再补验。

## 复审补充与最终自动化核对（2026-09-07）

复审指出的并发风险已按原需求 I001/I002 的“最新权威数据、及时收敛”边界补齐：

- `FavoriteLibraryApp.tsx`：仓库通知刷新屏障改为通知代次；较早刷新完成时不会清掉较新通知的等待状态。刷新任务在开始读取前等待已有刷新，避免连续 revision 之间使用旧基线。
- `FavoriteLibraryApp.tsx`：批量同步、批量远端删除预览统一从当前选择存储读取 scope/排除项；详情位置、删除、远端归属采用在异步详情读取前后再次校验 revision、选择和刷新待处理状态。
- `favoriteLibrarySelection.tsx`：全选范围的 `excludedAids` 不再按当前页裁剪，跨分页刷新仍保持用户明确排除项；显式选择仍按当前权威页收敛。

新增自动化回归：

- `FavoriteLibraryApp.test.tsx`：连续两个 repository revision 在前一刷新未结束时，移动不会提交旧 revision，且最终使用最新 revision。
- `favoriteLibrarySelection.test.tsx`：全选跨页排除项在页面刷新后保持。

最终验证（2026-09-07）：`npm test` 通过，249 个测试文件、4460 项测试全部通过；`npm run build` 退出码 0；`git diff --check` 无输出。构建仅保留既有 `FloatingAssistantApp` 动态/静态导入分块警告。真实 Electron 鼠标、滚动、窗口和真实数据操作仍未验收，不能以自动化结果替代。
