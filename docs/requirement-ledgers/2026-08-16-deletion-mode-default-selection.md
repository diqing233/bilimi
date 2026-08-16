# 本轮需求账本：删除模式默认收藏夹选择

## 原文区

### R001

用户原文：

```text
你怎么前改后删呢，现在删除模式为什么不能点默认收藏夹，全选/取消全选
```

### R002

用户截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-bef37b39-a21d-4ee0-88cb-041a40fed265.png`

用户原文：

```text
1采用当前标签点击没效果
2点击后当前批次有推荐收藏夹，本轮总览却没有
3推荐收藏夹未备册直接删除功能丢失
```

### R003

用户截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-18b8c1a4-90ae-429d-8fe8-b0d275eac64b.png`

用户原文：

```text
我在上面删除下面没有跟着取消勾选，
反倒勾选后再也无法生成了
你改了个啥
怎么全都是bug
```

### R004

用户原文：

```text
采用当前标签以前还正常着，当时的效果是什么
```

### R005

用户原文：

```text
你把之前正常的功能过一遍再改，确保不要再发生这种bug了，agents.md你没读吗
```

### R006

用户原文：

```text
这些以前设计好的功能你为什么总是问我，你自己查
```

### R007

用户原文：

```text
你查到什么了我先看看你是不是搞错了
```

### R008

用户原文：

```text
我大概说一下，不一定完全准，你查下这些功能还在吗
本轮总览，一般情况是每批视频视频标签扫描结束更新一次
点击采用当前标签之后，按钮消失，推荐收藏夹和归档预览同时按照当前已有信息更新
```

### R009

用户原文：

```text
改一个功能时，必须检查它对上下游功能、设置、数据迁移、持久化和性能的影响。不能只修当前页面而导致其他已实现功能失效。

对于成熟且不属于当前改造范围的功能，应视为受保护子系统：尽量不修改其内部实现，并运行相关回归测试，确认入口、数据和交互仍正常。

不能仅凭测试通过宣称鼠标不卡或真实操作流畅。涉及性能和交互响应的修改，必须在真实 Electron 开发版中验证鼠标移动、点击、滚动、窗口缩放、最小化和关闭等操作。
```

## 逐项索引表

