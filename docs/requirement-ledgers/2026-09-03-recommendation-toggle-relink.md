# 推荐收藏夹勾选、详情删除与二次整理联动

## 原文区（永久追加，按讨论时间顺序）

### R001

对话来源：`codex://threads/01a02055-e254-7ef2-ae2b-27dce0088d91`

附件文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2dd3dc1c-fce8-488e-bd5b-75a9c436e961.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5d1bb787-fb18-43b2-8a63-48a7802926f7.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2a4d1e86-28e0-4c04-a795-6a79697aecbd.png`

截图目标区域：

- 图一：非“整理收藏”期间，右侧面板“收藏夹”上方掌库收藏夹列表及下方“整理收藏 > 推荐收藏夹”区域；目标现象是推荐收藏夹无法正常勾选和取消勾选、详情页不能单独删除，但删除模式可以删除。
- 图二：第二次“整理收藏”期间，“收藏夹”上方已有第一轮留下的推荐收藏夹规则，以及下方“推荐收藏夹”候选列表；目标现象是同样的推荐收藏夹未被识别为同一规则，两个方向勾选不联动。
- 图三：整理期间上方收藏夹与下方推荐收藏夹的对应项；目标现象是下方取消勾选后没有删除该收藏夹草稿。

截图无法替代稳定规则 ID、工作区快照、自动化测试和真实 Electron 界面验收。

用户原文（完整）：

> # Files mentioned by the user:
>
> ## codex-clipboard-2dd3dc1c-fce8-488e-bd5b-75a9c436e961.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2dd3dc1c-fce8-488e-bd5b-75a9c436e961.png
>
> ## codex-clipboard-5d1bb787-fb18-43b2-8a63-48a7802926f7.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5d1bb787-fb18-43b2-8a63-48a7802926f7.png
>
> ## codex-clipboard-2a4d1e86-28e0-4c04-a795-6a79697aecbd.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-2a4d1e86-28e0-4c04-a795-6a79697aecbd.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> codex://threads/01a02055-e254-7ef2-ae2b-27dce0088d91  
> 检查这个对话内容，上一轮让他做的改动大有问题，我回退了，你来重做
>
> 只负责推荐收藏夹相关的问题，上一轮没修复好，图一非“整理收藏”期间，推荐收藏夹无法正常勾选和取消勾选，无法在详情页单独删除，但是删除模式删除是可以删掉的，目标是无论任何时候掌库收藏夹都可以正常勾选和取消勾选，也可以在详情页单独删除，遵守项目书规划
> \
> 图二“整理收藏”期间，第一次整理收藏联动是正常的（跟项目书一致），但是第一次整理结束后再次整理（此时收藏夹规则有第一轮留下的推荐收藏夹），如果这时候还有同样的推荐收藏夹，无法识别到和产生联动此时勾选下边推荐收藏夹不会自动勾选上方  ，勾选上边推荐收藏夹不会自动勾选下方  ，取消下方勾选应该删除该收藏夹草稿，就是跟项目书一致
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-2dd3dc1c-fce8-488e-bd5b-75a9c436e961.png">[Image #1]</image><image name=[Image #2] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-5d1bb787-fb18-43b2-8a63-48a7802926f7.png">[Image #2]</image><image name=[Image #3] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-2a4d1e86-28e0-4c04-a795-6a79697aecbd.png">[Image #3]</image>

## 逐项索引表

| 编号 | 原文引用 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 任何时候掌库收藏夹都可以正常勾选和取消勾选；非“整理收藏”期间也不得被错误的工作区/持久化门禁锁死。 | 右侧面板“收藏夹”上方掌库收藏夹卡片的勾选控件；账号级收藏夹启用状态。 | 无论无工作区、整理中、整理结束或再次进入整理，只要规则存在且未处于明确保存失败编辑态，控件可操作。 | 勾选/取消按稳定规则 ID更新启用或参与状态；不因取消勾选误删已保存规则。 | 只更新本地账号规则/启用状态及整理工作区投影；不自动备册、绑定、改名、同步或写入 B 站。 | 只处理推荐收藏夹及其关联掌库规则；不改普通收藏夹、B 站远端删除和其他页面。 | `FavoriteLedgerOverview`、`ControlledFavoriteLedgerPanel`、`App.tsx` 保存回执、`favoriteAccountPreferences`、工作区快照。 | 已实施待验证 | 代码：`ControlledFavoriteLedgerPanel.tsx:374-379,771-829`；自动化：无工作区推荐取消/保存测试（定向通过）；Electron：推荐列表生成、滚动和步骤导航响应正常，未操作真实账号勾选。 |
| I002 | R001 | 掌库收藏夹可在详情页单独删除；删除模式已有可用行为必须保持。 | 上方掌库收藏夹详情页的独立“删除”入口及删除事务。 | 无论是否有整理工作区，明确点击详情删除均进入独立删除事务；保存失败或推荐分析失败不得误锁删除。 | 删除指定稳定规则 ID；整理期间按项目书保留必要工作区重分类/队列语义，无工作区时完成本地删除；删除模式回归不受影响。 | 只按既有本地删除规则处理推荐草稿/已保存规则；不擅自删除 B 站远端收藏夹，不改变远端同步知情同意。 | 不改删除模式弹窗、普通收藏夹删除、远端删除确认语义，除非测试证明当前推荐路径误用了它们。 | `FavoriteLedgerOverview` 详情删除、`onDeleteLedger`、推荐草稿删除 IPC、删除持久化与上方列表投影。 | 已确认，待实施 | 当前详情页单独删除失败而删除模式可用；待建立失败回归测试和真实界面验收。 |
| I003 | R001 | 推荐收藏夹取消勾选时遵守项目书：纯推荐本地草稿取消采用应删除该草稿；已保存/已绑定规则取消只更新启用/参与状态，不删除正式规则。 | 下方“整理收藏 > 推荐收藏夹”候选卡片及其与上方规则的来源映射。 | 纯推荐草稿、已保存推荐规则、已绑定推荐规则按稳定来源和规则 ID分流；不按名称猜测。 | 取消下方纯推荐草稿后从推荐列表和上方投影消失；取消已保存/已绑定规则后上下状态同步取消但规则保留，可再次勾选恢复。 | 纯推荐草稿走现有草稿删除事务；正式规则只写本地状态；不触发 B 站写入。 | 不改变整理期间分类、采用、备册、同步和删除模式的既有语义。 | `ControlledFavoriteLedgerPanel` 推荐 toggle、`isPureRecommendedLocalDraft`、`onOrganizationRecommendationToggle`、草稿删除事务。 | 已确认，待实施 | 图三/项目书要求明确；待用状态矩阵测试覆盖取消分流、持久化和重新勾选恢复。 |
| I004 | R001 | 第一次整理结束后再次整理时，若第一轮留下推荐收藏夹规则且本轮出现同一推荐候选，必须识别为同一规则并产生上下联动，不生成重复规则。 | 第二轮工作区推荐候选快照、上方已保存收藏夹列表、候选到规则 ID映射。 | 仅稳定规则 ID或已确认的候选→规则映射一致时合并；真正不同规则/不同远端对象保持独立；不得只按显示名称合并。 | 下方推荐收藏夹勾选自动勾选上方对应规则；上方勾选自动勾选下方对应候选；两侧取消状态同步，不重复创建草稿。 | 只更新本地规则采用/启用状态、工作区快照和分类投影；不重复创建本地规则、远端收藏夹或绑定。 | 不改变第一轮已经正常的联动、普通规则、不同 ID 同名候选及其他整理流程。 | 推荐候选 ID、`candidateToLedgerId`、`organizationRecommendationEnabledById`、`organizationSavedLedgerEnabledById`、工作区重开/恢复。 | 已确认，待实施 | 当前第二轮无法识别/联动；待构造跨轮快照失败测试并在真实 Electron 第二轮整理验收。 |
| I005 | R001 | 第二轮整理时取消下方推荐收藏夹勾选，应删除对应的纯推荐收藏夹草稿；已保存规则只取消参与状态，不能误删正式规则。 | 第二轮下方推荐列表的取消勾选回调、草稿/规则持久化结果。 | 依据稳定规则来源和是否纯推荐草稿分流；取消后 UI、上方投影和本地快照一致。 | 下方取消纯推荐草稿完成草稿删除并移除候选；若为第一轮已保存规则，只取消上方/下方参与状态并保留规则。 | 本地草稿删除或状态保存；不执行 B 站远端删除、备册或同步。 | 不把“取消采用”扩大为详情删除；不删除第一轮已保存规则。 | I003/I004 的稳定映射、草稿删除 IPC、账号偏好和工作区队列。 | 已确认，待实施 | 图二/图三目标；待自动化验证删除调用、上下投影和重新整理恢复。 |

### 实施验收补录（覆盖上表 I001-I005 的状态与证据）

| 编号 | 状态更新 | 实际代码位置 | 自动化验证 | Electron 界面验收与未验证条件 |
| --- | --- | --- | --- | --- |
| I001 | 已实施待验证 | `ControlledFavoriteLedgerPanel.tsx:374-379,771-829` | 无工作区推荐取消/保存、已绑定推荐 toggle 测试；定向 328 项通过 | 开发版已观察推荐候选生成、右侧滚动和步骤导航响应；未操作真实账号勾选，故真实持久化点击仍待验收。 |
| I002 | 已实施待验证 | `FavoriteLedgerOverview` 独立 `onDeleteLedger` 路径；推荐草稿删除由 `favoriteLedgerDraftDeletion.ts:33-57` 窄化 | 详情独立删除、删除模式回归与 IPC 谓词测试；定向通过 | 详情删除会删除本地账号规则，未在开发账号执行；删除模式仅以自动化回归验证。 |
| I003 | 已实施待验证 | `ControlledFavoriteLedgerPanel.tsx:556-640,771-829` | 纯草稿取消、已保存/已绑定分流、共享删除谓词状态矩阵；定向通过 | 推荐候选真实生成并显示；真实账号取消删除未执行。 |
| I004 | 已实施待验证 | `ControlledFavoriteLedgerPanel.tsx:141-162,374-395,1580-1620` | 稳定 ID 双向映射、同名不同 ID 不合并、上下联动与历史恢复测试；定向通过 | 已完成一次真实扫描并打开推荐步骤；未在真实账号完成第一轮保存后第二轮重开。 |
| I005 | 已实施待验证 | 同 I003/I004；纯草稿删除谓词 `favoriteLedgerDraftDeletion.ts:33-57` | 下方取消后草稿投影移除、已保存规则保留、重新勾选恢复测试；定向通过 | 真实第二轮取消未执行，以避免无确认的本地账号删除。 |

验证记录：推荐相关定向套件共 680 项通过（主进程 367、渲染器 313）；`npm run build` 通过；`git diff --check` 通过。全量 `npm test -- --silent` 本次观测到 4275 通过、2 个失败：安装器 finish-page 旧断言、managed-folder deletion 快照通知旧断言；两项均未触及本轮推荐文件。真实 Electron 已完成标签补取、推荐候选生成、滚动与步骤导航观察；涉及真实账号勾选、详情删除、草稿删除和第二轮重开等会改变本地数据的动作尚未执行，不能以此记录宣称这些界面动作全部验收通过。

## 实施前边界

- 本轮只处理推荐收藏夹相关的勾选、取消、详情删除、草稿删除和二次整理联动；不处理改名、备册候选识别、启动刷新、DeepSeek、标签补取或其他主题。
- 当前仍是讨论模式；用户明确说“开始”前不得修改业务代码、测试代码或提交。需求账本本身按项目约束记录本轮原文，不能替代实施授权。
- 不改变 B 站远端数据；所有推荐取消、详情删除和联动状态先按项目书已有本地事务边界执行。
- 若代码与项目书/既有测试冲突，实施前必须先指出冲突并按稳定规则 ID、真实状态和项目书确认行为处理，不能按截图名称猜测。

## 当前核对记录（讨论中，只读）

- 当前分支为 `main`，`HEAD` 为 `c452b789 Revert "fix: stabilize recommendation lifecycle and remote deduplication"`；工作树已有两个未提交的其他主题需求账本，未混入本轮。
- 被回退的 `98429723` 曾修改 `ControlledFavoriteLedgerPanel.tsx`、`favoriteLedgerApi.ts` 及对应测试；其需求账本中的 I008-I011 与本轮 I001-I005 高度相关，但本轮以用户当前原文和回退后的代码为准，不把上一轮“已实施待验证”当作事实。
- 当前需要优先确认的根因链：非整理状态的推荐 toggle 是否错误依赖工作区队列/未保存门禁；详情删除是否走了与删除模式不同的回调或陈旧投影；第二轮候选映射是否只在首轮工作区内存在、重开后丢失稳定 ID；下方取消是否命中了“只更新参与状态”而未进入纯草稿删除事务。

### R002

用户原文（完整）：

> 可以开个新分支做完，但必须合并，如果后续当前工作树没有改动优先在当前工作树改

本条为工作树与合并授权，不扩大推荐收藏夹业务范围。允许本轮在隔离分支实施，完成后合并回 `main`；若后续当前工作树无其它改动，可优先直接在当前工作树继续。

### R003

用户原文（完整）：

> 先迭代项目书，再按照项目书和账本改，开始（注意鼠标要一直流畅动，不要变卡，不要影响已有功能，仔细核对项目书）

本条确认实施顺序：先迭代项目书，再依据项目书和本账本修改代码；要求持续保持鼠标流畅、不影响已有功能，并在修改、测试和验收前仔细核对项目书。

### R004

用户原文（完整）：

> 讨论你是不是丢了一个设计，在整理收藏推荐收藏夹区域取消勾选，上方掌库收藏夹会取消勾选并删除

本条提出“下方推荐收藏夹取消”与“上方掌库收藏夹取消并删除”的设计疑问；删除适用的规则状态由 R008、R009 明确，不能按 `local-draft` 字段猜测。

### R005

用户原文（完整）：

> 非“整理收藏”期间，推荐收藏夹无法正常勾选和取消勾选，无法在详情页单独删除，好像不是没生效，而是点了没反应，我先点击删除，在点击整理收藏，这个收藏夹就被删除了
> 另外第二轮整理的时候不能识别到（当前掌库收藏区域，之前第一轮推荐收藏夹的勾选状态），比如上方是勾选状态，第二轮整理显示未勾选，但是可以点击重新建立联系，但不太符合预期

本条替代 I002 的故障表述：详情删除已在本地事务中完成但当前卡片/详情未立即收束，直到再进入“整理收藏”触发刷新才可见删除结果。并补充 I004：第二轮必须以当前掌库同稳定规则 ID的勾选状态初始化下方候选，不得默认未勾选后依赖用户手工重新建立联系。

### R006

附件文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6fc4b0ad-8153-47e2-b4b0-e443f4e4d401.png`

