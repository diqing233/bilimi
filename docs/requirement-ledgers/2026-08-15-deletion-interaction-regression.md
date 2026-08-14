# 删除交互回归需求账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。原文区保持不变；后续分析、实施与验收只追加在索引表或实施记录中。

## 原文区

### R001

用户原文：

> 删除功能已经说的很清楚了，但是还是没有实现，右侧收藏夹不可勾选，收藏库删除直接应用空白无法点击了

### R002

用户原文：

> 默认收藏夹删除模式时不可勾选，都说了把，一种是取消绑定恢复默认，一种是未备册

### R003

截图文件路径：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ce8d600a-e742-4430-b375-09c9ff8426e2.png`

截图目标区域：历史讨论原文中红线标注“默认收藏夹不能删除”；同一截图底部 Electron 开发终端显示错误：`Error occurred in handler for 'assistant:write-preference-patch': Error: This preference patch requires the full save path.`，堆栈定位到 `out/main/index.js:26621:25`。

用户原文：

>

### R004

用户原文：
> 你当时没理解我的意思，是这个卡片不能删除，明明和当前设计有区别你没理解也不追问下，删除模式下，默认收藏夹可以勾选，删除bilimi会让它恢复默认模式，名字标签等，变成未绑定状态，不能参与分类，删除b站收藏夹，那就连b站实际收藏夹删除，我说清楚了吗

### R005

用户原文：
> 未绑定本来就是这样设计的，还需要额外增加功能吗

### R006

截图文件路径：
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-594a1fb5-750a-445e-b158-2dda9e57d0c6.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e8d874f8-abed-4f7d-9ae7-7e806cfc3046.png`

截图目标区域：第一张截图为收藏库左侧单个 `bilimi·知识学习` 工作夹触发的“删除 bilimi 收藏夹”弹窗，弹窗错误地出现候选工作夹复选框与“全选”；第二张截图为勾选该候选后收藏库内容全部消失，仅剩浅蓝色空白背景。另一个目标是收藏库顶部管理菜单中的批量“删除工作夹”入口，用户点击后当前没有任何响应。

用户原文：
> # Files mentioned by the user:
>
> ## codex-clipboard-594a1fb5-750a-445e-b158-2dda9e57d0c6.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-594a1fb5-750a-445e-b158-2dda9e57d0c6.png
>
> ## codex-clipboard-e8d874f8-abed-4f7d-9ae7-7e806cfc3046.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e8d874f8-abed-4f7d-9ae7-7e806cfc3046.png
>
> ## My request:
> 收藏库这里勾选bilimi知识学习就会白屏，而且单个删除不需要给勾选选项
> 删除工作夹才需要，但是现在点击也没反应了

### R007

截图文件路径：
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ef8b41ef-c737-4f95-bbef-d61153cc7485.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a37f7a58-0190-4de1-a2e6-1e2dcb076085.png`

截图目标区域：第一张截图为“其他收藏夹”中的 `崩坏三` 范围，视频列表上方批量操作工具栏被框选；第二张截图为“全部收藏”范围，视频列表上方批量操作工具栏被框选。两处都涉及批量操作可用项，以及视频详情页中的删除功能显示。

用户原文：
> # Files mentioned by the user:
>
> ## codex-clipboard-ef8b41ef-c737-4f95-bbef-d61153cc7485.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ef8b41ef-c737-4f95-bbef-d61153cc7485.png
>
> ## codex-clipboard-a37f7a58-0190-4de1-a2e6-1e2dcb076085.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-a37f7a58-0190-4de1-a2e6-1e2dcb076085.png
>
> ## My request:
> 其他收藏夹和全部收藏的批量操作功能不太对，除了移动至和同步到b站其他功能都有包括删除功能，页面详情也能看到删除功能

### R008

截图文件路径：
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ffed9292-acf7-4204-a948-426f4065a6ec.png`

截图目标区域：收藏库视频详情页“其他操作”区域被框选，包含“从收藏库 bilimi 收藏夹删除”和“从 B 站 bilimi 收藏夹删除”两个已有按钮。详情“初始来源”同时显示 `bilimi·影视动漫（bilimi 工作夹）` 与 `番剧分支（普通收藏夹）`，用于说明删除不能影响普通 B 站收藏来源。

