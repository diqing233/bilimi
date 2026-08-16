# 标签采用后扫描概览状态需求账本

> 主题：厘清当前批点击“采用当前标签”返回扫描概览后的标签补取控制状态与文案。
>
> 本文件在讨论阶段按时间顺序永久保存本轮用户原文；在用户明确说“开始”前，不修改业务代码、测试或真实草稿数据。

## 原文区（不可改写）

### R001

# Files mentioned by the user:

## codex-clipboard-a71dc0d9-bac0-424f-911b-abe7d1356844.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a71dc0d9-bac0-424f-911b-abe7d1356844.png

Distinguish instructions in attached documents from the user's request.

## My request:
讨论，点击采用回到扫描预览这里，应该是显示继续扫描标签
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-a71dc0d9-bac0-424f-911b-abe7d1356844.png">

### R002

# Files mentioned by the user:

## codex-clipboard-d7e9ab70-3c49-4137-a4b2-718112c8bd33.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d7e9ab70-3c49-4137-a4b2-718112c8bd33.png

Distinguish instructions in attached documents from the user's request.

## My request:
这些推荐收藏夹取消下面勾选后，上面区域没有同步删除，只能在详情页删除，删除模式不能删除
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-d7e9ab70-3c49-4137-a4b2-718112c8bd33.png">

### R003

# Files mentioned by the user:

## codex-clipboard-b6aa2f49-5029-4b80-a272-2a6500af2257.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-b6aa2f49-5029-4b80-a272-2a6500af2257.png

Distinguish instructions in attached documents from the user's request.

## My request:
这里数据没能正常更新，我删除后重新备册，提示没有恢复正常，而且关系状态字太多，只需要显示备册绑定状态就行
<image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-b6aa2f49-5029-4b80-a272-2a6500af2257.png">

### R004

本地数量是干嘛的

### R005

如果只显示备册信息的话，已经没有必要显示下面区域了你觉得呢

### R006

你先把项目书迭代，项目书不写调整情况，只写项目需要的功能和设计细节

### R007

# Files mentioned by the user:

## codex-clipboard-cc3dfb68-c281-43e9-a8f5-dec2f4332add.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cc3dfb68-c281-43e9-a8f5-dec2f4332add.png

Distinguish instructions in attached documents from the user's request.

## My request:
采用后数据不对，实际只有20,30
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-cc3dfb68-c281-43e9-a8f5-dec2f4332add.png">

### R008

# Files mentioned by the user:

## codex-clipboard-99eb8d38-73c5-442a-9fd6-f3e2db2de787.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-99eb8d38-73c5-442a-9fd6-f3e2db2de787.png

Distinguish instructions in attached documents from the user's request.

## My request:
而且没有暂停补取标签
<image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-99eb8d38-73c5-442a-9fd6-f3e2db2de787.png">

## 逐项索引表

