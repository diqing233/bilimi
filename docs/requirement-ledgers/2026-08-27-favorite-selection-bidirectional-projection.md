# 收藏夹上下勾选双向投影需求账本

> 讨论开始：2026-08-27。该文件的“原文区”逐条保留本轮从首次提出主题到用户明确说“开始”为止的用户消息；讨论模式不修改功能代码。

## 原文区

### R001

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-1b3e5f7f-bef8-4c1d-b906-e5ac1332bf45.png`

截图目标：上方已保存收藏夹区域与下方“整理收藏 → 推荐收藏夹”区域。图中上方取消勾选后的规则仍显示，但下方同一规则的推荐项仍为勾选状态；需以同一稳定规则 ID核对这两个投影。

```text
图一，你现在是把勾选功能单独摘出来了吗，上分收藏夹区域取消勾选，可以看到下边整理收藏区域推荐收藏夹仍在勾选

我最初的设计是

上方取消某个已保存规则的勾选，下方对应项也必须变为未勾选。但是上分不删除

- 之后从下方重新勾选，应让上方对应的已保存规则恢复勾选；不能产生同名重复规则。
```

### R002

```text
讨论模式
```

### R003

截图：`C:\Users\diqing\AppData\Local\Temp\codex-clipboard-9a1af570-264b-491d-a93e-c19746ef8d34.png`

截图目标：整理收藏 → 归档预览的“改动记录”。当前依次显示“高置信度自动分类 24 条：…”与多条“收藏夹规则与勾选已更新”，无法看出一次勾选或取消勾选实际使哪些视频从哪个收藏夹自动分类到哪个收藏夹。

```text
改动记录上一轮没改吗，还是一堆勾选已更新，应该合并成一次分类效果或者描述清楚，勾选后，自动分类从哪到哪，取消勾选后从哪到哪，现在完全看不出来
```

### R004

```text
讨论的这两个先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）
```

## 逐项索引

| ID | 原文 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001、R004 | 上方已保存规则取消后，下方同一稳定规则 ID 的推荐投影必须立即为未勾选；上方规则不删除。随后从下方重新勾选同一 ID 时，恢复上方已保存规则勾选，不能生成同名重复规则。 | 掌库 → 上方收藏夹规则卡；整理收藏 → 推荐收藏夹卡；账号级 `enabled`、本轮排除集合、推荐采用集合与工作区权威快照。 | 仅当上下投影解析为同一稳定规则 ID时联动；纯推荐草稿继续使用其原有取消语义。 | 上方取消：持久化该已保存规则的未参与状态，并把下方对应推荐采用状态投影为未勾选；下方重新勾选：恢复该已保存规则参与状态。两个入口均以主进程同一权威快照回传，失败时回滚且不阻塞鼠标、滚动或窗口操作。 | 账号级勾选状态持久化；不创建、绑定、删除 B 站收藏夹，不写入视频。 | 上方取消不删除规则；不以同名、`syncState`、绑定状态或远端 ID猜测对应关系；不改变独立删除模式、DeepSeek、转写、视频同步或备册确认。 | `ControlledFavoriteLedgerPanel` 上下投影映射、`useOldFavoriteWorkspace` 推荐采用/排除命令、`FavoriteLedgerOverview` 上方切换和主进程工作区协调器。 | 已实施，真实联动界面验收受当前账号状态限制 | 代码、自动化和只读 Electron 证据见本文件“实施与验证证据（2026-08-27）”；未执行 B 站副作用。 |
| I002 | R003、R004 | 一次上方/下方勾选或取消勾选造成的规则状态变化、推荐采用变化、排除变化与自动分类移动只显示为一条改动记录。记录须明确该动作后自动分类的视频数量及来源目标、去向目标；不得再插入多条无法解释分类效果的“收藏夹规则与勾选已更新”。 | 整理收藏 → 归档预览 → 改动记录 / 历史游标；规则状态与分类 history entry。 | 有视频分类移动时显示一条可读的“勾选/取消 [规则名] 后，自动分类 N 条：来源 → 去向”效果记录；没有移动时记录单一、明确的规则参与状态变化，不产生空泛重复条目。 | 勾选和取消都以同一事务采集操作前后分类差异、推荐采用状态和排除状态；恢复该条目时一次性恢复三者。 | 只影响本地历史投影与恢复；不创建、绑定、删除 B 站收藏夹，不写入视频。 | 不改人工移动、DeepSeek、删除确认、备册、同步执行与历史恢复边界；继续中文、单行截断和悬浮全文。 | 上方/下方勾选双向联动（I001）、`setRecommendedCandidates`、`setRoundExcludedLedgerIds`、规则 enabled IPC、`recordFavoriteLedgerHistoryChangeUnsafe` 与改动记录中文投影。 | 已实施，真实改动记录界面验收受当前账号状态限制 | 代码、自动化和只读 Electron 证据见本文件“实施与验证证据（2026-08-27）”；未执行 B 站副作用。 |

## 诊断证据（2026-08-27）

### I001

- 项目书 / 契约：项目书 §5.5“勾选推荐 / 上方卡片勾选”及收藏夹契约 §3.3均要求同一稳定规则 ID 的上、下投影共用本轮参与状态；因此截图状态不符合既有设计，不需要改写设计目标。
- 当前账号只读快照：`C:\Users\diqing\AppData\Roaming\bilimi-dev\config.json` 中的 `bilimi·honker233` 本地卡片 ID 为 `custom-author-honker233-小王爱马枪~9.2d`，`enabled=false`、`ruleOrigin=recommendation-draft`。当前工作区 overlay 的同一候选 ID仍在 `adoptedCandidateIds`，并同时位于 `excludedLedgerIds`；这正对应“上方未勾选、下方仍勾选”。
- 代码位置与原因：`ControlledFavoriteLedgerPanel.tsx` 的 `isSavedUpperLedger` / `createRecommendationProjection`只将`ruleOrigin !== recommendation-draft`的规则纳入候选—上方卡映射；但 `organizationSavedLedgerEnabledById`又把所有上方显示卡纳入上方参与入口。故上述实际 ID从上方取消时只写排除和 enabled，不会从推荐采用集合移除。`OldFavoriteRecommendationStep.tsx`直接以 `adoptedCandidateIds` 决定下方 checkbox，因而保留勾选。该不一致不涉及 B 站。
- 待实施方向：允许“显示于上方、且与候选 ID精确相同”的推荐草稿建立**精确 ID**映射，使上方入口同步采用集合；下方入口仍仅在该项是纯推荐草稿时执行取消即删草稿。不得扩展为同名/语义猜测绑定，不得修改远端、删除模式、DeepSeek、转写或视频同步。

### I002

- 截图复现：改动记录当前交错出现两条“高置信度自动分类 24 条：… → …”和七条“收藏夹规则与勾选已更新”。后者既未指明是勾选或取消，也没有规则名、参与状态或分类前后目标；因此无法把一组记录还原为一次用户操作。
- 上一轮并非完全没有处理：提交 `82931022` 为 `setRecommendedCandidates`、`setRoundExcludedLedgerIds`、`assistant:write-favorite-ledger-enabled` 新增了 `mergeFavoriteRuleHistory`，并使 `recordFavoriteLedgerHistoryChangeUnsafe` 可以在指定时合并“当前最后一条”历史记录。这只覆盖了恰好相邻且顺序不变的部分路径，未建立一次勾选/取消的原子历史事务。
- 实际写入链路：一次上方参与状态改变按顺序执行 `setRecommendedCandidates` → `setRoundExcludedLedgerIds` → `assistant:write-favorite-ledger-enabled`；三步都各自捕获 before/after 状态并可能调用 `recordFavoriteLedgerHistoryChangeUnsafe`。前两步还会经过推荐采用差量与分类重算。当前合并条件只查看最新历史项、只在调用方传入 flag 时生效，不能证明三次写入属于同一操作，故可残留多个空 `favorite-rules` 记录，或使分类记录与规则记录交错。
- 显示层也仍保留了泛化文案：`OldFavoriteArchivePreviewStep.tsx` 的 `historyLabel` 对所有 `entry.source === 'favorite-rules'` 无条件返回“收藏夹规则与勾选已更新”，即使该记录携带或相邻携带分类变化，仍不会显示规则、动作、数量和 `从 → 到`。
- 根因结论：问题不是 CSS 截断或历史恢复显示缺字，而是“规则参与变更 + 本轮排除 + 推荐采用 + 重分类”被实现为多个独立持久化命令，界面只能看到无语义的碎片。应以一次主进程事务采集操作前后权威快照、分类差异和恢复状态，并仅写一个含分类变化与规则状态的历史项；显示层据该单项生成“勾选/取消〈规则〉后，自动分类 N 条：来源 → 去向”。无视频移动时才显示一条明确的“〈规则〉已勾选/取消，本轮未产生分类移动”。
- 该修复必须继续把 `favoriteRuleState` 与分类 changes 放在同一可恢复游标中：恢复时同时还原规则 enabled、推荐采用、排除集合和当次分类，且不触发 B 站创建、绑定、删除或视频写入。

## 实施与验证证据（2026-08-27）

### I001：同稳定规则 ID 的上下勾选投影

- 代码位置：`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx` 的 `setOrganizationRecommendedCandidates`、`setOrganizationSavedLedgerParticipation`、推荐勾选处理器与批量选择处理器。上方入口对候选仅做 `candidate.id === ledger.id` 的精确 ID 回退，并向草稿投影传入正确字段 `retainLinkedSavedLedgerIds`；下方入口只在当前轮排除集合明确包含同 ID 时回写上方参与状态。纯推荐草稿不满足这一事实时仍保持原有“取消即删草稿”语义。
- 自动化：`npx vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot`，`158 passed`。其中覆盖同 ID 上方取消保留规则、下方重新勾选恢复上方、纯推荐草稿取消仍删除、未绑定推荐保持原有行为；套件有既有 React `act(...)` 警告，但无失败。
- Electron 只读：开发版掌库已读取，收藏夹规则卡、未备册状态与禁用的“移出同步”控件正常呈现；截图：`.codex-artifacts/2026-08-27-i001-i002-electron-top-ledgers.png`。当前账号没有 `previewing` 整理草稿，所有上方“移出同步”控件禁用，故不能在不更改用户账号级勾选状态的前提下验证“上方取消 → 下方未勾选 → 下方恢复”的真实点击链路，也不能实测该异步队列下的鼠标/滚动体验。
- 副作用边界：本轮仅执行自动化测试与 Electron 只读查看；没有创建、绑定、删除 B 站收藏夹，也没有 B 站视频写入。

### I002：单条、可恢复的中文分类效果记录

- 代码位置：`electron/main/oldFavoriteWorkspaceCoordinator.ts` 将合并后的分类历史条目统一标为 `favorite-rules`，从同一 `favoriteRuleState` 与 `changes` 推导紧凑动作及来源→去向分组；`src/shared/oldFavoriteWorkspace.ts` 为快照摘要声明 `favoriteRule`；`src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx` 优先显示中文动作、规则名、总数量和分组，继续使用单行截断及 `title` 全文。
- 自动化：`npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts --reporter=dot`，`339 passed`；`npx vitest run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx --reporter=dot`，`35 passed`。两组还验证规则状态与分类 changes 可在同一游标恢复，以及无移动时的单条中文状态文案。
- Electron 只读：与 I001 使用同一开发版截图。当前没有可读取的历史预览草稿，故新版中文改动记录在真实草稿中的视觉文本、单行截断和悬浮全文不能安全验证；渲染器测试已覆盖该格式。
- 副作用边界：历史投影和恢复仅处理本地工作区状态；本轮没有创建、绑定、删除 B 站收藏夹，也没有 B 站视频写入。

### 全轮回归

- 聚焦回归三组均通过：主进程协调器 `339 passed`、上方联动面板 `158 passed`、归档预览 `35 passed`。
- `npm test -- --reporter=dot`：`240 passed` 测试文件、`4105 passed` 测试，耗时 `342.07s`。输出仍包含既有 B 站失败模拟日志、React `act(...)` 警告与一条现存跨组件 `setState` 警告，但没有失败。
- `npm run build`：通过（Electron main、preload 与 renderer 构建完成）。
