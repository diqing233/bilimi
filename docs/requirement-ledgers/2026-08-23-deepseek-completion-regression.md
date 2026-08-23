# DeepSeek 整理完成状态回归需求账本

## 原文区（不可改写）

### R001

时间：2026-08-23

```text
# Files mentioned by the user:

## codex-clipboard-5c0c1559-3314-460b-b770-431c39ba17ca.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5c0c1559-3314-460b-b770-431c39ba17ca.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论这个bug怎么又复现了，DeepSeek整理已结束还在提示整理中
```

截图目标区域：右侧“掌库 > 归档预览 > 本轮总览 > DeepSeek 辅助整理”。截图中“其他批次：第 2 批已整理”与“DeepSeek 正在依次整理本轮所有批次…”、“取消整理”同时出现；总览同时为“已汇总 2/2 批”“已处理 2572 条 · 已分类 2552 条 · 暂存 20 条”。截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5c0c1559-3314-460b-b770-431c39ba17ca.png`。待界面验收。

### R002

时间：2026-08-23

```text
检查有无其他类似缺陷
```

## 逐项索引表

| ID | 原文 | 精确目标 | 界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明并消除 DeepSeek 全轮整理已结束后仍提示“整理中”的回归。 | 右侧“掌库 > 归档预览 > 本轮总览 > DeepSeek 辅助整理”；工作区 `deepSeekRun` 快照、渲染器反馈状态与进度事件。 | 全部批次完成且没有正在运行的权威 `deepSeekRun` 时，不显示进行中文案或“取消整理”；运行中才显示。 | 服务清除检查点后重新读取并返回权威快照；渲染器把自然完成的工作区标记为终态，拒绝同工作区的迟到进度或旧 `running` 快照重新激活，只有用户显式重新开始/重试才可清除终态标记。 | 不新增或触发 DeepSeek 请求、B 站写入、创建、绑定、删除或迁移。 | 不改收藏夹同步预检、转写、视频同步或删除确认。 | 主进程 DeepSeek 服务、IPC 快照、渲染器 `useOldFavoriteWorkspace`、面板展示。 | 已实施，真实完成现场待验证。 | 代码：`electron/main/oldFavoriteWorkspaceDeepSeekService.ts` 清检查点后重新读取权威快照；`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts` 仅以 `running`/`waiting` 为活动态并保护终态。自动化：2026-08-23 服务/IPC/渲染器/确认区聚焦回归 244/244 通过；自然完成旧快照、迟到进度、前景返回旧运行快照均有回归。Electron 只读：`.codex-artifacts/2026-08-23-deepseek-completion-regression/electron-recovery-readonly.png` 显示恢复对话且没有 DeepSeek 进行中/取消入口；本次主窗口复查亦未见“正在整理”或“取消整理”。未点击恢复、重扫、放弃或任何远端动作。当前开发数据没有可安全重放的自然完成现场，故“真实全轮完成后撤销文案”仍待下一次不触发模型的测试数据验收。 |
| I002 | R002 | 检查整理收藏中是否还有同类“任务已结束、权威状态已收束，但界面仍显示进行中/操作仍被锁定”的缺陷。 | DeepSeek、标签补取、预览准备、B 站同步及其渲染器临时反馈。 | 只报告有代码证据的风险或已确认缺陷；不把异步运行中的真实状态误判为缺陷。 | `failed`、`canceled`、恢复 `paused` 以及自然完成均清活动标识并停止轮询；暂停投影不再保持执行锁。失败/取消的既有显式解决入口保留。 | 不触发真实 DeepSeek 或 B 站动作。 | 不改标签补取、预览准备、B 站同步、转写、视频同步、删除确认或同步预检逻辑。 | 工作区快照、IPC 进度、渲染器临时状态、确认区与轮询。 | 已实施，真实终态组合待验证。 | 代码：`src/shared/oldFavoriteWorkspace.ts` 增加 `paused` 快照状态；`electron/main/oldFavoriteWorkspaceCoordinator.ts` 投影暂停并移除其等待锁；`src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx` 只将 `running`/`waiting` 视为活动阻塞。自动化：同一聚焦回归 244/244 通过；主进程 `running`、`waiting`、`failed`、`canceled` 阻塞与恢复 `paused` 非运行投影定向回归 5/5 通过，确认区暂停回归通过。审计结论保持：扫描、标签补取、预览准备没有同等永久卡死证据；B 站同步仅有最多一轮轮询的低优先级陈旧 `executing` 风险，未扩大本轮修改。Electron 仅只读确认恢复入口；无法在不触发真实 DeepSeek 的条件下逐一构造失败/暂停/自动续跑失败的现场。 |

## 讨论结论与实施门槛

- 已确认：I001（R001）、I002（R002）。
- 待用户决定：无。
- 被明确替代：无。
- 明确不做：无。
- 用户已明确说“开始”。

## 实施计划（按原文顺序）

1. **I001 / R001 — 自然完成权威收束。** 允许修改`docs/项目功能项目书.md`、`electron/main/oldFavoriteWorkspaceDeepSeekService.ts`、`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`及其测试。全轮服务清除检查点后重新读取并返回权威快照；渲染器只以该快照投影终态，并在活动检查点出现时重新建立轮询。回归测试模拟“服务返回旧 running 快照、随后权威检查点已清除”的连续链路；Electron 只读查看全轮完成时无“整理中/取消整理”。不发起真实模型或 B 站操作。
2. **I002 / R002 — 同类 DeepSeek 终态保护。** 允许修改上述文件；如需投影恢复暂停，精确修改`src/shared/oldFavoriteWorkspace.ts`和`electron/main/oldFavoriteWorkspaceCoordinator.ts`中与`deepSeekRun`状态对应的独立片段，不触碰其现有同步前备册预检改动。覆盖迟到进度、自动续跑失败、恢复暂停；失败/取消仍保留原有显式解决流程，暂停不显示为运行也不保持轮询。执行相关 Vitest、类型构建及 Electron 只读验收。不会修改转写、视频同步、删除确认、DeepSeek 请求实现或收藏夹同步预检逻辑。
