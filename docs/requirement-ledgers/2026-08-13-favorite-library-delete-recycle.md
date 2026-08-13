# 收藏库 bilimi 删除、草稿与回收规则需求账本

本账本覆盖本主题从最初讨论到当前仍未进入实施的全部用户原文。讨论阶段未修改业务代码、测试、配置或真实数据；工作树中已有的未跟踪 `.claude/` 目录不属于本主题，保留不动。

## 编号说明

交接消息明确引用了清单编号 `R001`-`R006`，因此先按截图中的六条清单逐条保留其原文转录，再追加后续用户原文为新的 `R` 条目。此前清单形成前的完整用户消息使用 `P001`-`P033` 保留，避免改变交接中已经引用的 `R` 编号。所有条目均保留原文；状态只在索引中标注，不删除或改写原文。

## 原文区

### R001（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 1 行；用户后续明确说明该项与第 6 项是“不要”。

> 扫描页统计口径暂不处理。

### R002（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 2 行，绿色框选区域内；用户后续说明第 2-5 项继续讨论/保留。

> 两个删除入口成功后，侧边栏和收藏库统一刷新。

### R003（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 3 行，绿色框选区域内；用户后续说明第 2-5 项继续讨论/保留。

> 默认 bilimi 收藏夹删除：保留默认规则和稳定 ID，清空绑定并记录用户主动删除，禁止自动重建。

### R004（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 4 行，绿色框选区域内；用户后续说明第 2-5 项继续讨论/保留。

> 普通非默认 bilimi 收藏夹选择“仅从 bilimi 删除”时，B 站收藏夹保留；以后点击“备册”重新读取，并生成未绑定草稿提醒，确认后才绑定。

### R005（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 5 行，绿色框选区域内；用户后续说明第 2-5 项继续讨论/保留。

> 删除对象如果本身就是远端草稿，只删除本地草稿，不保存绑定，也不修改 B 站。

### R006（截图清单原文转录）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：黑底“本轮已确认”清单第 6 行；用户后续明确说明该项是“不要”。

> “清空收藏库整理记录”是否删除，尚未决定。

### R007（状态修正原文）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac1b2e2d-70e0-4ca7-ba3c-716f84296582.png`。

截图目标区域：绿色框选第 2-5 行；第 1、6 行未框选。用户原文：

> 还有2到5讨论，我当时说不要的是1和6

### R008（未保存草稿补充原文）

用户原文：

> 未保存都算草稿形态，删除的时候无论是b站未绑定还是新建没有保存都可以直接删，而不是要求用户先保存备册才能删，
> 未保存删除后本地草稿卡、视频成员和逻辑工作夹应该没有丝毫影响
> 不隐藏“从 B 站 bilimi 收藏夹删除”，但是未绑定前不可点击
> 远端文件夹 ID是什么，备册不是根据名字来识别为草稿的吗

### R009（术语澄清原文）

用户原文：

> 本地草稿卡是什么意思

术语说明：此前“本地草稿卡”不是用户界面正式术语，而是临时用于区分对象的说法；后续不得把它当作需求术语。代码层应区分：B 站远端未绑定 bilimi 文件夹候选（remote-only draft）、本地未保存草稿规则（local-draft ledger），以及收藏库视频成员和 bilimi 逻辑工作夹归属（repository 中独立数据）。

### P001

> 019ff984-e0ce-7040-9998-3cb5fbf83620继续这个对话的任务它卡住了

### P002

> 不，你接着它的任务做

### P003

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5907e69c-44f9-4948-9374-067fed5b30fd.png`。

截图目标区域：用户提供的绑定失败/识别结果界面；待界面验收。

> 讨论识别到了为什么绑定失败

### P004

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-191935ad-07e8-43f9-955a-4ec2fdfda679.png`。

截图目标区域：绑定结果区域；用户要求成功后的状态文案为“已备册”；待界面验收。

> 绑定失败，成功后要显示已备册。

### P005

> 开始

### P006

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-4195287d-4cfa-4814-890f-09ba968504f1.png`。

截图目标区域：绑定失败结果界面；待界面验收。

> 怎么还是不行

### P007

> 开始

### P008

> 重启项目。

### P009

> 现在没有合并到main吗

### P010

> 合并

### P011

截图文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6da22276-bd6c-4ec5-bb27-5dd02d5d18a2.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e32d4dac-f8c2-40ce-9f5f-17802fcf7d14.png`