| 条目 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 删除模式下默认收藏夹可以单选，并参与顶部“全选/取消全选”；退出删除模式后恢复普通状态。 | `FavoriteLedgerOverview` 删除模式条目状态、默认收藏夹操作按钮、批量选择汇总。 | 仅删除模式解除默认项的选择禁用；普通整理/备册模式继续保持默认体系的强制勾选和保护。 | 默认收藏夹可加入/取消删除；全选和取消全选覆盖所有可删除选择项，包括默认收藏夹；删除流程继续沿用现有默认收藏夹恢复默认/远端删除分支。 | 不改变现有删除弹窗、本地规则、收藏库或 B 站副作用；只修复删除模式选择状态。 | 不修改普通同步勾选、备册条件、默认收藏夹体系开关和其他收藏夹删除判断。 | `enableEntries`、`FavoriteLedgerEnableStore.toggleAll`、删除模式 `deletionStore`、默认收藏夹删除计划。 | 已实施待界面验证 | `FavoriteLedgerOverview.tsx` 的 `enableEntries`：删除模式条目始终可操作且不再批量强制勾选；新增回归 `includes protected default ledgers in deletion-mode single and bulk selection` 先红后绿。`npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`：97/97 通过；真实 Electron 待本轮末尾验证。 |
| I002 | R002-1 | 点击“采用当前标签”必须实际接受当前标签，并刷新当前工作区的推荐结果，不得静默无变化。 | `OldFavoriteScanOverviewStep` 操作按钮、`useOldFavoriteWorkspace.sendTagEnrichmentCommand`、`OldFavoriteWorkspaceCoordinator.acceptCurrentTags`。 | 仅对当前存在且可接受的标签补取状态生效；失败必须保留原有错误提示链路，不能静默吞掉异常。 | 接受当前标签后重建推荐索引/候选并返回最新快照，后续当前批次与本轮总览使用同一份最新推荐状态。 | 持久化标签接受事件和推荐覆盖层；不得丢失已选推荐和已有整理草稿。 | 不改标签扫描、暂停/继续、失败重试的既有语义。 | `acceptCurrentTags`、推荐索引、快照生成、渲染层错误反馈。 | 待用户确认后实施 | 已定位代码缺口：接受流程只刷新旧推荐状态；渲染层 catch 静默返回 `null`。尚未修复或验证。 |
| I003 | R002-2 | 当前批次出现的推荐收藏夹，在本轮总览中也必须按实际聚合状态显示；两种视图不能因快照滞后分叉。 | `OldFavoriteRecommendationStep` 当前/总览切换、`createOverviewProjection`、`recommendationCounts`。 | 当前批次按当前段计数；本轮总览按已完成批次聚合；接受标签或批次完成后应更新聚合。 | 切换视图不重新猜测数据，均读取同一工作区最新推荐状态；被勾选候选即使暂时计数为 0 也保留。 | 聚合结果随工作区快照持久化/恢复；不改变推荐候选 ID 或已选状态。 | 不把未完成批次伪造为已完成统计，不修改用户明确的当前批次/本轮视图入口。 | `createOverviewProjection`、`OldFavoriteRecommendationStep.countForCandidate`、`snapshot.overview.recommendationCounts`。 | 待用户确认后实施 | 已定位旧测试覆盖“总览 recommendationCounts 为空时不显示未勾选当前候选”；需按本轮实际要求补充一致性测试。 |
| I004 | R002-3 | 未备册推荐收藏夹删除时继续直接删除本地草稿/规则；已备册或未绑定推荐仅取消勾选，不误删本地保存项。 | `FavoriteLedgerOverview` 删除计划分流、`isRecommendationCancellationOnly`、`finalizeManagedDeletionPlan`。 | `bindingState === unbacked` 或缺失远端绑定走直接删除；其他已保存推荐走取消推荐；删除完成后推荐勾选必须同步取消。 | 删除完成必须等待推荐取消队列确认，再重置上方/下方状态；删除模式退出后可重新勾选并生成。 | 未备册分支删除本地持久化草稿/规则；取消勾选分支保留本地收藏夹；不新增 B 站副作用。 | 不改变普通收藏夹删除、默认收藏夹远端删除和其他删除弹窗规则。 | `isRecommendationCancellationOnly`、删除计划、`onDeleteLedger`、推荐保存队列。 | 已实施待界面验证 | `FavoriteLedgerOverview.tsx` 的 `finalizeManagedDeletionPlan` 现在等待每个已删除持久项的 `onDeleteLedger`，返回 `false` 会进入既有失败提示且不退出删除模式。新增 `waits for unbacked recommendation cleanup before leaving deletion mode` 先红后绿；`local-draft` 不投影为已保存推荐由既有 `ControlledFavoriteLedgerPanel` 回归覆盖。`npm test -- --run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx --reporter=dot`：235/235 通过（现有测试产生 5 组 React act 警告，非本轮新增）。真实 Electron 待本轮末尾验证。 |
| I005 | R004 | 恢复“采用当前标签”的历史语义：接受当前批次已有标签，保留未读取项继续后续补取，并立即用当前已知标签重建推荐和当前批次分类结果。 | `OldFavoriteScanOverviewStep` 的“采用当前标签”、`OldFavoriteWorkspaceCoordinator.acceptCurrentTags`、标签接受持久化事件、推荐快照。 | 只接受当前批次；其他批次未读取项继续保持待补取/运行状态；按钮执行失败必须显示错误，不得静默无效。 | 接受后当前批次进入可继续整理状态，推荐收藏夹立即按当前已知标签更新，系统分类重新计算当前批次；后续可恢复补取剩余批次。 | 持久化 `accept-segment` 事件、标签状态、推荐覆盖层和分类结果；不得清空已选推荐或草稿。 | 不把“采用当前标签”变成全轮接受，不跳过后续批次补取，不改按钮文案。 | `acceptedSegmentIds`、`refreshRecommendationsAfterTagEnrichment`、`rebuildRecommendationsAfterTagBatch`、`autoClassifyCurrentSegmentUnsafe`。 | 待用户确认后实施 | 历史提交 `5d396178`/`35b82622` 曾在接受后重建推荐；当前实现只刷新已有推荐状态且渲染层静默吞错。 |
| I006 | R005 | 实施前必须完整回读 `AGENTS.md`、本轮账本原文与索引、历史正常实现和现有测试；实施后逐条回读原文验收，不得只修表面症状。 | 本轮实施流程、需求账本、受保护的整理/推荐/删除上下游模块。 | 讨论阶段不改业务代码；只有用户明确说“开始”后实施；中断、截图、重启或发现未提交改动后重新核对。 | 先形成按 R001-R005 顺序的确认清单和计划，再逐项修改；每项单独记录代码位置、测试和界面验收证据。 | 账本与代码同一主题同一提交；不扩大到未确认功能，不覆盖其他主题未提交改动。 | 不用测试通过替代真实 Electron 验收；无法验证的条目必须明确报告，不能声称全部完成。 | `AGENTS.md`、本账本、历史提交、定向 Vitest、Electron 开发版。 | 已确认待实施 | 已重新读取 `AGENTS.md`、账本全文和当前工作树；业务代码尚未修改。 |
| I007 | R006 | 已有历史设计的功能由代码、历史提交和既有账本自行核对，不重复向用户确认；只有代码与既有原文无法判定的新歧义才提问。 | 本轮需求核对与实施计划。 | “当前批次”与“本轮总览”沿用既有规则：前者显示当前批次，后者显示本轮所有批次；不再列为待决定。 | 实施前先回看历史实现和测试，按既有行为恢复并补回归保护。 | 不改变既有已确认的批次视图语义。 | 不把已确认设计重新包装成新选项，不扩大本轮功能范围。 | 历史账本、历史提交、现有测试、R001-R005。 | 已确认待实施 | R002-2 已依据既有设计解决：本轮总览按本轮所有批次聚合，不能因为当前快照滞后而漏掉已产生候选。 |
| I008 | R008-1 | 一般情况下，每批视频的标签扫描结束后，本轮总览更新一次。 | `OldFavoriteWorkspaceCoordinator.recordTagEnrichment/recordTagEnrichmentFailure`、`createOverviewProjection`、渲染层本轮总览。 | 仅把实际已经完成标签扫描的批次计入本轮总览；未完成批次不能伪装成完成。 | 每批从 tagging/等待变为 ready 后，推荐计数、归档目标和总览批次计数使用同一最新快照刷新；切换批次不应阻断后台补取。 | 结果写入工作区 overlay/推荐状态并可恢复；不改变标签补取失败、暂停、恢复和 B 站副作用。 | 不把全轮结束作为唯一刷新时机；不改变当前批次与本轮总览的范围定义。 | `newlyReadySegmentIds`、`rebuildRecommendationsAfterTagBatch`、`createOverviewProjection`、`useOldFavoriteWorkspace` 后台刷新。 | 待用户确认后实施 | 当前代码只在当前批次完成或全部 pending 清空时重建推荐；非当前批次 ready 时仅通知 DeepSeek，存在总览滞后风险。 |
| I009 | R008-2 | 点击“采用当前标签”后按钮消失。 | `OldFavoriteScanOverviewStep` 标签补取操作区、`acceptCurrentTags` 返回快照。 | 仅当前批次接受成功后隐藏；失败或仍未接受时保留按钮和原有错误提示。 | 持久化当前批次 `acceptedSegmentIds`，并返回更新后的工作区快照。 | 保留未读取的其他批次补取状态，不把当前接受误变成全轮接受。 | 不改按钮文字，不用额外“待对账”提示替代真实状态。 | `tagEnrichment.status`、`acceptedSegmentIds`、IPC command snapshot。 | 已存在但待验证 | 当前渲染条件为 `tagEnrichment.status !== 'accepted'`；接受命令末尾返回新快照，按钮隐藏逻辑仍在。 |
| I010 | R008-3 | “采用当前标签”后，推荐收藏夹和归档预览同时按当前已有信息更新。 | `acceptCurrentTags`、推荐步骤、归档预览步骤、共享 `OldFavoriteWorkspaceView` 快照。 | 两个页面读取同一最新快照；已知标签立即生效，未读取标签不被伪造为已完成。 | 接受后重建推荐候选、当前批次系统分类及归档目标投影；已选推荐保持。 | 推荐覆盖层和分类结果持久化；不清空草稿、不改变 B 站同步边界。 | 不只刷新推荐页面，不让归档预览继续使用旧快照；不静默吞掉刷新错误。 | `refreshRecommendationsAfterTagEnrichment`、`rebuildRecommendationsAfterTagBatch`、`createOverviewProjection`、`useOldFavoriteWorkspace.sendTagEnrichmentCommand`。 | 待实施待验证 | 当前 `refreshRecommendationsAfterTagEnrichment` 只把内存中的旧推荐状态写回 overlay，没有重新由更新后的索引构建候选；因此推荐/归档联动不完整。 |
| I011 | R009 | 本轮修改必须检查上下游、设置、数据迁移、持久化、性能和受保护子系统；涉及交互性能须真实 Electron 验收。 | 本轮实施方案、测试和验收记录。 | 不因局部修复改变非本轮功能的入口、数据或交互。 | 修改前明确受影响链路；修改后运行对应回归，并在开发版验证鼠标移动、点击、滚动、窗口缩放、最小化和关闭。 | 覆盖工作区 journal/overlay、推荐保存、分类、恢复、标签补取与 B 站执行边界。 | 不修改成熟且不属于本轮范围的子系统内部实现，除非证据表明它是根因。 | 标签扫描服务、IPC、工作区协调器、渲染 hook、推荐/归档 UI、Electron 窗口。 | 已确认待实施 | 尚处讨论阶段；未修改业务代码，真实 Electron 验收尚未开始。 |