用户原文：
> # Files mentioned by the user:
>
> ## codex-clipboard-ffed9292-acf7-4204-a948-426f4065a6ec.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ffed9292-acf7-4204-a948-426f4065a6ec.png
>
> ## My request:
> 这两个都是删除bilimi的本来就有，也不影响用户收藏带着

### R009

用户原文：
> 好了还有没确定，或者歧义吗

### R010

用户原文：
> 这两个功能现在没有做好吗，之前讨论过有可勾选项，你是查了代码才这么问的吗

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001；关联 `2026-08-14-deleted-ledger-binding-state-recovery.md` 的 R015-R016/I010 | 已保存的右侧 bilimi 收藏夹必须可勾选；仅未保存草稿不可勾选。 | 右侧助手“收藏夹”卡片的加入/移出同步控制。 | `syncState: 'local-draft'` 时不可勾选；保存成功后移除该草稿状态并立即恢复可勾选。默认收藏夹的既有固定选择规则不变。 | 保存后更新右侧卡片可操作状态与备册资格；不把未保存草稿错误视为已保存。 | 保存的本地偏好应持久化；此变更本身不创建/删除 B 站收藏夹。 | 不改变默认收藏夹不可取消、未保存草稿不可勾选、备册仅面向已保存且勾选收藏夹的既有规则。 | 右侧保存回调、`syncState` 投影、备册资格与本地偏好持久化。 | 已定位待实施 | 当前 `FavoriteLedgerOverview.tsx` 以 `syncState === 'local-draft'` 禁用勾选；`buildSaveFavoriteLedgersScript` 返回保存后的 ledger 时未清除该标记，导致保存后仍被禁用。需补失败回归测试和真实 Electron 验收。 |
| I002 | R001；关联 `2026-08-14-deleted-ledger-binding-state-recovery.md` 的 R024-R028/I014 | 收藏库“删除工作夹”必须展示可选择的候选并按既定两种范围执行；不得出现空白且无法继续的删除入口。 | 收藏库左侧 bilimi 工作夹管理菜单、“删除工作夹”弹窗。 | 弹窗默认不选择任何候选；用户可单选或点“全选”，再勾选确认后才能点击删除。候选预览失败/为空时必须显示可理解错误而非空白交互。 | 单项/批量均复用同一删除弹窗；仅收藏库删除与同时删除 B 站两个范围保持可选条件正确。 | 仅收藏库删除保留右侧规则和 B 站；同时删除 B 站仍保留右侧规则和草稿，按真实远端结果处理。 | 不把视频列表勾选混入工作夹删除；不把默认“未选”误变为不可操作；不改变用户已确认的二次确认。 | 工作夹候选预览、逻辑工作夹状态、local execution token、删除弹窗状态。 | 待真实复现与根因定位 | 自动化覆盖正常候选的默认未选/全选流程；尚未获得用户所述“空白无法点击”的窗口状态或错误信息，需先区分候选为空、预览失败、未选择候选和确认未勾选四种路径。 |
| I003 | R002、R004；关联 `2026-08-14-deleted-ledger-binding-state-recovery.md` 的默认收藏夹删除规则 | 右侧删除模式中的默认收藏夹可以勾选，但默认卡片不被永久删除。选择“删除 bilimi”时，恢复系统默认模式（默认名称、标签、规则等），状态为“未绑定”，且不参与分类；选择同时删除 B 站时，还要删除对应实际 B 站收藏夹，状态应为“未备册”。 | 右侧助手“收藏夹”卡片、删除范围弹窗、默认收藏夹规则与绑定状态。 | 仅右侧删除模式可勾选默认卡；正常模式既有默认收藏夹选择约束不变。默认卡始终保留在界面，状态、名称、标签、规则均由删除后的实际本地/远端情况决定，不显示人为的“已删除”特殊状态。 | “删除 bilimi”重置默认卡的本地 bilimi 规则与绑定；“同时删除 B 站”额外执行远端删除。两种路径都不得把默认卡当作自建卡直接移除。 | 重置后的默认卡状态与分类资格必须持久化；远端删除成功/失败按实际结果呈现，不能只按所点操作预设状态。 | 不把此默认卡逻辑扩展到自建收藏夹；不改未保存草稿不得勾选的规则；不影响左侧收藏库工作夹的独立删除范围。 | 右侧选择状态、默认规则恢复、绑定状态投影、分类资格、B 站删除服务与失败提示。 | 已确认，待实施 | R004 原文；实施后须覆盖两种删除范围的持久化与 Electron 界面验收。 |
| I004 | R005 | 不新增独立的“禁止分类”开关或第二套状态；复用既有“未绑定不得参与分类”的统一资格判断。当前代码没有兑现该规则，应修复原有资格判断，而不是扩展新功能。 | 共享收藏夹能力判断、整理收藏与批阅分类候选入口。 | `bindingState === 'unbound'` 时统一排除；重新备册成功并进入 `bound` 后按既有启用规则恢复资格。 | 删除默认收藏夹的 bilimi 关系只需正确落入“未绑定”，分类层应自动遵守统一规则。 | 不新增额外持久化字段，不引入操作专属提示或删除专属分类状态。 | 不改变“未绑定”的既有产品含义；不创建仅默认收藏夹适用的重复逻辑。 | 绑定状态投影、共享能力判断、整理收藏分类、批阅分类。 | 已确认，已定位待实施 | `videoClassifier.ts` 的候选过滤未检查 `bindingState`；`effectiveFavoriteLedgersForAccount` 还会强制启用默认收藏夹；`resolveFavoriteLedgerCapabilities` 仅排除 `local-draft`，把普通 `unbound` 判为可分类。实施时应在共享资格边界修复并覆盖所有分类入口。 |
| I005 | R006 | 分离收藏库单个工作夹删除与批量“删除工作夹”交互：单删弹窗只确认当前工作夹及删除范围，不出现候选复选框或“全选”；批删入口才显示默认未选、可单选/全选的候选列表。修复单删勾选导致的整页白屏，以及批删点击无响应。 | 收藏库左侧单个 bilimi 工作夹菜单、顶部管理菜单“删除工作夹”、删除确认弹窗、收藏库根页面错误边界。 | 单删始终锁定当前工作夹；批删打开后才展示候选勾选。任何选择操作、预览失败或空候选都不得让收藏库白屏。 | 单删选择范围后确认执行；批删先选择候选与范围，再进行既有确认。入口必须有真实加载、空态或错误反馈，不能无响应。 | 两个入口复用底层删除执行语义，但保持各自选择模型；点击和勾选阶段不得提前修改收藏库或 B 站数据。 | 不改变已确认的“仅从收藏库删除/同时从 B 站删除”两种范围，不改变右侧收藏夹删除规则。 | 候选预览、弹窗状态初始化、React 列表渲染、单删目标传递、批删入口事件、错误处理。 | 已确认，部分根因已定位 | 单删调用 `openManagedFolderDeletion([id])`，与批删共用候选选择模型，故错误出现复选框/全选。运行终端确认批删预览报 `Favorite repository remote folder verification failed`，当前错误映射为通用失败而看似无响应。现有 `FavoriteLibraryApp.test.tsx` 138 项通过但未覆盖单删勾选，白屏仍需在修复后以真实 Electron 路径验收，不得把测试通过视为已复现。 |
| I006 | R007、R008 | “其他收藏夹”和“全部收藏”范围的批量操作中，除“移动至”和“同步到 B 站”外，保留所有适用功能，包括两个既有 bilimi 删除；视频详情页也显示这两个删除功能。 | 收藏库左侧“其他收藏夹”及“全部收藏”范围的视频列表批量工具栏、更多批量操作菜单、视频详情页“其他操作”。 | 在上述范围隐藏“移动至”“同步到 B 站”；其他可适用操作与“从收藏库 bilimi 收藏夹删除”“从 B 站 bilimi 收藏夹删除”均不因范围而消失。 | 两种删除均只面向该视频的 bilimi 工作夹归属：本地删除只删收藏库 bilimi 归属；远端删除只删已同步 B 站 bilimi 归属。即使当前范围是普通收藏夹或全部收藏，也必须从视频真实归属中解析其 bilimi 关系。 | 普通 B 站收藏夹、用户收藏和其他非 bilimi 来源必须保留；没有其他实际收藏夹来源时，沿既有规则进入回收站并保留本地信息。 | 不改变 bilimi 工作夹范围已确认的移动、同步及双范围删除逻辑；不允许普通收藏夹删除，也不引入普通 B 站收藏夹的远端修改权限。 | 批量操作范围判断、详情操作可用性、每视频 bilimi 归属解析、删除预览、回收站判定与确认。 | 已确认，待实施 | R008 截图显示 bilimi 与普通收藏夹并存的来源；两个删除按钮仅删 bilimi 归属。当前普通 B 站收藏夹允许项为复制、重新整理、文档导出，全部收藏则允许移动/同步且没有删除，详情删除仅以当前 bilimi 工作夹为条件，均与本项不符。 |
| I007 | R009、R010；关联 I006 | 复用当前详情页已有的“同时从其他 bilimi 工作夹移除”勾选模型：在“全部收藏/其他收藏夹”的详情与批量删除中，也允许用户勾选要一并删除的其他 bilimi 工作夹归属。无需用户重新决定删除目标。若选中视频没有 bilimi 归属，两个删除入口保持可见但不修改用户收藏，执行时显示跳过数量。 | 全部收藏及其他收藏夹范围的批量删除确认、视频详情删除确认。 | 默认选择现有 bilimi 归属的既有目标；多归属时展示已有的可勾选其他 bilimi 工作夹选项；无 bilimi 归属时不能执行实际删除。 | 本地删除与 B 站删除仍分别执行既有 bilimi 语义。 | 不影响普通 B 站收藏夹、用户收藏、档案、转写、处理记录。 | 不改变当前 bilimi 工作夹页面“默认当前工作夹、可选同时删除其他工作夹”的既有行为；不创建另一套选择交互。 | 每视频 bilimi 归属解析、已有删除确认弹窗、批量确认文案、回收站判定。 | 已确认，待实施 | 已核对 `FavoriteLibraryApp.tsx`：当前 bilimi 工作夹详情在“从收藏库 bilimi 收藏夹删除”和“从 B 站 bilimi 收藏夹删除”流程中已有“同时从其他 bilimi 工作夹移除”复选项，但渲染被 `currentLogicalFolderId` 限制，全部/普通收藏夹范围看不到。R010 明确要求复用该既有设计。 |