截图目标区域：用户指出此前问题是否修复；待界面验收。

> 这个你是不是没修复，还记得怎么做吗

### P012

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-57060770-c7c2-4ddc-b8cc-86cd5286a9b2.png`。

截图目标区域：10 项清单中的第 4 项；用户要求先不修改其他问题；待界面验收。

> 先不改那个，你看这个10项中的第四项怎么没有实现呢

### P013

> 但是默认收藏夹删除你准备怎么处理

### P014

> 用户删除了非默认bilimi收藏夹，但b站没删，什么时候才能再次恢复草稿提醒呢

### P015

> 目前怎么识别恢复草稿的，是实时监测吗

### P016

> 册目状态核验比如说是什么具体的操作

### P017

> 那如果我在b站新建收藏夹是怎么识别的

### P018

> 我看点击备册的时候会识别到呀

### P019

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-44126631-f3d4-4d94-a687-be6c848080dd.png`。

截图目标区域：备册、删除和草稿提醒流程；待界面验收。

> 就用备册来实现这个操作，如果删除可以通过备册再恢复提醒草稿，如果本身就是草稿，删除的时候无需保存绑定，因为这不是从b站删除。

### P020

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-e88bb6fd-2d90-4bc8-80a9-87b55407a2fb.png`。

截图目标区域：收藏库整理记录功能；待界面验收。

> 清空收藏库整理记录的功能还有必要吗？

### P021

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-100338ba-8fbd-426f-b1fb-c0512da564e8.png`。

截图目标区域：收藏库列表与视频详情页的归属显示；用户指出收藏库未更新而详情页已变化；待界面验收。

> 但我点了之后收藏库没更新，视频详情页变了。

### P022

> 但是有重新整理，你放在暂存有什么意义呢

### P023

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8da5a9e0-011f-4b83-8b09-eaf9ffbd43e1.png`。

截图目标区域：视频详情页“更多批量操作”菜单中的“从收藏库删除”，以及详情页“其他操作”中的“从当前工作夹移除”；用户询问两者作用和区别；待界面验收。

> 我觉得不要了会比较好，这两个功能有什么作用和区别

### P024

> 我一开始想要的就是从收藏库删除这个功能，只是临时删除，它根从b站bilimi收藏夹删除，应该只是少一个同步b战斗功能其他完全一致

### P025

> 改名成，从收藏库bilimi收藏夹删除，去掉所有的清空收藏库记录功能，从 B 站 bilimi 收藏夹删除和从收藏库bilimi收藏夹删除，只会删除bilimi收藏夹，并对没有其他收藏夹来源的收藏放进收藏库

### P026

> 你查查从 B 站 bilimi 收藏夹删除放哪里

### P027

> 不，我的意思就是放进回收站，如果用户有其他收藏夹才不需要放进去，因为收藏库后面是会一直更新最新数据的，最新b站收藏夹没有这个视频，你多了，那就放进回收站，这个以前定好的，你看还在不

### P028

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-8f10482c-a5d3-42dd-9499-b60340294945.png`。

截图目标区域：B 站普通收藏夹页面与 bilimi 收藏库“其他收藏夹”入口；用户询问普通收藏夹的“从收藏库删除”是否遵循相同回收规则；待界面验收。

> 那其他收藏夹的从收藏库删除也是这样吗

### P029

> 这个忽略更新或者扫描就回来了吗

### P030

> 我想要的清空记录只是一次更新，更新当前数据为空，但是以后整理或者批阅又能重新记录

### P031

> 你觉得有删除还需要这个清库记录的功能吗

### P032