截图目标区域：

- 右侧上方“收藏夹”卡片中的 `honke...` 为已勾选；下方“整理收藏 > 推荐收藏夹 > 专属 UP 追更”中的 `honker233` 为未勾选。两者应由同一稳定规则 ID联动，截图是第二轮初始投影没有回填下方候选勾选的界面验收反例。

用户原文（完整）：

> # Files mentioned by the user:
>
> ## codex-clipboard-6fc4b0ad-8153-47e2-b4b0-e443f4e4d401.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6fc4b0ad-8153-47e2-b4b0-e443f4e4d401.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 如图
> <image name=[Image #1] path="C:\\Users\\diqing\\AppData\\Local\\Temp\\codex-clipboard-6fc4b0ad-8153-47e2-b4b0-e443f4e4d401.png">[Image #1]</image>

### R007

用户原文（完整）：

> 不只是删除，上方掌库收藏夹在非“整理收藏”期间 无法正常勾选和取消勾选

### R008

用户原文（完整）：

> “尚未写入账号规则的纯推荐草稿”  是什么意思，下边点击之后一般来说不就会生成收藏夹保存并勾选吗

### R009

用户原文（完整）：

> 可以

### R010

用户原文（完整）：

> 可以开个新分支做完，但必须合并，如果后续当前工作树没有改动优先在当前工作树改

## 逐项索引补充（R004-R010）

| 编号 | 原文引用 | 精确目标 | 目标界面 / 数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化 / 迁移 / B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I006 | R005 | 非“整理收藏”期间，推荐来源规则在详情页点击明确“删除”后必须立即从当前掌库卡片、详情编辑器和账号权威快照消失；不能等用户再次进入“整理收藏”才显示已删除。 | 上方掌库收藏夹详情“删除”入口、`deleteFavoriteLedgersLocal` IPC、父级账号偏好投影。 | 无活动工作区、已关闭整理工作区或其他非 previewing 状态下均适用。 | 成功回执后立即刷新/替换权威父快照；失败保留卡片和明确错误。 | 只删除本地规则；不删除 B 站远端收藏夹、不触发备册、同步或改名。 | 删除模式、普通规则与 previewing 工作区的既有重分类事务保持。 | `FavoriteLedgerOverview`、`ControlledFavoriteLedgerPanel`、`App.tsx` 偏好快照与 Electron 本地删除 IPC。 | 已确认，待实施 | 用户实际复现：先点击详情删除无视觉变化，进入“整理收藏”后才消失；待建立“IPC 成功即当前投影消失”的失败回归。 |
| I007 | R005、R006 | 第二轮出现与当前掌库规则同稳定 ID的推荐候选时，下方初始勾选必须镜像上方当前勾选/本轮参与状态；不得初始未勾选并要求用户手动重新勾选建立联系。 | 第二轮工作区 `recommendations.adoptedCandidateIds`、候选→规则 ID投影、上方/下方复选框。 | 仅同稳定规则 ID或已确认的候选映射；不同 ID同名项不得合并。 | 创建/恢复第二轮时依据当前已勾选掌库规则初始化对应候选采用状态；随后上下两侧继续双向联动。 | 只写当前工作区本地草稿/历史和已有账号级状态；不创建重复规则、不执行 B 站写入。 | 保留第一轮正常推荐、详情删除、删除模式、分类/备册/同步。 | 主进程新工作区初始推荐状态、`createRecommendationProjection`、renderer 初始投影。 | 已确认，待实施 | R006 截图：上方 `honke...` 已勾选、下方 `honker233` 未勾选；待建立跨轮初始化状态矩阵测试与 Electron 验收。 |
| I008 | R007 | 非“整理收藏”期间，上方掌库的推荐来源收藏夹必须可立即正常勾选和取消勾选；这不是仅详情删除的问题。 | 右侧面板上方“收藏夹”中的推荐来源掌库收藏夹卡片及账号级启用状态。 | 非“整理收藏”且存在该规则时适用；无论是否残留已完成/可恢复的工作区快照，都不得吞掉点击或用陈旧投影回滚。 | 点击后按稳定规则 ID持久化 `enabled`，成功后上方勾选立即与账号权威快照一致；不把取消勾选解释成详情删除。 | 仅更新本地账号规则/工作区投影；不改 B 站远端、不删除已保存规则、不触发备册/同步/改名。 | 不改普通收藏夹、整理期间已确认的草稿删除分流或删除模式。 | 上方卡片 click 路由、整理可见性、账号级 enabled 写入 IPC、偏好变更通知与父级快照回填。 | 已确认，待实施 | 用户实际复现“点了没反应”；待先用失败回归覆盖启用与取消及权威父快照回填，再在 Electron 开发版验证。 |
| I009 | R008 | 明确推荐候选“首次下方勾选”成功后的状态语义：它会生成掌库收藏夹规则、保存到账号规则目录并勾选；不得把仅未备册到 B 站的 `local-draft` 混同为未保存临时草稿。 | 下方推荐收藏夹首次采用、上方掌库卡片、`favoriteAccountPreferences.favoriteLedgers`。 | 保存成功回执后适用；保存失败或尚未完成回执的短暂过渡状态另行保留真实失败/重试。 | 之后下方取消、上方取消与详情删除的语义必须以“已保存规则”为前提重新核对。 | 本地账号规则保存；不因该澄清改变 B 站备册/绑定/同步边界。 | 不以字段名 `local-draft` 推断未保存或删除资格。 | 推荐采用保存链路、账号权威目录、删除和取消分流。 | 已确认，待实施 | 项目书 §9.4 已更新；待自动化与 Electron 验收。 |
| I010 | R004、R008、R009 | 在“整理收藏 > 推荐收藏夹”下方取消一个已由首次勾选生成、已保存到账号目录的推荐收藏夹时，必须同步取消勾选并删除上方同稳定规则 ID的本地掌库收藏夹规则。 | 下方推荐候选取消入口、上方掌库卡片/详情、`favoriteAccountPreferences.favoriteLedgers` 及当前整理工作区投影。 | 仅适用于该推荐候选与账号目录中同稳定 ID规则已建立映射，且下方取消操作成功时；保存失败、映射不一致或 B 站冻结执行态必须保留真实失败/受限状态。 | 下方取消 → 上方同 ID立即取消并移除；账号权威目录、当前工作区候选/分类投影一并收束；第二轮再次出现同 ID候选时不得从已删除规则错误回填。 | 仅删除本地掌库规则和必要本地工作区投影；绝不删除、改名、解绑、移动或同步 B 站远端收藏夹。 | 详情页明确删除、删除模式、普通收藏夹、不同稳定 ID同名候选及冻结/执行中的既有保护流程不改。 | 候选→规则稳定 ID映射、账号级本地删除事务、previewing 工作区重分类、完成/关闭工作区的快照刷新、第二轮候选初始化。 | 已确认，待实施 | 用户确认 R009；项目书 §9.4 已更新；待以失败回归和真实 Electron 界面验收分别证明。 |
| I011 | R002、R010 | 工作树策略：若根工作树无其它未提交主题，优先在当前工作树完成；否则可在隔离分支完成，但最终必须合并回本地 `main`。 | Git 工作树与分支。 | 实施开始时根据 `git status --short --branch` 判定。 | 不覆盖、隐藏或混入根工作树现有改动。 | 仅本地 Git 操作；不推送、不 rebase、不删分支/工作树，除非另获明确授权。 | 不改变本轮推荐收藏夹业务范围。 | 根工作树状态、隔离 worktree、最终合并。 | 已实施进行中 | 根工作树有其它主题未提交改动；本轮正在 `codex/recommendation-toggle-relink-rework` 隔离分支中实施，合并待验证后执行。 |

## 实施验收补录（稳定 ID 关联修订）

本补录追加于既有原文与索引之后，不删除或改写任何历史条目。根据项目书 §9.4 第 3、4、5 项和 R004–R009 的后续澄清，I003/I005 中“已保存推荐规则取消只保留规则”的旧行为已由 I010/R009 明确替代；原条目保留用于审计，实施按 I010 执行。

| 编号 | 本轮实际状态 | 代码位置 | 自动化证据 | 真实 Electron 界面验收 |
| --- | --- | --- | --- | --- |
| I001 / I008 | 已实施待真实验证 | `ControlledFavoriteLedgerPanel.tsx:62-69,806-864,1601-1656`：仅可见且 `previewing` 向导使用整理队列；收起/完成/恢复态上方推荐规则走账号级 `onSaveLedgerEnabled`。 | `ControlledFavoriteLedgerPanel.test.tsx`：`uses the account enabled preference when a completed recommendation snapshot remains mounted after the guide closes`；`FavoriteLedgerOverview.test.tsx`：`restores the account enabled state after a stale recommendation organization map is removed`；定向 313 项通过。 | 开发版已观察候选生成、滚动、步骤导航和窗口恢复；未对真实账号执行推荐规则勾选/取消，故账号持久化点击仍待验收。 |
| I002 / I006 | 已实施待真实验证 | `ControlledFavoriteLedgerPanel.tsx:943-958` 独立删除后刷新工作区与父级账号状态；详情删除回调与删除模式保持分离。 | `ControlledFavoriteLedgerPanel.test.tsx`：`reloads the authoritative workspace after a saved local rule is deleted from the upper ledger panel` 及详情/删除模式回归；定向通过。 | 未在真实账号点击详情删除；不能宣称即时视觉收束已完成真实验收。 |
| I003 / I009 | 已实施待真实验证 | `ControlledFavoriteLedgerPanel.tsx:514-566,573-641`：首次候选采用生成同 ID规则并保存账号目录；`local-draft` 不作为未保存判断。 | `ControlledFavoriteLedgerPanel.test.tsx`：`immediately saves a selected recommendation as an enabled unbacked ledger`、并发采用、父快照确认回归；定向通过。 | 已观察推荐候选真实生成，未执行真实账号首次采用保存。 |
| I004 / I007 | 已实施待真实验证 | `oldFavoriteWorkspaceCoordinator.ts:2472-2475,3286-3289,5702-5719`：新轮候选与 `listSavedEnabledLedgers` 的精确稳定 ID交集回填 `adoptedCandidateIds`；`ControlledFavoriteLedgerPanel.tsx:139-162` 仅允许 candidate.id === ledger.id，禁止同名/同关键词兜底。 | `oldFavoriteWorkspaceCoordinator.test.ts`：`adopts only exact trimmed saved-enabled recommendation ids when a fresh round rebuilds its candidates`；`ControlledFavoriteLedgerPanel.test.tsx`：`does not link a saved rule to a same-keyword recommendation with a different stable id`、稳定 ID上下联动回归；主进程 367/367、渲染器 313/313 通过。 | 未完成真实第一轮保存后第二轮重开；截图 R006 仍标记为待界面验收。 |
| I005 / I010 | 已实施待真实验证 | `ControlledFavoriteLedgerPanel.tsx:749-816`：下方取消仅在精确同 ID、已保存、推荐来源、无远端文件夹时调用 `deleteFavoriteLedgersLocal`；成功后移除候选/投影并刷新，失败恢复勾选并提示。`oldFavoriteWorkspaceCoordinator.ts:4016-4042` 先按当前候选稳定 ID精确撤除；仅候选 ID不匹配时保留旧规则语义兼容，绝不让同关键词但不同 ID候选被误删。 | `ControlledFavoriteLedgerPanel.test.tsx`：`deletes an adopted persisted recommendation rule when its exact lower candidate is deselected`、`keeps an adopted lower recommendation selected and reports failure when its local deletion fails`、远端绑定保留回归；`oldFavoriteWorkspaceCoordinator.test.ts` 覆盖同语义不同稳定 ID、旧语义删除与失败回滚；主进程 367/367、渲染器 313/313 通过。 | 未在真实账号执行下方取消删除；B 站远端无副作用仅由自动化断言验证。 |
| I011 | 已实施，合并待回归 | 隔离分支 `codex/recommendation-toggle-relink-rework` 的主题提交正在合并回本地 `main`；根目录原有 3 份需求账本已先做本地检查点 `3c582aa3`，未覆盖或混入业务改动。 | `git diff --check`、680 项定向套件、构建均在提交前重新运行；全量为 4275 通过、2 项无关旧失败。 | 合并提交后仍须在 `main` 重跑定向回归并检查工作树；真实 Electron 账号操作仍未验证。 |

### 本轮命名验证记录

- `npm.cmd test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --silent`：313/313 通过。
- `npm.cmd test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts --silent`：367/367 通过。
- `npm.cmd test -- --silent`：4275/4277 通过；失败仅为 `electron/installer/installer.finishPage.test.ts` 和 `electron/main/index.favoriteHistoryWiring.test.ts` 的既有断言，均不在本轮修改范围内。
- 以上仅为定向自动化证据；真实 Electron 的推荐勾选、详情删除、首次采用、第二轮重开和下方取消删除均仍待在测试账号上验收。