## 讨论与诊断记录（2026-08-15）

- I001 根因已确认：`FavoriteLedgerOverview.tsx` 正确地把 `syncState: 'local-draft'` 视为“未保存”并禁用勾选；但 `favoriteLedgerApi.ts` 的 `buildSaveFavoriteLedgersScript` 在“保存规则”成功返回时没有移除新建本地草稿的 `syncState: 'local-draft'`。因此已保存的自建收藏夹仍被 UI 误判为未保存，无法勾选、无法进入备册或分类目标。修复必须仅在规则本地保存成功时将本地新建草稿转换为已保存状态；B 站识别到的未绑定远端草稿仍必须保留 `local-draft + unbound`，不可混同。
- I002 当前代码的正常流程是：弹窗默认无选择（符合 R027），点工作夹复选框或“全选”并勾选“我已确认”后“删除”才可点击。`managedFolderDeletionCandidates` 对每一个实际传入的逻辑工作夹都会产生 bound、unbound-name-match、missing-remote 或 local-only 候选，正常路径不可能渲染空候选列表。若管理菜单收集不到任何 `bilimi-logical` 工作夹，入口会直接报“选择为空/不可用”而非有效删除弹窗；这说明该收藏夹尚未在收藏库形成工作夹，不能按左侧工作夹删除。需要真实窗口截图或精确点击路径确认用户所见是“候选区为空”、入口报错，还是仅尚未选择候选/确认。桌面自动化亦未能初始化：`@oai/sky` 运行时不提供技能要求的 `sky.documentation` 接口，不能在不点击删除的前提下读取 Electron 窗口。
- R002 的此前解释被 R004 明确替代：默认收藏夹在右侧删除模式中可以勾选，但只能执行 R004 定义的“恢复默认并未绑定”或“同时删除 B 站后未备册”两条路径；不得作为普通自建收藏夹卡片直接移除。R002 原文保留作为讨论历史。
- R003 诊断更正：截图中的 `assistant:write-preference-patch` 错误来自“保存收藏夹规则”的快速局部写入尝试：`FloatingAssistantApp.tsx` 的规则保存调度器先调用该 IPC，捕获其“必须走完整保存”错误后回退到 `assistant:patch-preferences`。因此这是会污染 Electron 终端的无效快速路径，不是右侧单项勾选的直接通道。右侧勾选走专用 `assistant:write-favorite-ledger-enabled`，已具备独立持久化 IPC；已保存自建夹仍不可勾选的直接根因仍为 I001 的 `local-draft` 未在保存成功后清除。修复 R003 时应删除该不适用的快速写入尝试或直接使用完整保存协议，且不得放开默认收藏夹在删除模式中的勾选。