截图文件：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-3170a7ca-70ba-4a14-9ef4-1c29b3bcd459.png`。

截图目标区域：左侧“其他收藏夹”分组右侧三个点，以及普通收藏夹“番剧待看”右侧三个点；用户要求去除这些三个点功能；待界面验收。

> 那就把其他收藏夹三个点功能都去掉是吧

### P033

> 你把我们讨论的所有开一个新对话Terra极高来处理，让它按照agents.md更新的要求来完成

### R010（草稿删除与回收规则确认原文）

用户原文：

> 是的，因为大部分情况下它们是不存在收藏库的，而且收藏库会根据每次整理收藏实时更新，收藏库里对应不到多出来的收藏夹应该移除，如果b站没有这个收藏夹的对应视频，都放在回收站里

### R011（三种删除作用域方案原文）

用户原文：

> 或者你觉得删除功能要不要分为三种，删除收藏夹草稿，删除收藏库，删除实际b站，可以多选

本条进入设计讨论：候选作用域为 A“删除收藏夹草稿”、B“删除收藏库”、C“删除实际 B 站”，可多选；A/B/C 的对象、组合约束和远端副作用仍需用户确认。

### R012（删除范围二选一确认原文）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6fb25265-284b-4cf1-ac3b-0415b51cb14f.png`。

截图目标区域：`删除 bilimi 收藏夹`确认对话框中的“删除范围”单选项；绿色框选第二项“同时从 B 站删除收藏夹及其中分类视频”。截图中第一项为“仅从 bilimi 删除（保留 B 站收藏夹）”，第二项为同时删除；界面文字、单选状态、确认复选框和删除按钮均需在实施后验收。

用户原文：

> 二选一功能如果选了第二个是同时删除的

语义确认：第二个选项表示同时删除 bilimi 本地对应归属、B 站 bilimi 收藏夹文件夹，以及该文件夹中的分类视频；普通 B 站收藏夹不在删除范围内。

### R013（二选一与职责分开确认原文）

来源截图：`C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cb157d0d-e644-41ad-8dfd-2e76ae9b20ea.png`。

截图目标区域：删除职责/范围讨论区域；截图待界面验收。

用户原文：

> 你先别发，咱们讨论完你让它一起改，
> 你觉得各管各的好还是三个选项好，比如这里还是二选一，仅从bilimi删除（保留b站和收藏库）
> 收藏库只管收藏库和b站

### R014（二选一、两边分开确认原文）

用户原文：

> 可以那就二选一，两边分开，还有什么要讨论的吗1

### R015（继续确认原文）

用户原文：

> 可以

### R016（第一项确认原文）

用户原文：

> 可以第一个

### R017（无其他问题确认原文）

用户原文：

> 没问题

### R018（失败提示确认原文）

用户原文：

> 弹窗里提示未成功就行，保留原有提示，不要显示“待对账这个多余的新提示

### R019（开始确认原文）

用户原文：

> 没了那就开始

### R020（二选一替代三选项状态纠正原文）

用户原文：

