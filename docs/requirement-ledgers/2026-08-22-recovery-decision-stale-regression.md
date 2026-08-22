# 需求账本：恢复决策过期错误回归

创建日期：2026-08-22
主题：恢复草稿后 DeepSeek 辅助整理出现恢复决策过期错误

## 原文区

### R001

- 时间：2026-08-22
- 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-49be5891-b759-4d56-97bd-3b2d6beed72e.png`
- 截图目标区域：右侧「DeepSeek 辅助整理」卡片中的红色错误框，显示 `Old favorite workspace recovery decision is stale; read a new recovery summary first.`。
- 用户原文：

```text
为什么又有这个bug
```

### R002

- 时间：2026-08-22
- 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cbd4ba4e-2c9b-46b8-bdb7-b3c8598bc3c7.png`
- 截图目标区域：点击右侧「整理收藏」后出现的居中「整理收藏」弹窗。弹窗显示 `Error invoking remote method 'old-favorite-workspace-v1:prepare-recovery': Error: Old favorite workspace recovery decision is stale; read a new recovery summary first.`，下方只有「重试暂停」，没有放弃草稿或重新整理的恢复选项。
- 用户原文：

```text
而且重启弹出这个bug，连放弃重新整理的选项都没有了
```

### R003

- 时间：2026-08-22
- 用户原文：

```text
恢复草稿后为什么不能正常增减收藏夹和DeepSeek整理呢
```

### R004

- 时间：2026-08-22
- 用户原文：

