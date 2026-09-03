# 备册改名与重复草稿问题

## 原文需求

### R001

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-f750551c-436c-4a2b-90f0-fb2db93d9396.png`（图一：B 站收藏夹改名后掌库状态与备册入口；待界面验收）
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-15853175-1579-4309-bef8-85ce5b99dd27.png`（图二：确认绑定 bilimi 收藏夹弹窗；待界面验收）
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-5f827d52-eba8-40ae-8cf4-af70f3d8ff59.png`（图三：整理收藏后出现重复草稿；待界面验收）

截图目标区域：图一 B 站改名后的实际收藏夹、掌库卡片/详情中的未备册或未绑定状态和备册入口；图二确认绑定弹窗及确认后的远端改名说明；图三 `bilimi·你好` 的重复草稿卡片、各自状态以及 B 站实际只有一个收藏夹的对照。截图不能替代稳定规则 ID、远端 `folderId`、主进程权威快照和真实 Electron/账号验收。

原文：

> 讨论模式，我在b站改名后掌库收藏夹提示的是未备册（图一），应该是未绑定，点击备册识别到后出现弹窗提示，如果用户确认后会把b站收藏夹的名字改成当前收藏夹的名称
> 图二我改的是掌库收藏夹的名字，点击备册后，b站实际名称没有更新，
> 应该按照掌库收藏夹为准，以上两种情况备册后会把b站收藏夹的名字改成当前收藏夹的名称，
> 图三bilimi你好是我自己在b站创建的按照规则会生成草稿，但是我点击整理收藏，再次点击备册，又生成了一个草稿2，b站实际只有一个，不要反复创建
> 你查下项目书和代码确定改进方案

### R002

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-d1f9cf21-d3c2-4e9a-a175-dc1ac2eabcee.png`（补充图：点击备册后识别到名称变化但确认绑定未按掌库名称生效；待界面验收）

截图目标区域：确认绑定 bilimi 收藏夹弹窗中的收藏夹名称、分册名称、改名后的目标文案和不应显示的远端 ID；截图中“知识学习”和“影视动漫”两组分册的改名方向分别以掌库当前名称为准。

原文：

> 给你补充一张图片，目前点击备册后能识别到名字有变化，但是不能正常生效
> **bilimi·知识学习你好是**掌库收藏夹的名字 ，当前b站是bilimi·知识学习，点击确认绑定后b站名称应该变成**bilimi·知识学习你好**
> **bilimi·影视动漫是**掌库收藏夹的名字 ，当前b站是bilimi·影视动漫你好 ，点击确认绑定后b站名称应该变成**bilimi·影视动漫**

> 弹窗文案也说明白，不用显示id
> **知识学习你好（共 0 个视频）**
> 分册 1：bilimi·知识学习（0 个视频，绑定后b站收藏夹名字会更改为**bilimi·知识学习你好**）
> **影视动漫（共 0 个视频）**
> 分册 1：bilimi·影视动漫你好（0 个视频，绑定后b站收藏夹名字会更改为**bilimi·影视动漫**）
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d1f9cf21-d3c2-4e9a-a175-dc1ac2eabcee.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d1f9cf21-d3c2-4e9a-a175-dc1ac2eabcee.png)</image>

### R003

时间：2026-09-03

原文：

> 推荐草稿是目前不存在的功能吧

### R004

时间：2026-09-03

原文：

> 不要猜测，实际去查