> 账本状态纠正：用户原文『可以那就二选一，两边分开，还有什么要讨论的吗1』已明确替代之前『删除功能要不要分为三种…可以多选』的 UI 方案。因此“三种可多选”必须在索引中标为“被 R014 明确替代”，不是待定；实施只保留掌库删除工作夹的二选一，收藏库视频层两边分开的两个入口。

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标 UI/数据位置与条件 | 交互、状态、持久化与 B 站副作用 | 明确不改边界与依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|
| I001 | R001、R007 | 扫描页统计口径不处理 | 扫描页统计区域 | 未新增或改写统计行为 | 扫描统计、完整扫描安全语义均不在本轮范围 | 明确不做，已核对 | `git diff --name-only` 未含扫描页统计专用模块；分拆回归保留扫描/同步服务测试。 |
| I002 | R002、R014、R018 | 两个视频删除入口成功后统一刷新侧边栏、收藏库当前列表、详情和回收站计数；失败只显示已有未成功提示 | `FavoriteLibraryApp.tsx` 的详情/批量删除入口、`refresh()`、侧边栏/列表/详情/回收站数据 | `runAction` 与 `runDetailAction` 在本地删除后刷新；远端确认成功后显式 `refresh(accountMid)`；失败统一使用“删除未成功，请稍后重试”，不添加“待对账”展示 | 不修改扫描统计；远端结果未知仍由主进程安全记录/核验处理 | 已实施，待真实界面验收 | `FavoriteLibraryApp.test.tsx` 138 项通过，覆盖两入口、成功刷新、失败文案和详情；`favoriteRepositoryBatchOperationService.test.ts` 35 项、`favoriteRepositorySyncService.test.ts` 52 项通过。Electron 自动化读取窗口失败，见本账本实施记录。 |
| I003 | R003、R014-R017 | 默认 bilimi 删除保留默认规则和稳定 ID，清空绑定并记录用户主动删除，禁止自动重建，保留恢复/备册路径 | `favoriteLedgerDeletion.ts`、`managedFavoriteLedgerDeletionPersistence.ts`、`FavoriteLedgerOverview.tsx`、`index.ts` | 默认规则只清 remote/binding 字段并写入 `managedFolderDeletedByUser`；设置页显示“已删除 · 未备册”并提供“恢复备册收藏夹”；正式确认绑定后才清标记 | 默认规则 ID、远端核验、失败/未知保留本地受保护 | 已实施，待真实界面验收 | `favoriteLedgerDeletion.test.ts` 1 项、`managedFavoriteLedgerDeletionPersistence.test.ts` 5 项、`FavoriteLedgerOverview.test.tsx` 76 项、`App.test.tsx` 102 项均通过；真实默认项状态/恢复按钮尚未能通过 Electron 自动化核验。 |
| I004 | R004、R014-R017 | 普通非默认 bilimi 仅本地删除时移除本地工作夹、分类关系、绑定和草稿，B站保留；以后备册重新发现未绑定草稿，确认后绑定 | `favoriteRepositoryManagedFolderService.ts`、`favoriteLibraryManagedFolderProjection.ts`、`FavoriteLedgerOverview.tsx`、绑定 IPC | 本地删除不保留空逻辑工作夹；投影按名称提供候选但正式绑定依 `remoteFolderId`；未绑定远端视频入口保持显示且 disabled | 不改普通 B站文件夹/视频；不自动绑定或远端删除 | 已实施，待真实界面验收 | `favoriteLibraryManagedFolderProjection.test.ts` 17 项、`favoriteRepositoryManagedFolderService.test.ts` 41 项、`FavoriteLedgerOverview.test.tsx` 76 项、`App.test.tsx` 102 项通过；候选/绑定界面尚未能通过 Electron 自动化核验。 |
| I005 | R005、R008-R010 | 未保存远端候选和本地未保存草稿规则可直接删除；只删除草稿对象，不改收藏库视频成员、bilimi 逻辑工作夹归属或其他草稿规则 | `favoriteLedgerDraftDeletion.ts`、`assistant:delete-favorite-ledger-draft` IPC、`FavoriteLedgerOverview.tsx` | 远端未绑定草稿走草稿专用 IPC；本地未保存草稿直接移除本地草稿；两者均不调用受管工作夹/视频成员删除 | 不使用“本地草稿卡”术语；不触发回收或 B站删除 | 已实施，待真实界面验收 | `favoriteLedgerDraftDeletion.test.ts` 4 项、`favoriteLedgerDraftDeletionIpc.test.ts` 4 项、`FavoriteLedgerOverview.test.tsx` 76 项通过；草稿卡片删除交互尚未能通过 Electron 自动化核验。 |
| I006 | R006、R007、P020-P022、P030-P031、R019 | 移除用户可见“清空收藏库整理记录”入口、菜单、弹窗、调用、文案和对应 UI 测试；旧内部兼容可保留但 UI 不调用 | 普通收藏夹/工作区菜单与 `FavoriteLibraryApp.tsx` UI；内部 repository 命令保留兼容 | 用户界面不再渲染或调用清空入口；内部历史命令未被 UI 重新接入 | 整理详情、审计记录和旧持久化兼容不改 | 已实施，待真实界面验收 | `FavoriteLibraryApp.test.tsx` 138 项、`FavoriteLibraryNavigation.contract.test.tsx` 32 项、`FavoriteLibraryWorkspace.test.tsx` 31 项通过，含无入口/文案断言；生产 renderer 搜索无“清空收藏库整理记录”。 |
| I007 | P023-P025、P032-P033、R013-R019 | 掌库与收藏库职责分开；掌库工作夹删除保留二选一；收藏库视频层保留两个独立入口，本地文案为“从收藏库 bilimi 收藏夹删除” | `FavoriteLedgerOverview.tsx` 删除对话；`FavoriteLibraryApp.tsx` 详情；`FavoriteLibraryToolbar.tsx` 批量；导航分组 | 本地入口只移除当前 bilimi 本地归属，远端入口只删除当前已绑定 bilimi 归属；普通分组/单项三点菜单移除 | 普通 B站收藏夹及远端内容不改；不引入三选项/多选 UI | 已实施，待真实界面验收 | `FavoriteLibraryApp.test.tsx` 138 项、`FavoriteLibraryWorkspace.test.tsx` 31 项、`FavoriteLibraryNavigation.contract.test.tsx` 32 项、`FavoriteLedgerOverview.test.tsx` 76 项通过；精确文案、受管菜单和普通菜单边界均有测试。 |
| I008 | P025、P027-P029、R010、R013-R019 | bilimi 归属删除后有其他来源则保留收藏库；完整来源确认无来源后进入可恢复回收站，后续扫描可恢复 | `favoriteRepository.ts` 的 `recycle-favorites`、`delete-local-managed-folder`、完整扫描来源观察；主进程删除服务 | 仅完整且无来源时写 `kind: recycled`、`allowRediscovery: true`；来源不完整、远端失败或结果未知不回收 | 不走永久 `user-deleted` 或暂存；草稿删除不连带回收 | 已实施，待真实界面验收 | `favoriteRepository.test.ts` 60 项、`favoriteRepositoryBatchOperationService.test.ts` 35 项、`favoriteRepositorySyncService.test.ts` 52 项、`oldFavoriteWorkspaceCoordinator.test.ts` 277 项通过，覆盖有来源保留、无来源回收、未知不回收和重扫恢复。 |
| I009 | P028-P029、P032、R010、R013-R019 | 普通收藏夹历史 dismissed 不再影响扫描/投影；新流程不写永久 dismissed；仅保留并区分受管 bilimi 工作夹防重建保护 | `favoriteLibraryManagedFolderProjection.ts`、store 兼容读取、普通收藏夹导航 | 投影显式忽略 legacy `dismissedRemoteFolderIds`；旧普通忽略 IPC 不再注册；默认工作夹改用独立 `managedFolderDeletedByUser` 防重建 | 不误清默认/受管保护；不删除 B站普通收藏夹 | 已实施，待真实界面验收 | `favoriteLibraryManagedFolderProjection.test.ts` 17 项、`favoriteRepositoryIpc.test.ts` 40 项、`store.test.ts` 68 项及导航/App 测试通过；历史数据采用最小“读取忽略”迁移，非物理清除。 |
| I010 | R011、R012、R014、R020、P024-P027、R008-R010 | 工作夹删除只保留二选一；收藏库视频保留两边分开的两个入口，禁止三选项/多选 | `FavoriteLedgerOverview.tsx` 的“删除范围”单选；`FavoriteLibraryApp.tsx` 视频入口；受管删除服务 | “仅从 bilimi 删除（保留 B 站收藏夹）”与“同时从 B 站删除收藏夹及其中分类视频”二选一；视频远端入口未绑定时显示但 disabled；远端失败/未知保留本地且不自动重试 | 普通 B站收藏夹和视频不改；草稿删除不扩大为收藏库删除 | 已实施，待真实界面验收 | `FavoriteLedgerOverview.test.tsx` 76 项、`FavoriteLibraryApp.test.tsx` 138 项、`favoriteRepositoryManagedFolderService.test.ts` 41 项、`favoriteRepositorySyncService.test.ts` 52 项通过，覆盖二选一、未绑定限制、失败保留和远端安全顺序。 |

