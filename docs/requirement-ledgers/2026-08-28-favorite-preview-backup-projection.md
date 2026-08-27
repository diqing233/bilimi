# 收藏夹归档预览与备册投影需求账本

> 讨论开始：2026-08-28。讨论模式仅记录原文、读取证据和讨论方案，不修改功能代码。

## 原文区

### R001

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-9777247d-b139-4fc9-b1f2-e9dcbfc702b5.png`

截图目标：`整理收藏 → 归档预览 → 本轮总览`。上方推荐收藏夹已勾选；下方汇总中 `bilimi·honker233` 显示“预计归档 0 条”。用户要求检查该 0 条为何不符合推荐收藏夹数据，并指出“确认同步到b站”没有提示备册这两个已勾选收藏夹；即使归档数为 0，只要勾选也要备册。

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-3cca598e-ac6b-4c18-bd8e-311dfe6c6429.png`

截图目标：同一归档预览汇总。用户自行创建收藏夹“原神”后，`bilimi·原神`预计归档 257 条，原先为 0 的推荐收藏夹 `bilimi·honker233` 与 `bilimi·哈米伦的弄笛者`分别变为 34 条和 14 条。

```text
图一继续检查归档预览为什么是0不符合推荐收藏夹数据，确认同步到b站没有提示备册这两个收藏夹（只要勾选就要备册，哪怕是0）
图二发现一个令人惊讶的地方，我自己创建收藏夹原神归档预览正常，并且让原来为0的推荐收藏夹数据变为正常
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001（图一、图二） | 查明：已勾选推荐收藏夹的归档预览为何先显示 0 条，而在另行创建“原神”规则后才恢复为非 0；预览必须使用当前权威的推荐采用、参与规则和完整分类结果，不能依赖后续无关规则目录变化才刷新。 | 整理收藏 → 推荐收藏夹；归档预览 → 本轮总览；主进程工作区分类与聚合快照。 | 仅限当前轮已勾选/已采用推荐收藏夹；0 条必须是真实完整分类后无成员，不能是遗漏投影或过期快照。 | 推荐项勾选后完成本地采用和重分类，再以同一权威快照更新归档预览；新建其他规则不得成为推荐项数据恢复的隐含触发器。 | 当前为本地数据与投影排查；不得因检查创建、绑定、删除 B 站收藏夹或写入视频。 | 不修改正常的上方规则勾选/取消、删除模式、DeepSeek、转写、视频同步与无关 UI。 | 推荐采用事务、分类队列、工作区快照、归档汇总投影。 | 已实施待验证 | 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:4767` 保留完整分类快照，`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:1469` 传递候选→已保存规则映射，`OldFavoriteArchivePreviewStep.tsx:137` 与 `OldFavoriteOverviewControls.tsx:51` 将候选目标规范化并合并分段计数。测试：协调器 `projects adopted recommendation members into the archive overview immediately` 通过；渲染回归 `keeps a recommendation-linked saved rule visible when the classification uses the candidate id` 通过；归档预览/确认 75 项通过。Electron 真实数据尚未执行。 |
| I002 | R001（图一） | 确认并同步到 B 站的备册预检必须把所有本轮已勾选收藏夹纳入备册范围，即使该收藏夹本轮预计归档为 0 条；提示应一次覆盖这两个已勾选而未备册的收藏夹。 | 整理收藏 → 确认执行 → 确认并同步到 B 站 → 同一备册确认窗口。 | 规则已勾选但本轮成员数为 0 时仍须列入备册预检；未勾选、远端草稿和已删除规则不纳入。 | 点击同步时按当前勾选集合生成备册清单；有未备册目标时显示一次确认，确认后才开始既有本地保存、备册与同步顺序。 | 实际 B 站写入仅在用户确认后发生；本轮检查不触发真实创建、绑定、删除、移动或视频写入。 | 不改变“暂存默认不写视频”、既有单窗口确认、未绑定候选知情同意和已备册规则的同步逻辑。 | 规则参与集、同步前备册投影、确认窗口与绑定/分册预检。 | 已实施待验证 | 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:4767-4777` 将 `participatingSavedLedgerIds` 与实际 assignment 分离，0 条目标仍进入 `missingLedgers`，视频写入仍由 assignments 决定。测试：`includes every selected saved rule in backup preflight even when it has zero archive members` 通过；协调器全量 352 项、备册 API 197 项、同步服务 68 项、上方概览 114 项、能力/目标规划/动作执行/App 152 项通过。Electron 真实确认窗口及 B 站副作用未执行。 |