### R005

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-21197c8e-ec92-4b68-8b2e-41f3cd580f9b.png`（刚刚复现后：B 站只有一个 `bilimi·你好`，掌库同时显示 `你好①`、`你好②`；待界面验收）

截图目标区域：B 站左侧实际收藏夹 `bilimi·你好`，掌库右栏 `你好①`、`你好②` 的卡片、各自“未保存·未绑定”状态，以及“检测到 B 站中有 2 个疑似 bilimi 工作夹：2 个未保存未绑定”的提示。

原文：

> 我刚刚复现了你可以查查日志
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-21197c8e-ec92-4b68-8b2e-41f3cd580f9b.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-21197c8e-ec92-4b68-8b2e-41f3cd580f9b.png)</image>

### R006

时间：2026-09-03

原文：

> 查完了吗

### R007

时间：2026-09-03

原文：

> 当前工作树有没提交的吗

### R008

时间：2026-09-03

原文：

> 先迭代项目书，再按照项目书和账本改，开始（注意鼠标要一直流畅动，不要变卡，不要影响已有功能，仔细核对项目书）

### R009

时间：2026-09-03

原文：

> 继续

## 逐项索引

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001/R002 | B 站改名但仍是本地已知精确远端 ID时，掌库显示`未绑定`而不是`未备册`；点击备册识别该精确候选，用户确认后按当前本地册名改写 B 站标题并恢复正式绑定。确认弹窗不显示远端 ID，改名副作用单独明确展示。 | `FavoriteLedgerOverview` 卡片/详情、备册确认弹窗、`favoriteLedgerApi.ts` 状态投影、`App.tsx` 绑定登记、主进程绑定服务。 | 仅精确 ID存在且远端标题与本地册名不一致时进入；检测和未确认阶段不得改名/绑定/同步。 | 候选弹窗显示本地逻辑名称、远端当前名称、视频数和绑定后改名目标，不显示 ID；确认后改名、复读校验、提交物理分册绑定；失败保留未绑定候选和可重试原因。 | 允许一次明确确认后的 B 站改名和本地正式绑定；不写视频、不自动同步成员。 | 不按名称自动认领、不新建第二个规则/远端夹、不改变删除知情同意、整理分类、归档预览和视频同步。 | 稳定规则 ID、正式 `physicalShards`、远端目录读取、rename-folder bridge、绑定事务和状态刷新。 | 已确认，已实施待验证 | `src/renderer/src/App.tsx:1808` 补足无标题分册号候选；`electron/main/favoriteRepositoryBindingService.ts` 对已确认精确 ID 允许旧标题不带 bilimi 前缀仍执行改名、复读；`favoriteRepositoryBindingService.test.ts` 覆盖。掌库/收藏库绑定弹窗隐藏 ID并显示目标由 `FavoriteLedgerOverview.tsx` 与 `FavoriteLibraryApp.tsx` 覆盖；当前开发版无漂移候选，真实账号改名确认链路待用户提供可复现场景后验收。 |
| I002 | R001 | 掌库本地册名改变后，下一次明确点击备册也必须以当前本地册名为准更新 B 站实际标题；不创建重复收藏夹。 | 掌库编辑保存、备册脚本、远端 `folder/edit` 或绑定服务改名链路、状态回写。 | 远端精确 ID仍存在且标题与当前本地册名不一致；普通状态读取不产生改名。 | 备册阶段执行改名并校验，成功后本地/远端标题一致且显示`已备册`；失败保留真实未绑定/待重试状态。 | 允许明确备册操作产生一次 B 站改名；保留同一规则 ID和远端 ID。 | 不在被动轮询、启动检查或普通本地保存时自动改名；不按同名猜测。 | 本地规则持久化、远端 ID投影、备册候选确认/直接备册分流、主进程远端写入。 | 已确认，已实施待验证 | `src/renderer/src/App.tsx:1808` 将已知 ID/显式分册号传入 `allowRemoteRename` 绑定路径；`src/renderer/src/App.test.tsx` 覆盖本地名与远端名不一致时的显式改名登记；`favoriteLedgerApi.test.ts` 与 `favoriteRepositoryBindingService.test.ts` 覆盖“精确 ID 已由用户确认、B 站旧标题为不含 bilimi 前缀的手动名称”仍能交接到主进程改名/绑定；当前未执行真实 B 站改名。 |
| I003 | R001/R003 | B 站实际只有一个远端夹时，整理收藏和备册流程不得重复创建或重复投影；应按稳定规则 ID和精确 `folderId`合并，真正不同 `folderId` 的同名夹仍分别保留。`recommendation-draft` 目前仅能作为代码内部来源标记，不能未经界面/现场证据认定为用户实际看到的功能。 | `ControlledFavoriteLedgerPanel` 推荐投影、`favoriteLedgerApi.ts` 的 `appendRemoteOnlyDrafts`/`projectRemoteOnlyDrafts`、备册回执和账号权威快照。 | 同一稳定规则或同一精确远端 ID已被本地规则/绑定/待对账记录占用时隐藏重复投影；不同 ID不合并。若当前版本没有实际推荐入口或采用动作，则不得把该状态名当作用户可见功能依据。 | 整理→保存→备册→状态刷新全过程只保留一条实际夹记录；创建/绑定回执先合并再投影，失败/待核对保留可恢复事实。 | 不删除或合并真实不同远端夹；不按标题、数量、列表次序猜测身份；不重复创建。 | 不改变当前实际存在的整理、备册、推荐入口和视频同步语义；不凭内部状态名扩大需求范围。 | 推荐规则持久化、备册创建/绑定回执、远端目录读取、正式仓库投影、缓存失效/刷新顺序。 | 已确认，已实施待验证 | `src/shared/favoriteLedgers.ts:7` 提供无碰撞可逆 `custom-remote-<encodeURIComponent(folderId)>`；`electron/main/oldFavoriteWorkspaceCoordinator.ts:1065`、`electron/main/favoriteLibraryManagedFolderProjection.ts:179`、渲染端 `favoriteLedgerApi.ts:298` 统一使用。纯远端观察草稿在渲染端归一为规范 ID；用户保存、启用或设置关键词的历史规则保留旧稳定 ID，并被投影清理保护。不同 ID（含历史 FNV32 碰撞样例）保留测试通过；当前未在真实账号再次执行整理→备册现场链路。 |
| I004 | R002 | 掌库和收藏库中标题为`确认绑定 bilimi 收藏夹`的显式绑定弹窗必须明确显示“绑定后 B 站收藏夹名字会更改为掌库当前名称”的实际目标；示例中 `bilimi·知识学习`→`bilimi·知识学习你好`、`bilimi·影视动漫你好`→`bilimi·影视动漫`，且不显示远端 ID。整理收藏中的`同步前备册确认`是另一种执行前预检窗口，保留精确远端 ID供逐项核对。 | 掌库/收藏库绑定确认弹窗的标题、收藏夹汇总、分册明细和改名说明文案；整理收藏同步前备册预检窗口的候选核对行。 | 改名文案仅在用户点击备册并进入显式绑定确认时显示；被动检测不显示改名承诺；同步前预检仍展示精确 ID。 | 用户在绑定弹窗勾选并确认后，按每个掌库收藏夹当前名称执行 B 站改名；文案必须与实际改名方向一致。 | 允许确认绑定事务改名并校验；不因文案展示触发额外远端写入。 | 绑定弹窗不显示远端 ID；不按旧 B 站名称覆盖掌库名称；不自动确认或按名称自动绑定。同步前预检的 ID 仅用于核对，不改变其既有执行语义。 | I001/I002 的精确远端 ID 解析、绑定事务、rename-folder bridge、成功复读和错误回显；整理收藏预检状态。 | 已实施待验证 | `FavoriteLedgerOverview.tsx:1633`、`FavoriteLibraryApp.tsx:2288` 显式绑定弹窗隐藏远端 ID并显示改名目标；`ControlledFavoriteLedgerPanel.tsx:1723` 同步前预检保留 ID，定向测试覆盖两种窗口并通过。真实账号文案/改名方向待界面验收。 |
| I005 | R005 | 对刚复现的 `你好①`、`你好②`，依据本地配置与工作区事件日志确定每条投影的稳定 ID、来源、远端 `folderId` 和生成时机；B 站只有一个远端夹时不得生成两条掌库草稿。 | 当前账号配置、收藏仓库 generation、工作区 manifest / journal、掌库卡片。 | 仅调试读取；不从同名或截图猜测身份。 | 先还原复现链路，再确定修复边界。 | 无；讨论阶段不得写本地业务状态或 B 站。 | 不删除、合并或改名现有数据。 | 远端扫描镜像、`appendRemoteOnlyDrafts`、受控工作区持久化与 UI 投影。 | 已实施待验证 | 现场日志已确认唯一远端 `4047644211` 对应两个历史本地 ID；修复统一无碰撞规范 ID并在账号持久化合并路径收敛，保留用户编辑旧规则的稳定 ID；`oldFavoriteWorkspaceRecommendationPersistence.test.ts`、`oldFavoriteWorkspaceCoordinator.test.ts`、`favoriteLibraryManagedFolderProjection.test.ts`、`favoriteLedgerApi.test.ts` 通过。未修改或删除真实账号数据；当前开发版无重复候选可做界面回归。 |
| I006 | R006/R007 | 实施前与实施中报告日志核查进度和工作树未提交范围；不得将其他主题改动混入本轮。 | Git 工作树、日志核查记录。 | 每次准备改动、准备提交或中断恢复时重新核对。 | 仅报告与隔离，不改写其他主题。 | 本轮只提交账本、项目书和功能文件；不包含其他主题账本。 | 不用 `reset`、`stash`、`clean` 等覆盖既有改动。 | Git 状态、项目书、需求账本。 | 已实施 | 开始前、验证前和提交前均运行 `git status --short --branch`；确认当前 `main`（`ahead 1075, behind 1`）且保留 `recommendation-toggle-relink`、`favorite-ledger-persistence-toggle` 等既有改动。 |
| I007 | R008/R009 | 先迭代项目书，再按本轮账本实施；鼠标连续移动、点击、滚动、缩放、最小化、恢复和关闭不得因本轮改动卡顿；不影响既有功能。 | 项目书第 9.5 节、主窗口交互和受保护收藏整理链路。 | 不得在首帧/交互路径做长同步工作。 | 使用既有非阻塞任务边界；不改变远端写入范围。 | 本轮仅在明确确认后可能改名，不自动写 B 站。 | 不重写整理、推荐、删除、视频同步、启动流程。 | 启动调度、主进程队列、收藏夹状态投影。 | 已实施待验证 | 项目书第 9.5 节已先行补充；开发版在启动后可加载 B 站首页并切换掌库，未观察到本轮导致的交互阻塞。低并发 `npm test` 246 文件/4276 项通过（日志 `.codex-artifacts/favorite-backup-rename-full-test-20260903-184651.log`），`npm run build` 通过。未能在当前账号的标题漂移候选上完整验收备册弹窗/改名过程，鼠标连续长时、窗口缩放/最小化/恢复/关闭仍需用户在实际使用场景复验。 |

## 讨论阶段边界

- 本轮当前处于讨论模式，不修改业务代码，不执行 B 站创建、绑定、改名、删除或视频写入。
- 项目书与既有契约中“被动检测不改名、普通备册不改名”的条款与 R001/I002 的“明确点击备册后以本地册名为准改名”存在需要统一的边界；在用户明确“开始”前先确认设计取舍。
- 真实 Electron/账号界面验收、远端实际名称和重复草稿的现场对账不能由自动化测试替代。

## 当前代码核对记录（讨论中）

- 改名确认失效的直接原因：`App.tsx` 的 `registerNewFavoriteLedgerBindings` 在标题已漂移时无法由标题推断 `shardNumber`，在调用绑定服务前跳过该候选；因此 `allowRemoteRename` 没有机会生效。
- 现有绑定服务已经支持精确 `remoteFolderId` 的显式改名、改名后复读校验和正式绑定；修复应优先补足稳定分册号传递，不得退回按名称认领。
- 现有弹窗仍渲染 `ID：...`，且子项只显示当前远端标题；R002 要求隐藏 ID，并显示绑定后按掌库当前名称改名的目标文案。
- `appendRemoteOnlyDrafts` 已按精确 `folderId` 去重，但会刻意保留无远端 ID 的本地 bilimi 推荐草稿与远端观察草稿；是否在“尚未明确绑定”阶段也折叠同名卡片，需要用户决定，否则继续按不同身份分别显示、确认后再按精确 ID合并。

## R005 现场日志核对记录（讨论中）

- 截图和最新工作区 `old-favorite-workspace-3706984597555811-20260903022728654-f3eb6adc-872f-41d8-bcd7-a4c8c1d7753b` 一致：`manifest.json` 在 2026-09-03 10:27:57 写入一个远端来源 `4047644211`，标题为 `bilimi·你好`，关系为 `reconcile-required`。这证明本次观察到的 B 站工作夹只有一个。
- 账号配置 `C:/Users/diqing/AppData/Roaming/bilimi-dev/config.json` 同时含有两个不同的本地记录：`custom-1sldpna`（显示名 `你好`）和 `custom-remote-1sldpna`（显示名 `bilimi·你好`）。二者均为 `local-draft`、`unbound`，且都指向精确远端 ID `4047644211`。
- 最新两代仓库快照 `9458a8d2-336b-4cf5-b801-3759de408e00`（10:27:56）与 `4f5eaa90-0271-4a23-a366-0d5785538e3d`（10:28:00）均各自持久化了 `bilimi-logical:custom-1sldpna`、`bilimi-logical:custom-remote-1sldpna` 和唯一的 `bilibili:4047644211`。两个本地逻辑分册各有分册 1，均记录同一已知远端 ID且为 `pending-reconcile`。
- 代码中存在两个相同哈希、不同前缀的 ID 工厂：渲染端 `favoriteLedgerApi.ts` 的 `stableRemoteDraftLedgerId` 生成 `custom-remote-<hash>`；主进程 `oldFavoriteWorkspaceCoordinator.ts` 的 `recoveredCustomLedgerId` 生成 `custom-<hash>`，并在扫描结束时持久化恢复草稿。两者对 `4047644211` 分别生成现场的两个 ID。当前代码没有跨这两个命名空间的“同一精确 remote ID 只能有一个未绑定远端观察草稿”不变量。
- 因此，`你好①`、`你好②` 不是 B 站重复创建，也不是单纯的 UI 计数问题；编号来自 `FavoriteLedgerOverview.tsx` 对两个同名本地逻辑卡片的展示后缀。尚未从现有日志证明两个写入者的先后顺序；已证实的是它们可为同一远端 ID持久化两条身份并被同一轮快照保留。
- 项目书第 4 节明确禁止将同一远端收藏夹再复制为第二份 bilimi 收藏夹列表，并要求使用真实规则 ID与远端 folder ID识别，不得按名称、数量或短 ID猜测身份。