## 当前状态分组

### 已确认

- `R002`、`R014`、`R018`：删除成功统一刷新；失败只保留原有未成功提示。
- `R003`、`R014`-`R017`：默认删除保留规则和稳定 ID，清绑定、记主动删除、禁止自动重建并保留恢复路径。
- `R004`、`R014`-`R017`：普通非默认删除后可通过备册重新发现并确认绑定。
- `R005`、`R008`-`R010`：未保存草稿可直接删除且不影响独立收藏库/逻辑工作夹数据。
- `R013`-`R020`：掌库与收藏库职责分开；掌库二选一、收藏库两个独立入口。

### 明确不做

- `R001`：扫描页统计口径暂不处理。
- `R006` 经 `R007` 明确为“不要”：不保留用户可见清空整理记录入口；旧内部兼容只能不由 UI 调用。

### 被后续明确替代/不做

- 旧“从收藏库删除”永久 `allowRediscovery=false` 语义被 P024-P027 替代，改按来源判断并无来源时可恢复回收。
- 旧普通收藏夹永久 dismissed 入口行为被 P028-P032 替代。
- `R011` “三种可多选” UI 方案被 `R014`、`R020` 明确替代；实施只保留二选一和两个分开入口。

### 待用户决定

- 无。若实现中发现原文与现有数据模型不可调和，必须暂停并报告冲突。