## 待用户确认

- 用户已指出删除模式默认收藏夹不能单选且未参与全选/取消全选；拟按 I001 实施。
- R002-2 不再列为待用户决定；依据既有设计“当前批次打开是当前批次，本轮总览打开是本轮所有批次”处理，本轮总览必须聚合本轮所有批次的实际推荐状态。
- R002-1 的失败提示沿用现有提示，不新增“待对账”等状态文案；当前仅需修复点击后无状态变化和错误被静默吞掉的问题。

## 明确不做

- 暂无。

## Implementation evidence (2026-08-16)

| Index | Status | Code locations | Automated evidence | Electron evidence |
|---|---|---|---|---|
| I001 | implemented, pending UI audit | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` deletion-mode `enableEntries` | `FavoriteLedgerOverview.test.tsx`: 97/97 passed in focused run | pending |
| I002 | implemented, pending UI audit | `electron/main/oldFavoriteWorkspaceCoordinator.ts` `acceptCurrentTags`, `rebuildRecommendationsAfterTagBatch`, `refreshRecommendationsAfterTagEnrichment` | accepted-current regression passed; full coordinator file 283/283 passed | pending |
| I003 | implemented, pending UI audit | `recordTagEnrichment`, `recordTagEnrichmentFailure`, `createOverviewProjection` | non-current-ready overview regression passed; full coordinator file 283/283 passed | pending |
| I004 | implemented, pending UI audit | `FavoriteLedgerOverview.tsx` `finalizeManagedDeletionPlan` | deletion + controlled panel regression run 235/235 passed in prior focused run | pending |
| I005 | implemented, pending UI audit | coordinator per-segment acceptance and renderer readiness projection | coordinator and scan overview regressions passed | pending |
| I006 | implemented, pending UI audit | full ledger and protected-flow review | full coordinator and renderer regression commands recorded below | pending |
| I007 | implemented, pending UI audit | current-batch vs whole-round scope preserved in coordinator and renderer | existing scope tests plus new snapshot regressions passed | pending |
| I008 | implemented, pending UI audit | coordinator ready-segment refresh path | full coordinator file 283/283 passed | pending |
| I009 | implemented, pending UI audit | `OldFavoriteScanOverviewStep.tsx` current segment readiness guard | renderer acceptance-visibility regression passed; renderer suite 376/376 passed | pending |
| I010 | implemented, pending UI audit | coordinator shared recommendation/overview snapshot refresh | accepted-current and non-current-ready regressions passed | pending |
| I011 | implemented, pending UI audit | protected coordinator, renderer, deletion paths | coordinator 283/283; renderer protected suite 376/376; `git diff --check` passed | pending |

The test suites emit existing React `act(...)` warnings in unrelated controlled-panel tests; no assertion failed and no new warning was attributed to this round. Real Electron interaction, including mouse movement, click, scroll, resize, minimize, restore, and close, remains required before marking the UI audit complete.

## 追加实施与验收审计（2026-08-16）

本节不替换原文区或逐项索引，仅追加本轮实际已取得的证据与仍不能声称已验收的边界。

| 索引 | 代码/回归证据 | 真实 Electron 证据 | 当前状态 |
|---|---|---|---|
| I001 | `FavoriteLedgerOverview.tsx` 删除模式 `enableEntries`；该文件定向回归 97/97 通过。 | 已进入删除模式，默认收藏夹“知识学习”可选；全选后所有卡片进入选择状态；取消全选、退出删除模式后恢复普通模式。 | 已实施，已做非破坏性 UI 验收。 |
| I002、I005、I008、I010 | `oldFavoriteWorkspaceCoordinator.ts` 的 `acceptCurrentTags`、`recordTagEnrichment`、`recordTagEnrichmentFailure`、`rebuildRecommendationsAfterTagBatch` 与 `createOverviewProjection`；协调器定向套件 283/283 通过。 | 未点击“采用当前标签”：该操作会持久化工作区事件和推荐覆盖层。 | 已实施；真实写入动作待用户允许实际数据验收。 |
| I003 | 同一协调器的非当前批次 ready 快照回归，包含本轮总览聚合断言。 | 未通过实际账号切换批次触发标签补取，以避免改动工作区。 | 已实施；真实写入动作待验。 |
| I004 | `FavoriteLedgerOverview.tsx` 的 `finalizeManagedDeletionPlan`；收藏夹面板与控制面板定向回归 235/235 通过。 | 未确认实际删除弹窗；只验证过删除模式选择/取消选择，没有执行删除。 | 已实施；破坏性分支待用户明确允许后验收。 |
| I006、I007、I011 | 本账本、实施计划与受保护回归均重新通读；最新 `npm test -- --reporter=dot` 为 234 files / 3808 tests（325.58 s，exit 0），最新 `npm run build` exit 0。 | 开发版完成鼠标点击、滚动、缩放、最小化/恢复、关闭确认取消；未把自动化通过当作流畅性结论。 | 已实施；基础 UI 烟测完成。 |
| I009 | `OldFavoriteScanOverviewStep.tsx` 当前批次接受状态渲染回归；扫描概览/Hook 定向套件 376/376 通过。 | 未点击实际接受按钮，原因同 I002。 | 已实施；真实写入动作待验。 |

完整测试中还揭示了四条已完成产品行为的旧测试契约，已只更新断言而未改写产品代码：DeepSeek 按钮已是“开始整理”、单按钮布局使用 `flex: 0 1 auto; margin-left: auto;`、默认收藏夹远端删除保留 `managedFolderDeletedByUser: true`，并恢复默认模板而不是保留 `syncState: 'local-draft'`。这些断言更新由 `2026-08-16-scan-empty-folder-response.md` 的 I002“继续全量测试”记录，避免把它们误称为本账本的新功能。