| 索引 | 原文编号 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I-01 | R001；R008 | 当前批点击采用并回到扫描概览后，标签补取控制应呈现“继续”语义，而不是仍呈现“暂停”。 | 整理收藏 → 扫描概览 → 当前批次的“标签补取”状态区；截图中箭头所指的控制按钮。 | `继续扫描标签`的精确条件、恢复范围和是否暂停全局补取由 R008/I-08 明确替代；其余当前批采用后的继续文案目标保留。 | R001 原“继续只恢复当前批、不影响其他批后台读取”被 R008 明确替代。 | 仅工作区标签状态；不触发 B 站读取、写入、绑定、同步或真实草稿变更。 | 讨论阶段不改代码、不点击现有草稿的继续/合并/重扫/放弃。 | 当前批待办、已采用版本、全局其他批标签任务、扫描概览投影。 | 被 R008 部分明确替代；待按 I-08 回归复核。 | 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a71dc0d9-bac0-424f-911b-abe7d1356844.png`；项目书第 5.3 节定义最终文案、显示条件和跨批边界。 |
| I-02 | R002；扫描账本 R002/I-06 | 下方推荐收藏夹取消勾选后，上方“收藏夹”区域及删除模式必须同步；不能只能在详情页删除。 | 整理收藏 → 推荐收藏夹（当前批）与上方“收藏夹”卡片区 / 删除模式；截图中同名收藏夹在两个区域的投影。 | 对“本轮推荐生成、未备册且无绑定”的本地候选：选中时在下方与上方都有同一 ID 的投影；取消成功后下方候选卡保留为未勾选、上方本地卡片移除。对已经备册、已绑定或原本就是用户 B 站收藏夹的项：下方取消推荐勾选，但上方真实实体保留。 | 取消勾选或删除模式的删除均须先完成同一笔权威本地取消/删除；成功后一次性刷新下方选择、上方卡片和删除模式，失败时三处保持并显示原因。删除模式必须允许选择上述未备册推荐候选，走同一取消推荐及本地删除路径。 | 纯本地候选只删除本地草稿/规则；B 站远端夹默认保留。任何 B 站删除仍需用户在专用确认框明确选择远端范围，本轮讨论不触发。 | 不把取消推荐扩大为删除视频、已备册/已绑定工作夹、归档结果或任何远端实体；同名但原本为普通用户 B 站收藏夹的实体保留。 | 推荐候选 ID、上方卡片投影、权威本地草稿/规则、删除模式能力、远端关系状态。 | 已实施，待真实推荐批次复核。 | 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d7e9ab70-3c49-4137-a4b2-718112c8bd33.png`；下方“推荐收藏夹”含 `honker233` 等候选，上方“收藏夹”也有同名卡片，但用户报告取消下方勾选后未同步删除，且删除模式不能删除。既有已确认 I-06 规定：未备册本地草稿/规则取消推荐后，必须待真实本地删除成功再同时移除推荐勾选与上方卡片；已备册/绑定项仅取消本轮推荐。 |
| I-03 | R003；远端/本地账本 R002–R003/I-02 | 删除后重新备册必须以重新备册的权威结果刷新本地工作区关系；状态只显示简短的备册/绑定状态。 | 掌库管理、收藏库、扫描概览的用户收藏夹行与当前整理草稿。扫描概览不再保留 `bilimi 本地工作区` 表格。 | 重新备册成功后，所有受影响投影立即显示`已备册`；用户收藏夹行只显示`已备册`或`未绑定`。本地工作区在掌库/收藏库显示`未备册`、`备册中`、`已备册`或`未绑定`；细节只在详情/反馈中显示。 | 删除后重建本地规则和远端关系时，必须先替换或清除旧关系投影，再显示新的备册/绑定结果；失败时保留真实旧状态与可读失败原因，不能假称恢复。 | 重新备册可能读取或写入用户明确选择的 B 站收藏夹；本轮讨论不执行。任何本地状态变更必须只依据该次操作的真实结果。 | 不因名称相同恢复过期关系；不把重新备册视为隐式绑定不同的远端收藏夹；不删普通用户 B 站收藏夹。 | 本地 rule ID、远端 folder ID、绑定记录、备册结果、跨页面快照失效与重新投影。 | 已实施，待真实删除后重新备册流程复核。 | 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-b6aa2f49-5029-4b80-a272-2a6500af2257.png`；项目书第 4.1、5.2 节已定义短状态、刷新范围和扫描概览边界。 |
| I-04 | R004；R005 | 说明扫描概览“本地数量”的数据含义，并确定该列是否仍有产品价值。 | 原位置为整理收藏 → 扫描概览 → `bilimi 本地工作区`表格的“本地数量”列。 | 原口径是本地逻辑收藏夹在 bilimi 本地仓库内的成员数量；不等于 B 站成员数、本轮扫描量或备册状态。 | 不再作为扫描概览功能显示。 | 无。 | 不影响掌库和收藏库中的本地已分配数。 | 本地仓库 membership、工作区投影、归档结果。 | 被 R005 明确替代：扫描概览移除整个本地工作区区域及其本地数量列。 | R004 原文；截图中 0 表示本地仓库尚无任何视频归入这些工作区，不是 B 站远端收藏夹的视频数；项目书第 5.2 节已移除此展示。 |
| I-05 | R005 | 若本地工作区区域只剩备册信息，则从扫描概览移除整个 `bilimi 本地工作区` 区域。 | 整理收藏 → 扫描概览 → 当前位于“用户收藏夹（B 站）”下方的 `bilimi 本地工作区`表格。 | 扫描概览只保留与本轮扫描来源选择、当前批进度和整理决策直接相关的信息；不再显示本地数量或重复的备册/绑定状态表。 | 移除区域不改变扫描来源、批次、推荐、分类、备册、绑定或同步行为。需要查看本地工作区规则、已入库数量和备册/绑定状态时，从掌库的收藏夹/收藏库专门区域进入。 | 仅改变扫描概览投影；不删除本地规则、关系记录、B 站收藏夹或数据。 | 不把 B 站远端收藏夹从“用户收藏夹（B 站）”区域移走；不因隐藏而放松“已绑定/待对账远端夹不可作为扫描来源”的资格保护。 | 远端来源资格、收藏夹/收藏库入口、备册绑定状态、扫描概览布局。 | 已实施，待含扫描概览的真实界面复核。 | R005 原文；R003 表明本地区现仅呈现数量与长关系文案，且不提供本页动作；现有分层规则仍由数据模型和用户收藏夹行的关系徽标保护。 |
| I-06 | R006 | 迭代项目功能项目书，只保留产品最终需要的功能、界面、状态、交互和数据边界；不写调整历史、当前缺陷、实施记录或“待修复”说明。 | `docs/项目功能项目书.md`，重点是整理收藏、扫描概览、推荐收藏夹、备册/绑定、收藏库。 | 项目书以用户可验收的最终行为表述；历史问题、代码位置、提交、测试、迁移实施细节仅留在需求账本和实施计划。 | 不改变运行时行为；项目书是后续实现和验收的设计依据。 | 不执行 B 站操作或本地数据写入。 | 不删除需求账本中的原文、证据、替代关系或未完成事项；不把项目书变成变更日志。 | 已确认的 R001–R005、既有项目书结构、需求账本与实施计划。 | 已完成，待用户审阅。 | R006 原文；项目书已在第 4.1、4.5–4.6、5.2–5.5、6.6 及全文结构中纳入 I-01、I-02、I-03、I-05 的最终设计，并移除了实现依据、当前核验、开发回归、审计历史与证据来源等非产品内容。 |
| I-07 | R007 | 采用当前标签后，扫描概览的“本轮待整理”及相关标签/批次数字必须与当前批和本轮的真实作用域一致，不能把历史已处理量或全量标签量当作采用后的当前批结果。 | 整理收藏 → 扫描概览 → 批次切换与进度卡；截图箭头所指`本轮待整理 2563`。 | 待确认“20,30”分别指当前批、标签增量还是本轮汇总的精确口径；确认前不能以截图数值推断或重写任何计数。 | 采用后仅更新由当前采用版本影响的投影；不得重置、重复累加或把其他批/历史已处理数并入当前批。 | 只读诊断阶段不读取、写入或删除 B 站数据，不更改工作区或本地仓库。 | 不以隐藏数字、硬编码`20`/`30`或仅改文字掩盖数据边界错误。 | 当前批 `aids`、当前批标签版本、已采用版本、`overview`、`planReadiness`、全轮聚合和持久化恢复。 | 待根因确认与用户明确开始。 | 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cc3dfb68-c281-43e9-a8f5-dec2f4332add.png`；用户原文保留于 R007，目标位置待界面验收。 |
| I-08 | R008；“先加入项目书再开始改” | 当前批点击`采用当前标签`成功后，必须自动安全暂停全局标签补取；`继续扫描标签`只从其他未采用批的持久检查点继续，绝不重读已采用当前批。 | 整理收藏 → 扫描概览 → 当前批采用返回后的标签补取状态区，以及主进程补取队列。 | 若存在未采用批待办：完成采用后显示“标签补取已暂停”和`继续扫描标签`，不得显示`暂停补取标签`或`继续补取标签`；若没有未采用批待办，保持“已采用当前标签”且隐藏继续入口。手动暂停尚未采用批时保留`继续补取标签`。 | 采用版本、推荐和当前批系统分类先按权威成功结果提交；当前在途读取允许收束，其后不再领取待办。点击`继续扫描标签`只恢复未采用批，已采用当前批的待办保持排除且不重入队。 | 工作区标签检查点和采用版本必须原子持久化；不读取、写入、删除或同步 B 站，不改变扫描、DeepSeek、人工分类或已勾选推荐。 | 明确替代 I-01/R001 中“继续只恢复当前批且不影响其他批后台读取”的跨批边界；不改变一般手动暂停、失败重试和新标签再次采用的行为。 | 全局 `tagEnrichment.status`、已采用批集合/版本、未采用批待办、补取服务轮询、暂停 IPC、恢复按钮投影。 | 已实施，待真实界面复核。 | 截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-99eb8d38-73c5-442a-9fd6-f3e2db2de787.png`；项目书第 5.3 节先定义最终契约，实施与自动化证据见下方 I-08。 |

## 讨论记录

- 当前根目录分支为 `main`；开始讨论时仅存在其他主题的未跟踪文件 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`，不修改、不暂存或删除该文件。
- 本轮尚未获得“开始”授权；不修改业务代码、测试、应用数据或 B 站数据。
- R002 的代码核查：`savedRecommendationLedger(...)` 将推荐生成的上方卡片标成 `bindingState: 'unbacked'`；下方取消勾选的 `handleOrganizationRecommendationToggle(...)` 只更新推荐选择，未移除这份上方投影；删除模式的 `isRecommendationCancellationOnly(...)` 又排除了 `unbacked` 卡片。因此同一候选在三个入口没有走同一权威删除事务，和截图现象一致。该记录只用于后续实施取证，不改变任何运行状态。
- R003 截图中的目标区域：`bilimi 本地工作区`表格以“本地数量 / 关系状态”展示本地工作区投影；关系状态文案在截图中被截断。后续实现前需读取删除、重新备册和关系规范化路径，不能仅修改显示文字掩盖旧关系未刷新。
- R005 的讨论结论：本地工作区区域若不承担来源选择、批次决策或本页操作，只重复备册信息，则应从扫描概览移除；本地规则、已入库数量和关系详情仍保留在掌库的专门入口，而非被删除。
- R005 明确替代 `2026-08-16-remote-source-local-workspace-separation.md` 中 R003 对“扫描概览下方 bilimi 工作区展示区”的呈现要求；替代范围仅限扫描概览的重复展示，不替代远端收藏夹与本地工作区分层的数据模型、关系资格或其他页面中的本地工作区入口。
- R006 的文档边界：项目书只叙述目标产品契约；本账本保留原文、问题现象、实现依据和验收记录，实施计划保留代码任务与风险。两者不得互相替代。
- R008 根因诊断：截图可见手动`暂停补取标签`按钮，故“没有暂停”不能按按钮缺失处理。当前`acceptCurrentTags(...)`在当前批已采用、其他批仍有待补取项时，显式将全局标签状态设为`running`；补取服务随后继续领取其他未采用批的待办。协调器测试同时把此行为作为既有预期。若产品规则是“采用当前标签即暂停补取”，必须以 R008 明确替代 I-01 的跨批继续语义，并重新定义`继续扫描标签`应恢复当前批重读还是从未采用批检查点继续；在用户确认前不改代码。
- R008 已确认：用户要求先把设计加入项目书再开始改，确认“采用当前标签成功即暂停全局补取；继续扫描标签只从未采用批检查点继续，不重读已采用当前批”。项目书第 5.3 节已先更新；该规则明确替代 I-01 中与其冲突的跨批继续边界。

