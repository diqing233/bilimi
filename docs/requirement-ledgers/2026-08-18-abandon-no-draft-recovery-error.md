# 本轮需求账本：放弃整理后无草稿却出现恢复错误

## 原文区

### R001

**来源：** 用户消息（2026-08-18）

**截图文件：**

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e3629523-4687-450a-88cb-47f4c40b139c.png`

**截图目标区域：** “整理收藏”页面中央的错误弹窗。截图中弹窗标题为“整理收藏”，正文显示：

```text
Error invoking remote method 'old-favorite-workspace-v1:prepare-recovery':
Error: Old favorite workspace has not been started.
```

弹窗按钮为“重试暂停”。

**用户原文：**

> 讨论放弃整理后这个提示是什么

## 逐项索引表

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明放弃整理后再次进入“整理收藏”时出现该恢复错误的真实原因，并确定无未完成工作区时应走正常新扫描入口，而不是把“无工作区”当作暂停失败。 | “整理收藏”入口、恢复准备 IPC、旧收藏工作区协调器及无工作区状态。 | 仅有真实未完成工作区时显示恢复选择；已放弃、已清理或从未启动工作区时不显示内部英文错误和“重试暂停”。 | 已确认的目标行为（承接 `2026-08-18-abandon-organization-fresh-scan.md:R001`）为：放弃成功 → 工作区为空 → 再次点击“整理收藏” → 直接开始新的增量扫描；真实暂停/持久化失败才显示可操作错误。 | 无工作区检查不得写入 B 站、收藏库或伪造暂停记录；保留已完成的本地/B 站成果。 | 不改变仍存在草稿时“恢复草稿／重新扫描／放弃本轮整理”的既有选择；不隐藏真实暂停失败、结果未知或数据损坏错误。 | `ControlledFavoriteLedgerPanel.requestOldFavoriteOrganization`、`useOldFavoriteWorkspace.prepareRecovery`、`old-favorite-workspace-v1:prepare-recovery` IPC、`index.ts` 注入的恢复准备链路、`OldFavoriteWorkspaceCoordinator.requireWorkspace/getRecoverySummary`。 | 已实施，异常退出场景待验收 | 根因已在本账本“已确认根因”中记录：DeepSeek 恢复检查曾在无工作区时调用 `requireWorkspace`。`electron/main/index.ts` 现在在恢复快照为空时直接返回 `null`；`electron/main/oldFavoriteWorkspaceCoordinator.ts` 在仓库无工作区时返回空检查点；`electron/main/oldFavoriteWorkspaceDeepSeekService.ts` 仅将并发清理产生的精确“未启动工作区”视为无检查点，其它错误继续抛出。自动化覆盖放弃后只启动 incremental scan、无工作区检查点为空和恢复竞争。真实 Electron（开发版）在无工作区时点击“整理收藏”直接进入扫描概览并开始增量扫描，未出现英文错误或“重试暂停”；本次未执行 B 站同步。异常崩溃恢复仍待专项验收。 |

## 讨论结论回填

本问题由 `2026-08-18-scan-review-metadata-identifiers.md:R013-R014` 授权实施。确认后的补充只能追加新的 `Rxxx`，不得删除或改写 `R001`。

### 已确认根因（只读核查，2026-08-18）

1. 放弃完成后，`OldFavoriteWorkspaceCoordinator.abandonCurrentWorkspace()` 会清除收藏库中的工作区标记；这是正确的完成状态。
2. 再点“整理收藏”时，渲染进程总会先请求 `prepareRecovery()`。主进程的恢复准备先检查扫描服务；扫描服务在 `getSnapshot() === null` 时正确返回。
3. 恢复准备随后无条件调用 `OldFavoriteWorkspaceDeepSeekService.pauseForRecovery()`。该服务在没有正在运行的 DeepSeek 任务和没有内存检查点时，仍调用 `coordinator.getDeepSeekRunCheckpoint()`。
4. `getDeepSeekRunCheckpoint()` 需要一个存在的工作区；已放弃时会由 `requireWorkspace()` 抛出 `Old favorite workspace has not been started.`。这个错误经 Electron IPC 原样传到前端，才形成截图中的英文错误与错误的“重试暂停”按钮。
5. 因此不是放弃动作失败，也不是需要“再暂停一次”。根因是 DeepSeek 的恢复检查没有把“工作区不存在”视为正常的无草稿结果。该无条件检查由提交 `bf1b60fdd`（`fix: make favorite recovery entry safe and explicit`）引入；其后提交 `8be05f902` 仅补充了已暂停检查点的处理，未覆盖无工作区路径。

### 讨论中的实施范围（尚未执行）

- 在恢复准备的无工作区分支提前结束，直接返回 `null`；或让 DeepSeek 恢复检查在无工作区时安全返回“没有检查点”。两者都必须保证现存草稿仍在后台安全暂停后才展示三按钮。
- 新增一条跨服务回归：工作区已成功放弃 → 再点“整理收藏” → `prepare-recovery` 返回 `null` → 仅发送 `start-scan/incremental`；不显示任何恢复错误，不调用无效的 DeepSeek 检查点读取。
- 保持原有真实错误路径：仍有工作区但暂停、持久化或 B 站结果对账实际失败时，显示中文业务错误和恰当重试操作，不能把这些错误吞掉。
