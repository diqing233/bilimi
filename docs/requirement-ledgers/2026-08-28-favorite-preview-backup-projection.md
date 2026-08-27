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

### R002

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-41bf6f61-fb1c-41e4-acbe-34145e224117.png`

截图目标：`整理收藏 → 归档预览 → 本轮总览`及“同步前备册确认”弹窗。弹窗列出多个未备册收藏夹；归档预览中 `bilimi·honker233` 与 `bilimi·杨颜同学`仍显示“预计归档 0 条”。

```text
你没修吗，以前都可以为什么现在不行，上一轮问题也说得很清楚了吧
```

### R003

```text
讨论有备册提示了归档预览为什么还是0
```

### R004

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-1a85a842-634f-4125-ab21-c9692452fa86.png`

截图目标：`整理收藏 → 确认执行 → 同步前备册确认`与其后的`归档预览`列表。确认窗口把`bilimi·honker233`与`bilimi·哈米伦的弄笛者`列为`未备册`，但右侧归档预览的相同两个收藏夹显示`预计归档 0 条`。用户本条未附加文字。

```text

```

### R005

```text
我自己创建收藏夹会让原来为0的推荐收藏夹数据变为正常，能不能参考下
```

## R002 逐项索引追加

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I003 | R002 | 推荐候选已采用且本地命中非 0 时，分类 journal、归档预览和同步前备册预检必须在同一权威快照中反映实际成员；不得出现采用状态已持久化但目标仍为 0 的中间结果。 | 推荐采用命令、工作区分类 journal、归档预览 `archiveTargets`、同步前备册确认。 | 仅针对本轮已采用并仍参与的推荐候选；真正无命中时才显示 0。 | 采用/重新勾选必须等待分类结果提交后再发布最终推荐快照；若队列竞态导致采用集合变化，必须按最新集合重算，不得用旧分类覆盖新状态。 | 仅修改本地分类与投影；不创建、绑定、删除、移动 B 站收藏夹，不写视频。 | 不改上方已保存规则勾选/取消、删除模式、DeepSeek、转写、视频同步执行、单个备册入口及其他主题文件。 | `setRecommendedCandidates`、`applyRecommendedLedgerDeltaUnsafe`、`setRoundExcludedLedgerIds` 的推荐快照传递、推荐持久化队列、分类 journal、归档/备册投影。 | 已实施待验证 | RED：原备册预检测试只返回 `game`，未返回已采用本地推荐；GREEN 后 `includes an adopted local recommendation in backup preflight even when its archive count is zero`、`keeps adopted recommendation assignments when round participation is refreshed` 通过。Electron 只读证据为 `.codex-artifacts/2026-08-28-favorite-round-readonly.png` 与 `.codex-artifacts/2026-08-28-favorite-round-readonly-scroll.png`；未执行真实 B 站创建、绑定、删除、移动或视频写入。 |
| I004 | R003、R004、R005 | 查明并消除“同步前备册确认已把同一已采用推荐规则列为未备册，归档预览却为 0 条”的跨投影不一致；以上方自行新建收藏夹后旧推荐项恢复计数的完整重分类路径作为正确性参照，但不得因此令推荐项勾选阻塞或卡顿。 | 整理收藏 → 归档预览；确认执行 → 同步前备册确认；工作区推荐状态、分类 journal、上方已保存规则目录。 | 同一稳定规则 ID在本轮已采用、未取消且其扫描匹配 AID非 0 时，预览必须显示其实际归档数；真正无匹配才显示 0。 | 备册预检和归档预览必须读取同一规则 ID映射与同版分类快照；不能仅让备册侧修复为“已识别”而遗漏分类投影。 | 本轮仅验证本地投影；未创建、绑定、删除、移动 B 站收藏夹，未写视频。 | 不改 DeepSeek、转写、删除模式、视频同步、单个收藏夹备册入口或无关功能。 | 推荐采用/规则 ID映射、`classifications.targetLedgerIds`、归档汇总投影、同步前备册预检；上方新建规则的 `createLocalLedgerAndReclassify` 全轮重分类路径。 | 已实施；真实远端副作用与实际勾选性能待验证 | 代码：`OldFavoriteOverviewControls.tsx:52-87`仅汇总主进程`overview.archiveTargets`；`OldFavoriteArchivePreviewStep.tsx:135-152`只读取快照`adoptedCandidateIds`；`OldFavoriteConfirmationStep.tsx:241,391`不再传递渲染器局部推荐选择。RED：空局部选择时归档数被过滤为 0 / 当前批被误投未匹配；GREEN：`OldFavoriteConfirmationStep`、`OldFavoriteArchivePreviewStep` 77 项，含“33 条仍显示”与当前批保留已采用推荐。回归：受影响面板、预览、确认 240 项；完整`npm test` 240 文件、4,130 项；`npm run build`均通过。Electron 只读：`.codex-artifacts/2026-08-28-authoritative-recommendation-archive-projection.png`中`bilimi·honker233`显示 33 条（第 1 批 23、第 2 批 10），而`bilimi·你好`保持真实 0。未点击备册确认、创建、绑定、删除或同步；因此未验证真实 B 站副作用，也未通过真实推荐勾选操作量化鼠标不卡。 |

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001（图一、图二） | 查明：已勾选推荐收藏夹的归档预览为何先显示 0 条，而在另行创建“原神”规则后才恢复为非 0；预览必须使用当前权威的推荐采用、参与规则和完整分类结果，不能依赖后续无关规则目录变化才刷新。 | 整理收藏 → 推荐收藏夹；归档预览 → 本轮总览；主进程工作区分类与聚合快照。 | 仅限当前轮已勾选/已采用推荐收藏夹；0 条必须是真实完整分类后无成员，不能是遗漏投影或过期快照。 | 推荐项勾选后完成本地采用和重分类，再以同一权威快照更新归档预览；新建其他规则不得成为推荐项数据恢复的隐含触发器。 | 当前为本地数据与投影排查；不得因检查创建、绑定、删除 B 站收藏夹或写入视频。 | 不修改正常的上方规则勾选/取消、删除模式、DeepSeek、转写、视频同步与无关 UI。 | 推荐采用事务、分类队列、工作区快照、归档汇总投影。 | 已实施待验证 | 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:4070` 推荐采用重分类、`electron/main/oldFavoriteWorkspaceCoordinator.ts:3587` 刷新参与规则时复用同一推荐快照，`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:1469` 传递候选→已保存规则映射，`OldFavoriteArchivePreviewStep.tsx:137` 与 `OldFavoriteOverviewControls.tsx:51` 合并分段计数。测试：协调器 `projects adopted recommendation members into the archive overview immediately`、`keeps adopted recommendation assignments when round participation is refreshed` 通过；渲染 `ControlledFavoriteLedgerPanel`、归档预览/确认共 238 项通过。Electron 已完成只读截图 `.codex-artifacts/2026-08-28-favorite-round-readonly.png`；未执行真实 B 站副作用。 |
| I002 | R001（图一） | 确认并同步到 B 站的备册预检必须把所有本轮已勾选收藏夹纳入备册范围，即使该收藏夹本轮预计归档为 0 条；提示应一次覆盖这两个已勾选而未备册的收藏夹。 | 整理收藏 → 确认执行 → 确认并同步到 B 站 → 同一备册确认窗口。 | 规则已勾选但本轮成员数为 0 时仍须列入备册预检；未勾选、远端草稿和已删除规则不纳入。 | 点击同步时按当前勾选集合生成备册清单；有未备册目标时显示一次确认，确认后才开始既有本地保存、备册与同步顺序。 | 实际 B 站写入仅在用户确认后发生；本轮检查不触发真实创建、绑定、删除、移动或视频写入。 | 不改变“暂存默认不写视频”、既有单窗口确认、未绑定候选知情同意和已备册规则的同步逻辑。 | 规则参与集、同步前备册投影、确认窗口与绑定/分册预检。 | 已实施待验证 | 代码：`electron/main/oldFavoriteWorkspaceCoordinator.ts:4740-4788` 让已采用本地推荐与上方参与集共同进入 `selectedLogicalLedgerIds`，0 条目标仍进入 `missingLedgers`；`electron/main/index.ts:2407-2430` 仅将无真实远端 ID 的本地推荐列入已保存列表，远端草稿继续过滤。测试：`includes every selected saved rule in backup preflight even when it has zero archive members`、`includes an adopted local recommendation in backup preflight even when its archive count is zero` 及协调器全量 354 项通过；备册 API、同步服务和归档预览/确认回归 379 项通过。Electron 截图见 `.codex-artifacts/2026-08-28-favorite-round-readonly.png`；真实确认窗口和 B 站副作用未执行。 |