## 实施与验收记录（2026-08-16）

> 本节是上方逐项索引表中 I-01、I-02、I-03、I-05、I-08 的当前实施状态和验收证据；原文区及其讨论结论不作改写。

| 索引 | 当前状态 | 实际代码位置 | 自动化验证 | 真实界面验收与未验证条件 |
| --- | --- | --- | --- | --- |
| I-01 | 已实施，待含已采用批次的真实界面复核。 | `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`：当前批 `currentSegmentCanResumeTagEnrichment` 分支固定显示`继续扫描标签`；`OldFavoriteScanOverviewStep.test.tsx`：当前批可恢复而其他批仍读取时只恢复当前批。 | `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`：31 项通过；该测试在跨批快照中断言精确按钮文案、隐藏`暂停补取标签`并验证点击只调用当前批恢复。 | 本轮开发版中没有可安全采用的测试批次；为避免读取、采用或变更真实 B 站/草稿数据，未点击整理收藏的扫描入口。因此“采用后”截图位置由组件自动化用例覆盖，仍待专用测试工作区进行真实界面复核。 |
| I-02 | 已实施，待真实推荐批次复核。 | `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：详情与删除模式的已选推荐统一走`onOrganizationRecommendationToggle`；`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`：仅在权威队列成功后收束无远端 ID 的未备册生成卡片，并按账号隔离已收束 ID。 | `npm test -- src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`：236 项通过；合并回归中两文件共 236 项仍通过。覆盖纯本地卡片成功消失、失败保持、已有关联的实体保留，以及删除模式不调用本地/远端删除。 | 开发版掌库卡片可正常显示和滚动，但当前账号没有可安全取消的“当前整理批推荐”候选；没有触发取消推荐、删除模式或任何远端删除。对应三入口的真实界面流程待专用测试工作区复核。 |
| I-03 | 已实施，待真实删除后重新备册流程复核。 | `electron/main/oldFavoriteWorkspaceCoordinator.ts`：`refreshRelationshipProjection` 从本地仓库物理分片重投影来源关系、工作夹兼容标记、选择资格、指标和覆盖层；`electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`：受限无参数`refresh-relationship-projection`命令；`src/renderer/src/features/assistant/FloatingAssistantApp.tsx`：备册/保存成功和组织状态刷新均先请求重投影再`loadSnapshot()`；`OldFavoriteArchivePreviewStep.tsx`：按共享扫描资格而非兼容标记筛选来源。 | `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`：323 项通过；协调器用例先红灯证明旧投影未同步工作夹标记，归档预览用例先红灯证明旧标记会过滤已解除关系且重新选择的来源。另有协调器 291 项、IPC 44 项和 `FloatingAssistantApp` 82 项回归通过。 | 开发版掌库可见`已备册`、`未备册`的简短状态，且未显示本地数量；本轮没有删除或重新备册真实收藏夹。远端`已备册`/`未绑定`扫描来源的即时更新及解除关系后归档预览恢复，由隔离协调器与组件测试覆盖，待专用测试工作区复核。 |
| I-04 | 被 R005 明确替代，未单独实施。 | 无运行时单项改动；扫描概览整个本地工作区区域已随 I-05 移除。 | I-05 的扫描概览测试断言不存在`本地数量`。 | 该项的设计结论已被 I-05 包含；无需另行界面操作。 |
| I-05 | 已实施，待含扫描概览的真实界面复核。 | `src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.tsx`：删除`bilimi 本地工作区`表及本地数量、长关系文案；远端行只投影`已备册`/`未绑定`并继续使用关系资格禁用来源。 | `npm test -- src/renderer/src/features/assistant/OldFavoriteScanOverviewStep.test.tsx`：31 项通过，覆盖不存在`bilimi 本地工作区`、`本地数量`和长状态，以及普通来源仍可选、已绑定/待对账来源不可选。 | 当前开发版未启动扫描，无法在不读 B 站数据的前提下进入扫描概览；掌库实测页面没有显示本地数量。扫描概览的精确区域与来源禁用状态待专用测试工作区复核。 |
| I-06 | 已完成，待用户审阅。 | `docs/项目功能项目书.md`。 | 本轮再次完整通读项目书与账本，确认项目书仍只描述最终产品契约；实现、历史和验证记录仅在本账本及实施计划。 | 不涉及运行时界面或外部副作用。 |
| I-08 | 已实施，待真实界面复核。 | `src/shared/oldFavoriteWorkspace.ts`：快照采用明确的“可继续扫描未采用批”字段；`electron/main/oldFavoriteWorkspaceCoordinator.ts`：采用即持久化为暂停、原子领取在途 AID、恢复后用完整分批投影判断未采用待办，并允许在途结果收束；`electron/main/oldFavoriteWorkspaceStore.ts`：`tagged`日志持久化取消采用状态；`electron/main/oldFavoriteWorkspaceScanService.ts`：每轮只原子领取一个待办；`OldFavoriteScanOverviewStep.tsx`：暂停后显示精确文案`继续扫描标签`。 | `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts`：292 项通过，覆盖多批采用/重启/继续检查点、在途结果二次采用和不重读已采用批；`npm test -- electron/main/oldFavoriteWorkspaceScanService.test.ts`：46 项通过，覆盖采用暂停后在途请求收束且不发起下一请求；IPC 44 项、扫描概览 31 项均通过。 | 没有可安全采用的专用测试批次，未在真实账号页面点击采用、继续或触发 B 站读取；自动化已断言精确按钮文案、显示/隐藏和点击路径。仍需在隔离测试工作区复核“采用 → 返回扫描概览 → 继续扫描标签 → 仅后续批恢复”的真实流程。 |

### I-08 本轮最终自动化验证（2026-08-17）

- `npm run build`：通过。
- `npm test`：234 个测试文件、3831 项测试全部通过。
- 上述验证只使用本地测试替身和临时目录；没有读取、写入、删除、同步或变更任何真实 B 站数据、真实草稿或用户文件。

### 本轮受控 Electron 开发版验收

- 进入`掌库`、显示收藏夹卡片和在该面板内滚动均正常；未点击`整理收藏`、`备册`、推荐取消、绑定、同步或删除。
- 最小化后可重新激活恢复；最大化/还原使窗口截图尺寸在 `2048 × 1104` 与 `1578 × 954` 间切换，界面仍可正常渲染。
- 点击关闭控件出现“最小化到托盘 / 退出 bilimi / 取消”确认框；为不退出用户正在运行的开发版而选择`取消`，故“确认退出”未执行。
- 自动化点击和滚动期间未见界面停止响应；真实鼠标连续移动的流畅度无法由当前自动化方式量化，待人工在含测试工作区的开发版中补充验收。

### 提交前自动化状态

- 本轮关联回归 `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx` 为 323 项通过；`npm run build` 通过。
- `npm test` 本次为 233 个测试文件、3828 项通过、1 项失败。失败位于本轮未修改的 `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`：整文件运行时，批量远端删除用例在 `FavoriteLibraryApp.tsx:2000` 延迟读取 `event.currentTarget.checked`，触发 React 19 事件失效；单独运行该用例通过，整文件另一条“稳定 ID 编辑器”用例也会随执行顺序失败。该问题不属于 R001–R006 的允许修改范围，未修复、未暂存，因而本轮不创建提交。