```text
恢复草稿 后整个整理收藏的操作都要正常可响应，数据都在为什么会失败
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明恢复草稿后再次出现恢复决策过期错误的原因。 | 「DeepSeek 辅助整理」错误提示；旧收藏夹工作区恢复状态。 | 首次快照读取命中严格的过期决定错误时才进入安全恢复；其他错误仍原样失败。 | DeepSeek 先只读恢复摘要、选择既有 `merge-latest`，再重新读取 `previewing` 快照；未恢复成功不发送模型请求。 | 不扫描、不创建/绑定/删除 B 站收藏夹，不重放旧 DeepSeek 请求；真实模型调用仍需原有确认。 | 不改转写、删除确认、视频同步、单个备册流程或其他错误处理。 | 工作区恢复、工作区快照读取、DeepSeek 整理入口。 | 已实施，Electron 待验收 | 代码、自动化与界面验收缺口见“实施证据（2026-08-22）”。 |
| I002 | R002 | 重启后打开「整理收藏」时，必须仍能看到恢复摘要中的放弃草稿与重新整理选项；不得由过期决定错误直接替代恢复选择。 | 「整理收藏」恢复弹窗及 `prepare-recovery` IPC。 | 存在未完成预览草稿且恢复决定过期时，返回现有 `recover-draft`、`rescan`、`abandon` 摘要；非该严格错误仍抛出。 | `prepare-recovery` 仅对该可恢复错误只读获取摘要，渲染器继续走既有恢复选项，不开始扫描、DeepSeek 或执行。 | 摘要读取无 B 站副作用；不会确认、放弃、重扫或写入任何远端实体。 | 不把工作镜像损坏、账号不匹配或结果未知当作可恢复草稿。 | `prepare-recovery`、恢复摘要、恢复决策和草稿打开。 | 已实施，Electron 待验收 | 代码、自动化与界面验收缺口见“实施证据（2026-08-22）”。 |
| I003 | R003 | 恢复草稿成功后，正常允许增减收藏夹规则和执行 DeepSeek 整理；规则变化必须遵循既有恢复/重算语义，不得将恢复后工作区永久锁死。 | 收藏夹规则编辑、草稿恢复、DeepSeek 整理入口。 | 仅 `previewing` 草稿且用户已明确保存本地规则配置后适用；扫描/同步等其他状态仍保留各自门禁。 | 重分类成功后仅前移已确认的本地配置指纹；重启可重建工作区。DeepSeek 读取过期决定后采用既有安全恢复路径再继续。 | 不吸收视频、镜像、正式绑定或远端执行事实；这些变化仍在重开时要求恢复摘要。不会自动创建、绑定、删除或移动 B 站收藏夹。 | 不改变关闭草稿、重新扫描、B 站同步、单个备册或删除确认流程。 | `selectRecoveryDecision(merge-latest)`、规则配置指纹、收藏夹规则保存后重分类、DeepSeek 服务。 | 已实施，Electron 待验收 | 代码、自动化与界面验收缺口见“实施证据（2026-08-22）”。 |
| I004 | R004 | 恢复草稿完成后，整理收藏的全部操作按工作区实际状态恢复可响应；不能因已处理的本地规则变化继续整体失效。 | 整理收藏向导、批次、分类、收藏夹规则、DeepSeek 与执行准备入口。 | 仅数据完整的 `previewing` 草稿在已确认本地规则变化后可直接恢复；扫描中、B 站执行中或结果未知仍显示各自的暂停/继续/对账安全操作。 | 过期决定不再让恢复入口提前异常；本地规则重分类后的持久化基线允许重建内存草稿，保持人工与 DeepSeek 分类既有优先级。 | 恢复与重分类均只写本地工作区；不自动写 B 站、重新扫描、创建/绑定/删除收藏夹或重放 DeepSeek。实际远端执行仍遵守确认、幂等与对账保护。 | 不把「全部可响应」误解为放开同步在途、失败冷却或结果未知保护。 | 恢复摘要、恢复决定、工作区反序列化、规则变更、各操作的状态门禁。 | 已实施，Electron 待验收 | 代码、自动化与界面验收缺口见“实施证据（2026-08-22）”。 |

## 实施证据（2026-08-22）

- I001：`electron/main/oldFavoriteWorkspaceDeepSeekService.ts:109-125,163-176,867-879` 将首次读取快照抛出的严格“恢复决定过期”错误导入现有 `merge-latest` 恢复协议；在第二次 `getSnapshot()` 返回 `previewing` 草稿前，不会触发 provider 请求。`electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts` 覆盖该真实重启路径。
- I002：`electron/main/oldFavoriteWorkspaceCoordinator.ts:59-64` 导出精确错误判定；`electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts:356-365` 只在该错误时回退到只读 `getRecoverySummary()`。`electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts` 断言返回 `recover-draft`、`rescan`、`abandon`，并断言未开始扫描或 B 站执行。
- I003：`electron/main/oldFavoriteWorkspaceCoordinator.ts:373-394,3530-3537,4386-4400` 在用户保存规则后重分类成功时，仅更新 `metadata`、`rules`、`keywords`、`defaultSettings` 的恢复基线及决定指纹；视频修订、B 站镜像和正式绑定指纹仍保留原值。恢复向量以真实的 `accountMid:aid` 仓库位置键读取位置修订和远端镜像，避免把实际镜像变化漏出恢复门禁。`electron/main/oldFavoriteWorkspaceCoordinator.test.ts` 覆盖规则/关键词改变后重启可恢复，以及后续远端视频、镜像和正式绑定变化仍要求恢复摘要。
- I004：I002 的恢复摘要回退与 I003 的配置基线前移共同使数据完整的 `previewing` 草稿可重新装载为工作区；扫描、同步和结果未知状态没有被放开。没有新增任何 B 站创建、绑定、删除、移动、视频写入、扫描或旧 DeepSeek 请求重放调用。
- 自动化：新增的“保存规则后重启可恢复、后续镜像/绑定仍过期”与“全批 DeepSeek 在请求 provider 前恢复过期决定”定向回归均通过；随后相关 4 套件完整通过（协调器 310 项、IPC 48 项、DeepSeek 57 项、面板 137 项，共 552 项；面板保留既有 `act(...)` 警告）。`npm test` 新鲜完整运行通过：237 个测试文件、3,992 项（356.24 秒）；`npm run build` 通过。
- Electron 界面验收：未完成。当前开发版是修复前的旧 Electron 主进程，强制关闭将中断正在使用的应用并可能影响用户工作；未创建截图，也不把旧错误画面作为通过证据。需要在用户允许重启开发版后，只读确认恢复弹窗含“恢复草稿 / 重新扫描 / 放弃本轮整理”，以及恢复后的预览草稿控件与 DeepSeek 卡片可响应。

## 根因核验（只读，2026-08-22）

- 当前开发版账号 `32922854` 的活动工作区处于 `previewing`，有 2,572 条本轮视频；恢复决定为 `merge-latest`，记录时间为 `2026-08-21T15:45:29.164Z`。
- 该决定保存的恢复基线只有 8 个默认收藏夹规则。当前账户设置已多出且启用 `bilimi·honker233`（ID `custom-author-honker233-小王爱马枪~9.2d`，UP 主规则）。因此 `metadata`、`rules`、`keywords` 三个恢复指纹维度均已变化；这已足以使保存的 `evidenceFingerprint` 与当前指纹不一致。
- `OldFavoriteWorkspaceCoordinator.restoreFromStore()` 在 `electron/main/oldFavoriteWorkspaceCoordinator.ts:5120-5126` 重新打开预览草稿时直接抛出截图中的英文错误。
- DeepSeek 服务本已有“收到恢复对象后自动使用 `merge-latest`”的逻辑（`electron/main/oldFavoriteWorkspaceDeepSeekService.ts:101-120`），但它先调用 `coordinator.getSnapshot()`（约 160 行）。当前失配被前一层直接抛异常，而非返回恢复对象，因此自动合并分支完全不可达；模型请求尚未发出。
- 现有回归测试只覆盖“`getSnapshot()` 返回恢复对象后自动合并”，没有覆盖“持久化恢复决定已过期时 `getSnapshot()` 抛出异常”的真实重启路径。这就是同类问题在规则变化后再次出现的直接原因。
- 未触发 DeepSeek 请求、扫描、草稿恢复、B 站创建/绑定/删除或视频写入。截图顶部“DeepSeek 已连接”只表示连接状态正常，并不表示本次整理请求已经发送。

## R002 调用链核验（只读，2026-08-22）

- `electron/main/index.ts:2396-2410` 为 `prepare-recovery` 注入的实现：它先调用 `oldFavoriteWorkspaceCoordinator.getSnapshot()`，再暂停进行中的扫描/DeepSeek/执行意图，最后才调用 `getRecoverySummary()`。
- 重启后没有内存中的活动工作区，前述第一次 `getSnapshot()` 必然进入 `restoreFromStore()`；已过期的恢复决定在 `oldFavoriteWorkspaceCoordinator.ts:5120-5126` 直接抛出错误。因此 `prepare-recovery` 未执行到最后的 `getRecoverySummary()`。
- `getRecoverySummary()` 本身是只读路径，且对未完成的预览草稿返回 `recover-draft`、`rescan`、`abandon` 三个选项（`oldFavoriteWorkspaceCoordinator.ts:3411-3454`）；它不要求加载工作区段、不扫描、不调用 DeepSeek，也不写 B 站。
- 渲染端在 `ControlledFavoriteLedgerPanel.tsx:560-564` 只有拿到恢复摘要时才渲染恢复选项；若 `prepareRecovery()` 抛错，`575-580` 只记录 `recoveryPreparationError`。错误弹窗的 JSX（约 `812-816`）故意只显示错误与「重试暂停」，所以截图中没有「放弃本轮整理」或「重新扫描」是该调用顺序的必然结果，而不是按钮被隐藏或草稿已经不可放弃。
- 现有测试覆盖 `prepareRecovery()` 正常返回摘要后显示三个恢复选项，却没有覆盖“重启 + 已保存恢复决定过期 + `getSnapshot()` 抛错”时仍返回恢复摘要的路径。

## R003 恢复后可编辑性核验（只读，2026-08-22）

- 设计上，恢复草稿成功后工作区仍是 `previewing`，应可继续编辑收藏夹规则、生成本地预分类建议及运行 DeepSeek；这些都不是恢复后应永久禁用的动作。
- 选择 `merge-latest` 时，`selectRecoveryDecision()` 会以当时的当前配置刷新 `recoveryBaseline` 并保存新的决定指纹（`oldFavoriteWorkspaceCoordinator.ts:3351-3369`）。恢复后立即读取正常快照时，DeepSeek 入口应可以继续执行。
- 但后续新增、删除、启用/停用或修改收藏夹规则会改变 `resolveRecoveryConfiguration()` 的 `metadata`、`rules` 或 `keywords` 指纹（`electron/main/index.ts:2290-2308`）。例如当前账户新增的 `bilimi·honker233` 即属于该变化。
- 已存在的“规则变更后重分类”命令 `reclassifyForFavoriteConfiguration()` 仅重算派生分类（`oldFavoriteWorkspaceCoordinator.ts:3495-3501`）；收藏夹草稿规则保存路径也只更新推荐/分类工作区数据（约 `2240-2528`）。两条路径均不更新 `recoveryBaseline` 或 `recoveryDecision.evidenceFingerprint`。代码中更新恢复基线的写入点仅见 `merge-latest` 与 `persistMarker()`（`3351-3369`、`5813-5816`）。
- 因此，同一进程内的缓存工作区通常还能编辑；但重启后会重新进入 `restoreFromStore()`，把旧决定与已变更的规则比较并再次抛出 stale。DeepSeek 必须先读同一工作区快照，也随之被阻断。这使“可编辑的整理草稿”错误地变成“每编辑一次，下一次恢复都有概率锁死”的状态机。
- 这解释了 R001、R002、R003 的共同根因：恢复门禁把正常且允许的草稿后续编辑，误当成只能重新人工确认的危险冲突；同时异常协议又绕开了恢复摘要和 DeepSeek 的自动合并路径。

## R004 数据存在但整体不可操作的核验（只读，2026-08-22）

- 当前开发数据中，该工作区的 `baseline/`、`scan/`、`manifest.json`（约 1.5 MB）和 `overlay.journal.jsonl`（约 21.7 MB）都存在；持久化仓库标记为 `previewing`。这不是草稿数据丢失、空草稿或反序列化文件损坏的证据。
- `openUnsafe()` 先取得持久化仓库标记，再调用 `restoreFromStore()`（`oldFavoriteWorkspaceCoordinator.ts:5030-5041`）。`restoreFromStore()` 已经成功读取工作区持久化摘要后，先执行恢复决定指纹检查（`5103-5126`）；异常发生在后续重建分段、分类、历史、推荐和运行时索引之前。
- 因此进程重启后内存 `workspaces` 缓存为空，所有依赖工作区快照或 `requireWorkspace()` 的整理操作都会被同一全局异常阻断，不限于 DeepSeek 或收藏夹规则。数据仍在磁盘上，却没有被允许恢复为可操作的内存工作区。
- 正确行为应是：用户完成针对变化的恢复处理后，按工作区真实状态恢复全部可用操作。`previewing` 草稿可继续分类、修改收藏夹规则、查看批次及调用 DeepSeek；扫描中、冻结/执行中和结果未知工作区也不能“失效”，而应分别保留既有暂停/继续/结束/对账等安全操作。
- 远端 B 站写入、结果未知对账、失败冷却和执行中的幂等保护不因 R004 被绕过；R004 要求的是每个状态有正确的可响应操作，而非无条件放开所有写入。