## 实施与验收记录（2026-08-15）

- I001（R001）：已确认现有保存路径会在新建本地草稿成功保存时清除 `syncState: 'local-draft'`，而 B 站识别到的远端草稿保留该状态。代码：`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx` 的 `save`、`isTransientNewDraft` 与 `isRecoveredRemoteDraft`。自动化：`FavoriteLedgerOverview.test.tsx` 已覆盖新建草稿不可勾选、保存后恢复普通已保存状态和远端草稿仍不可勾选；2026-08-15 定向 312 项通过。真实 Electron：待验收。
- I002（R001）：已实施工作夹候选预览错误的可见反馈路径，候选为空或预览失败不会继续进入空白确认状态。代码：`src/renderer/src/features/favorites/FavoriteLibraryApp.tsx` 的 `openManagedFolderDeletion`、调用入口的 `favoriteLibraryActionFailureMessage`。自动化：`FavoriteLibraryApp.test.tsx` 的批量候选选择与范围确认覆盖；2026-08-15 定向 312 项通过。真实 Electron：待用用户当前账户复现原“空白无法点击”路径。
- I003（R002、R004）：已实施默认收藏夹在右侧删除模式可勾选；本地删除恢复默认模板并落为“未绑定”，远端实际删除最后一个绑定后保留卡片并落为“未备册”。代码：`FavoriteLedgerOverview.tsx` 的 `requestSync` 与 `finalizeManagedDeletionPlan`、`src/shared/favoriteLedgerDeletion.ts`。自动化：`FavoriteLedgerOverview.test.tsx`、`favoriteLedgerDeletion.test.ts`；2026-08-15 定向 312 项通过。真实 Electron：待验收两种删除范围及远端失败状态。
- I004（R005）：已在共享能力边界排除 `bindingState: 'unbound'`，未增加新的持久化状态。代码：`src/shared/favoriteLedgerCapabilities.ts`、两份 `videoClassifier.ts`。自动化：`favoriteLedgerCapabilities.test.ts`、共享与渲染分类测试；2026-08-15 定向 312 项通过。真实 Electron：待验收未绑定收藏夹不进入整理收藏与批阅分类候选。
- I005（R006）：已分离收藏库单删与批删弹窗；单删锁定当前工作夹且不渲染候选复选框或“全选”，批删默认不选并保留全选。代码：`FavoriteLibraryApp.tsx` 的 `managedFolderDeletionDialog`、`openManagedFolderDeletion` 与确认弹窗。自动化：`FavoriteLibraryApp.test.tsx` 的 `locks a single work-folder deletion...`、`requires an explicit managed-folder selection...`；2026-08-15 定向 312 项通过。真实 Electron：待验收白屏不再出现。
- I006（R007、R008）：已在普通 B 站收藏夹和全部收藏范围保留两个 bilimi 删除入口，同时保持“移动至”“同步到 B 站”隐藏。每次删除按视频真实 bilimi 归属解析，普通 B 站来源不作为目标。代码：`FavoriteLibraryApp.tsx`、`src/shared/favoriteLibraryOperations.ts`、`electron/main/favoriteLibraryOperationsIpc.ts`、`electron/main/favoriteRepositoryBatchOperationService.ts`。自动化：渲染、共享、IPC、服务测试均在 2026-08-15 定向 312 项内通过。真实 Electron：待验收。
- I007（R009、R010）：已复用“同时从其他 bilimi 工作夹移除”的单个复选交互；全局或普通收藏夹范围未找到 bilimi 归属时保留入口并显示跳过数量，不修改普通来源。代码：`FavoriteLibraryApp.tsx` 的 `bilimiMembershipSource`、本地/远端详情与批量确认；服务层 `resolveBilimiTargets`。自动化：`FavoriteLibraryApp.test.tsx`、`favoriteRepositoryBatchOperationService.test.ts`、`favoriteLibraryOperationsIpc.test.ts`；2026-08-15 定向 312 项通过。真实 Electron：待验收。

本轮构建证据：`npm run build` 于 2026-08-15 退出码 0。实机验收受当前桌面自动化运行时阻塞：`@oai/sky` 不提供要求的 `sky.documentation` 接口；为避免对用户真实 B 站数据执行删除，未以未验证的自动化替代真实操作。以上 I001-I007 状态均为“已实施待真实界面验收”，不得视作已完成的实机验收。