## 实施前状态

用户已于 `R019` 明确说“没了那就开始”。实施前已按 R001-R020 原文和本索引逐条核对；本轮不再向用户索要选择。

## 实施与验证记录（2026-08-14）

- 本轮实现范围只覆盖 I001-I010。未读取、修改或暂存第二轮账本 `docs/requirement-ledgers/2026-08-14-old-favorite-scan-metrics-and-end-dialog.md`；根目录未跟踪文件 `1` 也不属于本轮。
- 定向测试按文件拆分运行并全部以 `exit 0` 结束，日志位于 `.codex-artifacts/first-round-verification/`（证据目录不提交）：
  - 共享/草稿/来源：`favoriteLedgerDeletion.test.ts` 1、`favoriteLedgerDraftDeletion.test.ts` 4、`favoriteLedgers.test.ts` 27、`favoriteLibraryOperations.test.ts` 2、`favoriteRepository.test.ts` 60、`favoriteLedgerDraftDeletionIpc.test.ts` 4、`managedFavoriteLedgerDeletionPersistence.test.ts` 5、`favoriteLibraryOperationSource.test.ts` 4。
  - 主进程：`favoriteLibraryManagedFolderProjection.test.ts` 17、`favoriteLibraryOperationsIpc.test.ts` 14、`favoriteRepositoryBatchOperationService.test.ts` 35、`favoriteRepositoryIpc.test.ts` 40、`favoriteRepositoryManagedFolderService.test.ts` 41、`favoriteRepositoryService.test.ts` 90、`favoriteRepositorySyncService.test.ts` 52、`oldFavoriteWorkspaceClassification.test.ts` 11、`oldFavoriteWorkspaceCoordinator.test.ts` 277、`store.test.ts` 68。
  - 渲染/API：`App.test.tsx` 102、`FavoriteLedgerOverview.test.tsx` 76、`FavoriteLibraryApp.test.tsx` 138、`FavoriteLibraryNavigation.contract.test.tsx` 32、`FavoriteLibraryWorkspace.test.tsx` 31、`favoriteLedgerApi.test.ts` 177。
  - 合计 24 个文件、1,308 项通过。`oldFavoriteWorkspaceCoordinator.test.ts` 的两条“自动 B站同步准备失败”日志为刻意覆盖的失败路径；没有断言失败。
- `npm test -- --reporter=dot` 在外层命令 303 秒上限后以 124 结束。截取日志没有断言失败，但有已有的 React `act(...)` 警告、批量菜单渲染警告和上述刻意失败日志；因此该全量命令状态必须如实记为“工具时限阻断，未取得完整退出码”，不能视为全量通过。
- Electron 开发版窗口 `bilimi` 已运行且只读列举成功；自动化读取窗口状态返回 `Error: node_repl exec context not found`。未点击删除、备册、同步或任何会改写用户数据的控件。因此以下真实界面验收仍受自动化环境阻塞：普通“其他收藏夹”三点菜单隐藏、二选一对话的实际布局/选中态、默认项“已删除 · 未备册”及“恢复备册收藏夹”、未绑定远端视频入口的 disabled 状态、失败提示、以及鼠标/点击/滚动/缩放/最小化/关闭交互。以上均不以测试替代实际验收。
- 提交前仍需执行 `git diff --check`、`git diff --stat`、`git status --short --branch` 并逐项确认暂存内容只属于本账本和 I001-I010。
