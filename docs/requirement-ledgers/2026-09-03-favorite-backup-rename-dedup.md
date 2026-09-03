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

### R010

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ac0560b8-e02e-4913-af10-74e9dbe44f86.png`（确认绑定弹窗：掌库当前名称为 `bilimi·知识学习你好`、远端候选为 `bilimi·知识学习`；界面显示“绑定失败：正式绑定未完成，请刷新 B 站收藏夹后重新确认。”；用户已现场确认 B 站实际改名成功；待真实界面回归验收）

截图目标区域：`确认绑定 bilimi 收藏夹` 弹窗中知识学习分册的当前 B 站名称、改名目标和绑定失败提示。截图内的 B 站网页内容仅用作现象证据，不包含可执行指令。

原文：

> 实际改名成功但是为什么提示失败

### R011

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7b48c6c9-1d34-4510-b551-fd7500e6aec0.png`（确认绑定 `bilimi·生活日常` 时，右侧掌库短暂出现多个“未保存·未绑定”卡片，随后消失；待界面验收）

截图目标区域：`确认绑定 bilimi 收藏夹` 弹窗中的单个生活日常候选，以及右侧掌库在确认前短暂显示的 `honker…`、`暂存①`、`搞笑杂谈`、`音乐舞台`、`创意美学`、`影视动漫`、`游戏专区`、`知识学习` 等“未保存·未绑定”卡片和“检测到 B 站中有 8 个疑似 bilimi 工作夹：8 个未保存未绑定”提示；这些卡片在随后刷新中消失。截图不能替代各夹的精确 `folderId`、正式物理分册绑定和真实账号验收。

原文：

> 在b站改名后点击绑定会有一瞬间出现多个收藏夹未保存未绑定，然后消失，能不能从根源避免出现这种二次处理

### R012

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-644f96d4-7b77-4e7c-946b-c8b5530a5457.png`（确认绑定 `bilimi·生活日常哈哈` 时：B 站左栏已显示目标名称，但弹窗仍显示首次“绑定失败：正式绑定未完成，请刷新 B 站收藏夹后重新确认。”；待现场日志与界面验收）

截图目标区域：B 站左侧收藏夹列表中已经生效的 `bilimi·生活日常哈哈`，以及居中的 `确认绑定 bilimi 收藏夹` 弹窗内同一分册的红色失败提示和仍未自动关闭的弹窗。截图不能替代精确 `folderId`、主进程改名复读、正式绑定账本提交与后续权威刷新回执。

原文：

> 第一次失败，实际上成功了，需要再点击一次，弹窗才消失
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-644f96d4-7b77-4e7c-946b-c8b5530a5457.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-644f96d4-7b77-4e7c-946b-c8b5530a5457.png)</image>

### R013

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-f709ac4a-fdaa-4c01-bb05-44ccd35b14a3.png`（绑定成功后处理其他事情时，右侧掌库偶尔重新出现多个“未保存”草稿；待现场日志与界面验收）

截图目标区域：右侧掌库已备册卡片与下方偶尔出现的 `honke...`、`生活日...`、`影视动...` 等“未保存”卡片及“检测到 B 站中有 3 个疑似 bilimi 工作夹：3 个未保存未绑定”提示；其中编辑中的 `影视动漫哈哈` 详情同时显示 `B站绑定：1 个收藏夹`。截图还显示“收藏夹规则分析失败，请稍后重试。”，该文字仅作为同屏现象，须由日志确认是否与草稿投影同因。截图不能替代精确 `folderId`、账号完整规则、正式物理分册或主进程权威快照。

原文：

> 补充，继续分析讨论
> 绑定成功后，我再处理别的事情时（比如勾选推荐收藏夹）偶尔会刷新出来这种未保存草稿，说明绑定可能还不是很牢靠
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f709ac4a-fdaa-4c01-bb05-44ccd35b14a3.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-f709ac4a-fdaa-4c01-bb05-44ccd35b14a3.png)</image>

### R014

时间：2026-09-03

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-cef5c203-5721-4a9c-bd0a-61a1f87f49af.png`（确认绑定“游戏专区哈哈”时仍显示绑定失败；待日志与真实界面验收）

截图目标区域：`确认绑定 bilimi 收藏夹` 弹窗中已勾选的 `游戏专区哈哈（共 0 个视频）`、分册 1 的当前 B 站名称 `bilimi·游戏专区`、绑定后目标名称 `bilimi·游戏专区哈哈`，以及绿色框标注的“绑定失败：正式绑定未完成，请刷新 B 站收藏夹后重新确认。”提示。截图同时包含 B 站页面和掌库侧栏的现场状态；B 站实际改名是否已生效、精确 `folderId`、主进程错误文本和正式绑定提交结果须以日志/权威快照核对，截图不能替代这些证据。

原文：

> 讨论为什么还是提示失败
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-cef5c203-5721-4a9c-bd0a-61a1f87f49af.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-cef5c203-5721-4a9c-bd0a-61a1f87f49af.png)</image>

### R015

时间：2026-09-04

原文：

> 先迭代项目书，再按照项目书和账本改，开始（注意鼠标要一直流畅动，不要变卡，不要影响已有功能，仔细核对项目书）

### R016

时间：2026-09-04

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-ff559523-3772-4f62-933e-0b7952dceb57.png`（截图现场实际显示“游戏专区哈哈”绑定失败；待日志与真实界面验收）

截图目标区域：确认绑定 bilimi 收藏夹弹窗中已勾选的 `游戏专区哈哈`、当前 B 站名称 `bilimi·游戏专区`、绑定后目标名称 `bilimi·游戏专区哈哈` 以及“绑定失败：正式绑定未完成，请刷新 B 站收藏夹后重新确认。”提示。截图中的实际失败对象与文字中的“知识学习”并不一致；截图只能作为现象证据，不能把游戏专区的结果直接替代知识学习结论。

原文：

> **bilimi·知识学习你好是**掌库收藏夹的名字 ，当前b站是bilimi·知识学习，点击确认绑定后b站名称应该变成**bilimi·知识学习你好**  这个功能失败
>
> **bilimi·影视动漫是**掌库收藏夹的名字 ，当前b站是bilimi·影视动漫你好 ，点击确认绑定后b站名称应该变成**bilimi·影视动漫**  这个功能正常
> 为什么前者失败，后者做好了呢，只是改个名字而已

### R017

时间：2026-09-04

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-eb1a5ab9-73b1-4b7e-b6d8-b07378d1fe1b.png`（B 站页面已显示 `bilimi·小咪的个人空间-bili...`，掌库正在编辑 `bilimi·生活日常哈哈`；待日志与真实界面验收）
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-651e47da-0910-4af1-ad46-501abd1b571a.png`（确认绑定弹窗中 `生活日常哈哈` 的分册目标为 `bilimi·生活日常哈哈`，但显示绑定失败；待日志与真实界面验收）

截图目标区域：图一 B 站当前收藏夹列表中的实际名称与掌库“正在编辑：bilimi·生活日常哈哈”状态；图二“确认绑定 bilimi 收藏夹”弹窗中 `生活日常哈哈（共 0 个视频）`、分册 1 当前远端名称 `bilimi·生活日常`、绑定后目标名称 `bilimi·生活日常哈哈`、失败提示及确认按钮。截图用于证明 B 站名称已经改过来但掌库仍报告失败，不授权从截图猜测具体错误分支。

原文：

> 可以查日志我刚刚改了这个，虽然提示失败，但是图一已经改过来了
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-eb1a5ab9-73b1-4b7e-b6d8-b07378d1fe1b.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-eb1a5ab9-73b1-4b7e-b6d8-b07378d1fe1b.png)</image>
> <image name=[Image #2] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-651e47da-0910-4af1-ad46-501abd1b571a.png">![Image #2](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-651e47da-0910-4af1-ad46-501abd1b571a.png)</image>

### R018

时间：2026-09-04

截图：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-be5a45ce-071c-4cd6-aff6-766dc6b73b8f.png`（删除模式下，B 站当前显示 `bilimi·生活日常哈哈`，掌库目标卡片仍显示已备册/绑定状态，但页面提示“删除未成功，请稍后重试”和“部分 Bilimi 收藏夹尚未备册”；待日志与真实界面验收）

截图目标区域：掌库“收藏夹”删除模式的按钮、各收藏夹绑定状态、`生活日常哈哈` 卡片的删除选择状态、红色“删除未成功，请稍后重试。”提示、蓝色“部分 Bilimi 收藏夹尚未备册。”提示，以及 B 站页面中仍存在的 `bilimi·生活日常哈哈`。截图只能证明删除操作未收敛，不能单独证明删除接口响应码。

原文：

> 可以通过删除模式判断，如果绑定正常，删除后应该是未备册，当前会提示删除未成功
> <image name=[Image #1] path="C:\Users\diqing\AppData\Local\Temp\codex-clipboard-be5a45ce-071c-4cd6-aff6-766dc6b73b8f.png">![Image #1](C:\Users\diqing\AppData\Local\Temp\codex-clipboard-be5a45ce-071c-4cd6-aff6-766dc6b73b8f.png)</image>

## 逐项索引

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001/R002 | B 站改名但仍是本地已知精确远端 ID时，掌库显示`未绑定`而不是`未备册`；点击备册识别该精确候选，用户确认后按当前本地册名改写 B 站标题并恢复正式绑定。确认弹窗不显示远端 ID，改名副作用单独明确展示。 | `FavoriteLedgerOverview` 卡片/详情、备册确认弹窗、`favoriteLedgerApi.ts` 状态投影、`App.tsx` 绑定登记、主进程绑定服务。 | 仅精确 ID存在且远端标题与本地册名不一致时进入；检测和未确认阶段不得改名/绑定/同步。 | 候选弹窗显示本地逻辑名称、远端当前名称、视频数和绑定后改名目标，不显示 ID；确认后改名、复读校验、提交物理分册绑定；失败保留未绑定候选和可重试原因。 | 允许一次明确确认后的 B 站改名和本地正式绑定；不写视频、不自动同步成员。 | 不按名称自动认领、不新建第二个规则/远端夹、不改变删除知情同意、整理分类、归档预览和视频同步。 | 稳定规则 ID、正式 `physicalShards`、远端目录读取、rename-folder bridge、绑定事务和状态刷新。 | 已确认，已实施待验证 | `App.tsx:1818-1885` 只把显式选择的精确 ID 交给 `allowRemoteRename`；`favoriteRepositoryBindingService.ts:234-291` 对标题已无 bilimi 前缀的确认 ID仍执行一次改名和复读。回归 `allows an explicitly confirmed exact-ID shard to be renamed when its current title is no longer bilimi managed`、`accepts an explicitly selected exact-ID folder for the backup binding handoff even after its title loses the bilimi prefix` 已纳入定向 430 项和全量 4293 项通过证据（见 I007）。真实登录开发版当前无漂移候选，实际确认链路和弹窗文案仍待现场验收。 |
| I002 | R001 | 掌库本地册名改变后，下一次明确点击备册也必须以当前本地册名为准更新 B 站实际标题；不创建重复收藏夹。 | 掌库编辑保存、备册脚本、远端 `folder/edit` 或绑定服务改名链路、状态回写。 | 远端精确 ID仍存在且标题与当前本地册名不一致；普通状态读取不产生改名。 | 备册阶段执行改名并校验，成功后本地/远端标题一致且显示`已备册`；失败保留真实未绑定/待重试状态。 | 允许明确备册操作产生一次 B 站改名；保留同一规则 ID和远端 ID。 | 不在被动轮询、启动检查或普通本地保存时自动改名；不按同名猜测。 | 本地规则持久化、远端 ID投影、备册候选确认/直接备册分流、主进程远端写入。 | 已确认，已实施待验证 | `App.tsx:1818-1885` 将显式选择的候选以当前本地 `logicalTitle` 登记，`favoriteRepositoryBindingService.ts:258-291` 只对该 ID发送一次 `folder/edit` 并校验目标标题。回归 `allows an explicitly confirmed exact-ID shard to be renamed when its current title is no longer bilimi managed`、`accepts an explicitly selected exact-ID folder for the backup binding handoff even after its title loses the bilimi prefix` 及不同 ID 不重复创建均通过；定向 430 项、全量 4293 项与构建均通过（见 I007）。未在当前登录会话执行真实改名。 |
| I003 | R001/R003 | B 站实际只有一个远端夹时，整理收藏和备册流程不得重复创建或重复投影；应按稳定规则 ID和精确 `folderId`合并，真正不同 `folderId` 的同名夹仍分别保留。`recommendation-draft` 目前仅能作为代码内部来源标记，不能未经界面/现场证据认定为用户实际看到的功能。 | `ControlledFavoriteLedgerPanel` 推荐投影、`favoriteLedgerApi.ts` 的 `appendRemoteOnlyDrafts`/`projectRemoteOnlyDrafts`、备册回执和账号权威快照。 | 同一稳定规则或同一精确远端 ID已被本地规则/绑定/待对账记录占用时隐藏重复投影；不同 ID不合并。若当前版本没有实际推荐入口或采用动作，则不得把该状态名当作用户可见功能依据。 | 整理→保存→备册→状态刷新全过程只保留一条实际夹记录；创建/绑定回执先合并再投影，失败/待核对保留可恢复事实。 | 不删除或合并真实不同远端夹；不按标题、数量、列表次序猜测身份；不重复创建。 | 不改变当前实际存在的整理、备册、推荐入口和视频同步语义；不凭内部状态名扩大需求范围。 | 推荐规则持久化、备册创建/绑定回执、远端目录读取、正式仓库投影、缓存失效/刷新顺序。 | 已确认，已实施待验证 | `src/shared/favoriteLedgers.ts:7` 提供无碰撞可逆 `custom-remote-<encodeURIComponent(folderId)>`；`electron/main/oldFavoriteWorkspaceCoordinator.ts:1065`、`electron/main/favoriteLibraryManagedFolderProjection.ts:179`、渲染端 `favoriteLedgerApi.ts:298` 统一使用。纯远端观察草稿在渲染端归一为规范 ID；用户保存、启用或设置关键词的历史规则保留旧稳定 ID，并被投影清理保护。不同 ID（含历史 FNV32 碰撞样例）保留测试通过；当前未在真实账号再次执行整理→备册现场链路。 |
| I004 | R002 | 掌库和收藏库中标题为`确认绑定 bilimi 收藏夹`的显式绑定弹窗必须明确显示“绑定后 B 站收藏夹名字会更改为掌库当前名称”的实际目标；示例中 `bilimi·知识学习`→`bilimi·知识学习你好`、`bilimi·影视动漫你好`→`bilimi·影视动漫`，且不显示远端 ID。整理收藏中的`同步前备册确认`是另一种执行前预检窗口，保留精确远端 ID供逐项核对。 | 掌库/收藏库绑定确认弹窗的标题、收藏夹汇总、分册明细和改名说明文案；整理收藏同步前备册预检窗口的候选核对行。 | 改名文案仅在用户点击备册并进入显式绑定确认时显示；被动检测不显示改名承诺；同步前预检仍展示精确 ID。 | 用户在绑定弹窗勾选并确认后，按每个掌库收藏夹当前名称执行 B 站改名；文案必须与实际改名方向一致。 | 允许确认绑定事务改名并校验；不因文案展示触发额外远端写入。 | 绑定弹窗不显示远端 ID；不按旧 B 站名称覆盖掌库名称；不自动确认或按名称自动绑定。同步前预检的 ID 仅用于核对，不改变其既有执行语义。 | I001/I002 的精确远端 ID 解析、绑定事务、rename-folder bridge、成功复读和错误回显；整理收藏预检状态。 | 已实施待验证 | `FavoriteLedgerOverview.tsx:1633`、`FavoriteLibraryApp.tsx:2288` 显式绑定弹窗隐藏远端 ID并显示改名目标；`ControlledFavoriteLedgerPanel.tsx:1723` 同步前预检保留 ID，定向测试覆盖两种窗口并通过。真实账号文案/改名方向待界面验收。 |
| I005 | R005 | 对刚复现的 `你好①`、`你好②`，依据本地配置与工作区事件日志确定每条投影的稳定 ID、来源、远端 `folderId` 和生成时机；B 站只有一个远端夹时不得生成两条掌库草稿。 | 当前账号配置、收藏仓库 generation、工作区 manifest / journal、掌库卡片。 | 仅调试读取；不从同名或截图猜测身份。 | 先还原复现链路，再确定修复边界。 | 无；讨论阶段不得写本地业务状态或 B 站。 | 不删除、合并或改名现有数据。 | 远端扫描镜像、`appendRemoteOnlyDrafts`、受控工作区持久化与 UI 投影。 | 已实施待验证 | 现场日志已确认唯一远端 `4047644211` 对应两个历史本地 ID；修复统一无碰撞规范 ID并在账号持久化合并路径收敛，保留用户编辑旧规则的稳定 ID；`oldFavoriteWorkspaceRecommendationPersistence.test.ts`、`oldFavoriteWorkspaceCoordinator.test.ts`、`favoriteLibraryManagedFolderProjection.test.ts`、`favoriteLedgerApi.test.ts` 通过。未修改或删除真实账号数据；当前开发版无重复候选可做界面回归。 |
| I006 | R006/R007 | 实施前与实施中报告日志核查进度和工作树未提交范围；不得将其他主题改动混入本轮。 | Git 工作树、日志核查记录。 | 每次准备改动、准备提交或中断恢复时重新核对。 | 仅报告与隔离，不改写其他主题。 | 本轮只提交账本、项目书和功能文件；不包含其他主题账本。 | 不用 `reset`、`stash`、`clean` 等覆盖既有改动。 | Git 状态、项目书、需求账本。 | 已实施 | 开始、验证和提交前均运行 `git status --short --branch`；当前为 `main...origin/main [ahead 1080, behind 1]`。待提交范围仅为本轮项目书、账本、计划、绑定服务/IPC、渲染投影及其测试，不包含 `.codex-artifacts/`。 |
| I007 | R008/R009 | 先迭代项目书，再按本轮账本实施；鼠标连续移动、点击、滚动、缩放、最小化、恢复和关闭不得因本轮改动卡顿；不影响已有功能。 | 项目书第 9.5 节、主窗口交互和受保护收藏整理链路。 | 不得在首帧/交互路径做长同步工作。 | 使用既有非阻塞任务边界；不改变远端写入范围。 | 本轮仅在明确确认后可能改名，不自动写 B 站。 | 不重写整理、推荐、删除、视频同步、启动流程。 | 启动调度、主进程队列、收藏夹状态投影。 | 已实施待真实账号验证 | 项目书第 9.5 节先行补充；改名复读位于主进程显式确认后的远端操作队列，采用 `0/250/750/1500ms` 非阻塞等待，观察覆盖集仅随既有单次目录读取脚本传递，不增加请求。自动化：四模块定向回归 430 项通过（`.codex-artifacts/favorite-backup-rename-final-targeted-test-rerun-20260903.log`）；`npm test` 246 文件/4293 项通过（`.codex-artifacts/favorite-backup-rename-final-full-test-20260903-2236.log`）；`npm run build` 通过（`.codex-artifacts/favorite-backup-rename-final-build-20260903-2242.log`）。真实登录开发版已打开掌库，9 个当前收藏夹均显示`已备册`且未出现`未保存·未绑定`卡片；点击和 B 站页面滚动可及时响应。该会话没有标题漂移候选，且未为测试改变推荐勾选；连续鼠标移动、窗口缩放、最小化、恢复、关闭和真实改名确认仍待验收。 |
| I008 | R010 | 改名 API 成功后若首次目录复读仍是旧标题，不得立即误报正式绑定失败；仅对已确认的同一精确 `folderId` 有界复读，确认后登记正式绑定，耗尽后保留可重试失败。 | `FavoriteRepositoryBindingService.adoptExistingPhysicalShard` 的改名、复读和正式绑定提交；`App.tsx` 的失败文案映射；正式物理分册绑定账本与账号偏好。 | 仅在用户已明确确认精确 `folderId` 并请求改名时可能发生；截图中的通用失败提示不应被当作改名 API 失败。 | 改名 API 成功后，按 `0/250/750/1500ms` 重读同账号同 ID；首次旧标题、后续新标题时继续正式绑定。不同 ID、错账号、缺失 ID或耗尽仍失败。 | 不自动重试新的改名命令、不新建收藏夹、不写视频；仅延迟本次确认绑定的登记。 | 不以当前成功的远端名称倒推或补写绑定账本；不按标题寻找其他 ID。 | 精确远端 ID、B 站目录最终一致性、远端操作仲裁、正式绑定提交、前端错误映射。 | 已实施待真实账号验证 | `favoriteRepositoryBindingService.ts:9,258-291`；回归 `confirms an explicitly renamed shard after its first inventory still has the old title` 和延迟镜像回归均通过，服务完整文件 43 项通过。全量/构建见 I007。开发版当前处于登录状态但没有标题漂移候选；未执行真实 B 站改名，现场“成功不报失败”仍待验收。 |
| I009 | R011 | 确认绑定一个精确远端 `folderId` 时，右侧不得把同账号中已由其他规则/正式物理分册持有的 B 站收藏夹再次投影为“未保存·未绑定”；真正未被完整账号规则和物理分册覆盖的陌生 `folderId` 仍可作为远端观察草稿显示一次。 | `FavoriteLedgerOverview` 备册确认，`App.tsx` 单目标备册与正式绑定投影，`favoriteLedgerApi.ts` 的 `appendRemoteOnlyDrafts` / `projectRemoteOnlyDrafts`，账号偏好持久化。 | 仅在带 `backupTargetLedgerIds` 的窄范围备册/绑定时；其他正式绑定已覆盖的 ID 始终隐藏为候选草稿，未知 ID 不因本次修复被静默隐藏。 | 写入目标仍为当前确认册；完整账号规则、全部 `physicalShards.remoteFolderId` 与 `knownRemoteFolderIds` 仅作为只读草稿覆盖集，已知 ID不构造草稿，未知 ID仍构造一次。 | 不新增、删除、绑定、改名或写入其他 B 站收藏夹；不持久化随后会被刷新清理的临时草稿。 | 不以名称、标题、数量或列表顺序合并；不以延时、动画或隐藏侧栏掩盖问题；不改变真实未知远端夹的观察/待绑定能力。 | `backupTargetLedgerIds`、正式仓库摘要、远端目录读取、草稿投影、结果合并和状态刷新。 | 已实施待真实账号验证 | `App.tsx:1593-1661,2383-2410` 建立完整覆盖集但单册脚本仍只收目标册；`favoriteLedgerApi.ts:299-456,617-713` 将覆盖集作为脚本元数据、不落入远端写入 `options`。失败→通过回归覆盖账号已知 ID不投影、单目标覆盖不扩大写入、历史待确认 ID不越权进入写入册目；旧版摘要仅有 `folders + physicalShardCount` 而无 `physicalShards` 明细时，`uses trusted repository bindings when the page ledger check temporarily misses an already scanned folder` 验证正式 ID仍进入观察覆盖和草稿清理（RED/GREEN 日志：`.codex-artifacts/favorite-backup-rename-legacy-summary-red-20260903.log`、`.codex-artifacts/favorite-backup-rename-legacy-summary-green-20260903.log`）。定向 430 项、全量 4293 项、构建通过（见 I007）。真实登录开发版当前 9 个收藏夹均`已备册`且未出现未保存草稿；没有单目标待确认场景，闪现问题仍待现场验收。 |
| I010 | R012 | 首次确认绑定中，B 站已完成精确远端夹改名时，必须继续完成正式物理分册绑定并关闭弹窗；不得把“改名已生效但后续确认未完成”显示为绑定失败，要求用户重复点击。 | `FavoriteRepositoryBindingService.adoptExistingPhysicalShard` 的改名后目录复读、正式绑定提交；`favoriteRepositoryIpc.ts` 的后置投影回调；掌库确认绑定弹窗。 | 仅用户确认同一精确 `folderId` 且明确允许改名时适用；远端未改名、错账号、ID 缺失或最终确认失败仍须保留真实可重试错误。 | 单次确认在改名生效后必须把同一 ID 的正式绑定与视图状态收敛；后置投影失败不得把已完成的远端副作用伪装成整笔绑定失败。 | 不执行第二次改名、不创建收藏夹、不写视频；如无法确认正式持久化，必须给出与已完成副作用一致的状态。 | 不以标题、数量或时间顺序认领其他夹；不以无限等待或阻塞渲染进程掩盖 B 站目录最终一致性。 | 精确 ID、目录最终一致性、物理分册提交、绑定采用回调、权威投影刷新和前端错误映射。 | 已实施待真实账号验证 | `electron/main/favoriteRepositoryBindingService.ts:9,258-291` 将单次显式确认的精确 ID 复读扩展为 `0/250/750/1500ms`，只发送一次改名；`electron/main/favoriteRepositoryIpc.ts:527-536` 使后置本地投影回调失败不反转已提交采用。回归：`confirms an explicitly renamed shard after a delayed exact-id inventory mirror`、`returns a committed exact-id adoption when the later projection notification fails`，定向 430 项、全量 4293 项和构建通过（见 I007）。真实登录开发版当前没有标题漂移候选，故未执行 B 站改名或确认按钮；首次确认自动关闭仍待该现场条件验收。 |
| I011 | R013 | 已正式绑定的远端 `folderId` 在任何后续操作（包括勾选推荐收藏夹导致的刷新）中都不得重新以历史远端观察草稿形式显示为“未保存·未绑定”；真正未知的远端 ID 保留一条可观察草稿。 | 账号完整账本投影、`buildFavoriteLedgerStatusScript`、`buildEnsureFavoriteLedgersScript`、`buildSaveFavoriteLedgersScript` 及掌库右侧未保存卡片。 | 只要同账号任一正式规则或物理分册精确覆盖该 ID，所有状态读取、确保和保存入口均隐藏其远端观察草稿；不覆盖的 ID仍显示一次。 | 勾选推荐、保存规则、刷新状态等被动操作只重投影，不新增重复草稿、不修改 B 站名称/成员/绑定；历史草稿在正式绑定成功后按精确 ID 收敛。 | 允许清理由同一 ID 派生的纯远端观察草稿投影；不得删除用户实际创建或编辑的独立本地规则，不写 B 站。 | 不按标题、数量或名称相近性收敛；不隐藏真正陌生的 B 站收藏夹；截图同屏的“收藏夹规则分析失败”在证据不足前不并入本项。 | 全账号规则、物理分册、历史 `local-draft`、远端目录快照、推荐勾选调用路径和草稿投影去重。 | 已实施待真实账号验证 | `favoriteLedgerApi.ts:299-456,462-492,617-713,789-893` 以结构字段识别纯远端观察草稿，并把正式绑定 ID 作为专用清理集传入 status/ensure/save；`App.tsx:1593-1661,2040-2081,2211-2244,2383-2410,2566-2587` 将完整账号观察覆盖集与正式绑定清理集分离，单册远端写入仍仅含目标册。回归覆盖非 `bilimi` 前缀历史草稿收敛、`saved-rule` 保留、单册写入不扩大、仓库摘要失败关闭，以及旧版摘要缺少 `physicalShards` 明细时仍以 `folders` 中的正式 ID收敛观察草稿；后者失败→通过日志为 `.codex-artifacts/favorite-backup-rename-legacy-summary-red-20260903.log`、`.codex-artifacts/favorite-backup-rename-legacy-summary-green-20260903.log`。定向 430 项、全量 4293 项和构建通过（见 I007）。真实登录开发版掌库显示 9 个当前收藏夹均`已备册`、未见`未保存·未绑定`卡片；未为验收改动推荐勾选，推荐触发刷新链路仍待现场复验。 |
| I012 | R014 | 当 B 站页面已显示改名成功但确认绑定弹窗仍提示失败时，必须从实际错误和权威快照区分“改名已受理/已生效但目录复读未确认”“正式绑定提交失败”“后置投影失败”或其他真实失败；不得继续用无法解释的通用失败掩盖已完成的远端副作用，也不得让用户靠重复点击碰运气。 | `确认绑定 bilimi 收藏夹` 弹窗、渲染端 `registerNewFavoriteLedgerBindings` 错误映射、主进程 `adoptExistingPhysicalShard` 改名/复读/commit、IPC 返回值、账号 `physical-shard-bindings.jsonl` 和远端目录权威快照。 | 仅针对 R014 截图对应的精确 `folderId` 和本次确认事务；在取得日志前不得把失败归因于某一层，也不得自动重试、改名或创建新夹。 | 先记录实际错误文本、改名前后目录读取、正式绑定提交与后置刷新结果，再确定修复；失败提示必须与真实阶段一致，若远端改名已生效应明确告知并保留可恢复绑定状态。 | 讨论阶段不执行 B 站改名、绑定、删除或视频写入；实施阶段仍不得重复发送改名命令或创建第二个远端夹。 | 不以截图颜色、名称相似、时间顺序或“再次点击后消失”猜测根因；不把同屏“收藏夹规则分析失败”并入本项，除非日志证明同因。 | 当前运行版本、精确 `folderId`、目录最终一致性、远端操作回执、仓库提交日志、IPC 与前端错误映射。 | 已实施待真实账号验证 | 主进程桥接现已透传 `rejected/unknown` 与诊断字段；绑定服务按改名回执、同 ID 复读、正式提交、后置投影阶段区分错误，渲染层显示阶段化文案；相关回归已通过。具体 R014 账号案例仍缺少原始 IPC 回执，不能声称现场分支已复现。 |
| I013 | R015 | 按项目书 9.6 收口推荐收藏夹：整理可见性单一分流、非整理账号级 toggle、第二轮稳定 ID双向联动、详情独立删除、完整远端覆盖与 fail-closed、历史观察保守收敛、B站零写入、滚动位置和鼠标响应；先更新项目书和账本，再以失败回归驱动最小修改。 | `docs/项目功能项目书.md:9.6`、`ControlledFavoriteLedgerPanel.tsx`、`FavoriteLedgerOverview.tsx`、`FloatingAssistantApp.tsx`、`favoriteLedgerApi.ts`、账号仓库和推荐工作区。 | 只有向导展开且快照为 `previewing` 才进入整理队列；其它状态直接写账号启用。覆盖集不可核验时不新增/删除观察草稿，不标记已核验。 | 推荐采用先本地持久化再刷新；下方取消按纯草稿删除/正式规则仅取消参与分流；过期结果不得覆盖新操作；滚动容器保持锚点。 | 推荐操作仅允许本地规则/工作区写入和B站目录 GET，禁止 B站创建、改名、删除、解绑、移动和视频同步。 | 不改普通收藏夹、视频同步、删除确认、备册改名事务和启动模块；不得按标题、来源、数量或列表顺序猜测身份。 | 项目书 9.4/9.5、需求账本 I003/I009/I011、账号偏好 IPC、仓库物理分册、工作区快照和 UI 投影。 | 已实施待真实账号验证 | 项目书已新增 9.6；推荐可见性分流、账号覆盖集、稳定 ID 去重及 fail-closed 保护已实现并有回归测试；真实 Electron、滚动、账号切换和零写入证据待验收。 |
| I014 | R016 | 解释并修复“知识学习”失败而“影视动漫”成功的实际差异：必须依据同一精确 `folderId` 的改名回执、目录复读时序、正式绑定提交和后置投影结果区分失败阶段；不得把标题内容本身当作原因。截图实际对象“游戏专区哈哈”与文字对象“知识学习”分开验收。 | `favoriteRepositoryPageBridge.ts` 的 `rename-folder` 回执、`favoriteRepositoryBindingService.ts` 改名后精确 ID 复读/commit、`App.tsx` 失败映射、账号 `physical-shard-bindings.jsonl`、B 站目录权威快照。 | 仅在取得本次操作日志和精确远端 ID后下结论；若 B 站已改名但正式绑定未落账，必须显示对应阶段而非泛化“绑定失败”。 | 对照成功与失败案例的每一步：一次改名→同 ID 条件复读→正式绑定→投影刷新；失败时保留可恢复状态，不要求用户靠重复点击碰运气。 | 不重复发送改名、不创建第二个收藏夹、不按名称猜测、不修改视频或其他规则。 | 不把截图中的“游戏专区哈哈”结论替代文字中的“知识学习”；不把无日志的推测写成已确认根因。 | R001/R002 的改名绑定事务、I008/I010 的最终一致性与后置投影保护、前端错误回显和真实账号验收。 | 已实施待真实账号验证 | 改名桥接和绑定服务现已按回执、同 ID 复读、正式提交及后置投影区分阶段，前端不再统一映射为“绑定失败”；相关回归已通过。R016 的具体账号案例仍缺少原始 IPC 回执，截图对象与文字对象继续分开验收。 |
| I015 | R017 | “生活日常”案例必须以新截图和日志对账：B 站已经显示目标名称 `bilimi·生活日常哈哈` 时，掌库不能继续显示无法解释的绑定失败；必须区分远端改名已生效、目录复读未确认、正式绑定未提交和投影刷新失败，并保留同一 `folderId` 的可恢复状态。 | `favoriteRepositoryPageBridge.ts`、`favoriteRepositoryBindingService.ts`、`favoriteRepositoryIpc.ts`、`App.tsx` 绑定弹窗、账号 `physical-shard-bindings.jsonl`。 | 仅针对本次 `生活日常哈哈` 精确候选和真实账号日志；不得把图一的页面名称当作已完成正式绑定的充分证据。 | 读取改名请求回执、改名后精确 ID 目录复读、仓库 commit 和前端刷新结果；若远端副作用已发生，提示必须与该阶段一致且不要求重复点击。 | 不重复改名、不创建新收藏夹、不写视频、不把其它规则或推荐流程混入。 | 不以截图颜色、名称相似或“图一已改过来”直接推断正式绑定已成功；不隐瞒当前无详细 IPC 日志的事实。 | R010/R012/I008/I010/I014 的错误阶段化、最终一致性复读和后置投影保护。 | 已实施待真实账号验证 | 同一精确 ID 的改名回执透传、有限复读、正式绑定提交和后置投影保护已实现并有回归测试；R017 的实际账号复现、弹窗关闭和远端/本地账本最终一致性仍待现场验收。 |
| I016 | R018 | 删除模式必须以正式物理分册绑定账本和精确远端 ID为准：已绑定且删除 B 站收藏夹成功后，掌库状态应变为`未备册`/未绑定；若删除未成功，必须显示真实删除阶段原因，不得用“部分 Bilimi 收藏夹尚未备册”掩盖绑定账本与远端状态不一致。 | `FavoriteLedgerOverview` 删除模式、`App.tsx` 删除结果映射、`favoriteRepositoryPageBridge.ts` 的 `delete-folder`、账号物理绑定账本与 B 站目录。 | 仅对用户明确选中的精确 `folderId` 执行删除；删除失败时保留绑定事实和可重试状态，成功后再清除/降级本地绑定。 | 删除请求→远端响应→同 ID 目录复读→本地绑定状态降级，四阶段结果必须可区分；不得因此前改名正式绑定失败而把删除路径当作普通未备册。 | 允许用户明确删除产生一次 B 站删除副作用；不删除其它收藏夹、不创建、不改名、不写视频。 | 不按名称或截图推断删除成功；不因本地显示`已备册`就假定远端删除已完成。 | I001/I008/I010/I015 的精确 ID绑定、改名后正式提交、删除确认和错误回显。 | 已实施待真实账号验证 | 删除前精确 ID 标题过期保护、稳定阶段错误、成功后解绑收尾和中文反馈已实现并有回归测试；真实账号删除成功后状态转为“未备册”及失败重试行为仍待现场验收。 |

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

## R012 / R013 现场与代码核对记录（讨论中）

- R012 当前账号的 `life-interest`、`movie-tv` 和自定义作者规则均已有 `bindingState=bound` 的正式物理分册；但生活/影视物理分册仍保留改名前的 `remoteTitle`，而仓库远端镜像已记录改名后的标题。没有对应生活/影视的 `favorite-adoption-title-repair:*` 提交。这与“改名请求已在 B 站生效，但首次目录复读未在当前窗口内观察到新标题，因而在正式标题修复提交前抛错；再次点击时远端目录已追上”的路径一致。
- `FavoriteRepositoryBindingService.adoptExistingPhysicalShard` 的改名复读目前仅以 `0ms → 250ms → 750ms` 三次精确 ID目录读取确认，总等待约 1 秒；耗尽时抛出 `Favorite repository remote shard rename is not confirmed.`。IPC 随后的 `onLedgerBindingAdopted` 也可能使已成功的绑定调用变为 rejected，但当前回调只有本地投影刷新，未在本机可读日志中发现与 R012 同时发生的该类异常；不能把它当作已证实根因。
- R013 当前账号配置同时留有三个纯远端观察草稿：`custom-remote-4080598611`、`custom-remote-4053636211`、`custom-remote-4053636311`；它们分别与已经 `bound` 的生活日常、影视动漫和作者规则共享完全相同的远端 `folderId`。因此它们不是新建或新扫描到的 B 站夹，而是历史观察记录没有在正式绑定后按精确 ID收敛。
- “勾选推荐收藏夹”实际经过 `ControlledFavoriteLedgerPanel` 的 `recommendationOnly` 本地保存和工作区刷新，并会触发助手快照的 `readFavoriteLedgerStatus`。当前 `buildFavoriteLedgerStatusScript` 与 `buildEnsureFavoriteLedgersScript` 没有接收 `remoteDraftKnownFolderIds`；上一轮只有 `buildSaveFavoriteLedgersScript` 收到完整账号覆盖集，故该刷新路径会绕过覆盖保护。
- 现有 `appendRemoteOnlyDrafts` 只把标题仍带 `bilimi` 前缀的 `local-draft + unbound` 记录识别为可收敛远端观察草稿。上述三个历史记录的本地显示名已去掉该前缀，导致即使它们共享精确 ID，现有清理条件也会保留并重新显示。后续修复必须用“纯远端观察记录的结构与精确 folderId”，不能用标题前缀、名称或数量判断；有 `ruleOrigin=saved-rule`、已启用状态或有效关键词的真实本地规则继续保留。
- 截图同屏的“收藏夹规则分析失败，请稍后重试。”尚未在可读日志中获得和草稿投影相同的因果证据；本轮不把它归因或捆绑修复。
- R014 当前现场进一步核对：`config.json` 最近一次保存为 23:07，仍保留 `game` 的本地名称和精确 ID；绑定日志最后更新时间为 22:54，仍没有 `game` 的标题修复提交。`ledgersAfterBindingRegistration` 在绑定失败时会先保存渲染端结果，随后权威仓库投影又可把原始正式 ID恢复到本地配置，因此“本地显示已改名/已绑定”不能证明正式标题修复事务已成功。
- R014 的最可能失败窗口已由代码边界缩小为两类，但尚无该次 IPC 原始回执可二选一：① `rename-folder` 返回 `remote-ambiguous`、`invalid-response`、`network-failure` 等异常，服务在改名后复读前直接退出；② 改名回执为成功，但 `list-all` 在当前有限复读窗口仍未返回目标标题，服务抛出 `Favorite repository remote shard rename is not confirmed.`。两类错误都会被 `favoriteLedgerBindingFailure` 映射成同一条“正式绑定未完成”。

## 实施核对补充（2026-09-04，R015“开始”后）

R015 明确授权在新分支实施本轮已确认需求。以下状态更新以本节为准；原文区与先前索引记录永久保留，不作删除或改写。

| 原文/索引 | 实施状态 | 实际代码位置与自动化证据 | 真实界面/账号验收边界 |
| --- | --- | --- | --- |
| R001/R002 · I001/I002/I004 | 已实施待真实账号验证 | `electron/main/favoriteRepositoryBindingService.ts` 对显式精确 `folderId` 执行单次改名、同 ID 有界复读并以最终标题提交；`src/renderer/src/App.tsx` 从正式绑定返回快照回写 `remoteTitle`/视频数；绑定确认弹窗仍隐藏 ID并显示改名目标。`favoriteRepositoryBindingService.test.ts`、`App.test.tsx` 改名回写回归通过。 | 尚未在当前登录账号制造标题漂移并点击确认；弹窗像素、自动关闭和 B 站最终名称仍待开发版现场验收。 |
| R005/R011/R013 · I003/I005/I009/I011 | 已实施待真实账号验证 | 完整账号远端观察覆盖集按精确 `folderId` 去重；正式绑定返回后不再用旧候选标题覆盖；`App.test.tsx`、`favoriteLedgerApi.test.ts`、`oldFavoriteWorkspaceCoordinator.test.ts` 等重复投影/未知 ID/单目标写入边界回归通过。 | 当前开发版已有账号快照未出现重复候选；未在现场重复执行“整理→备册→勾选推荐”完整链路。 |
| R010/R012/R014/R016 · I008/I010/I012/I014 | 已实施待真实账号验证 | `favoriteRepositoryRuntimePageBridge.ts` 透传改名 `rejected`/`unknown` 及诊断字段；`favoriteRepositoryBindingService.ts` 将拒绝、结果未知、复读未确认分阶段处理，不提交伪绑定；`App.tsx` 映射阶段文案；运行时桥接、绑定服务和 App 回归通过。 | 具体知识学习/游戏专区/影视动漫案例缺少原始 IPC 回执，不能把自动化结果写成现场成功；需用同一精确 ID验证改名回执、复读、commit和弹窗关闭。 |
| R017 · I015 | 已实施待真实账号验证 | 同一改名事务复用上述精确 ID透传、最终标题回写和后置投影保护；`favoriteRepositoryIpc.ts` 后置回调失败不反转已提交绑定。 | `生活日常哈哈` 的截图与现有账本仍待现场复现；不能仅凭 B 站页面名称认定正式绑定完成。 |
| R018 · I016 | 已实施待真实账号验证 | `favoriteRepositorySyncService.ts` 删除前精确 ID标题失真返回稳定阶段码 `favorite-repository-binding-title-stale`，不调用删除、不解绑；远端删除成功后仍仅提交 `remove-physical-shard-binding`，UI 文案在 `FavoriteLibraryApp.tsx` 与 `managedFavoriteFolderDeletionFeedback.ts` 区分标题过期。同步服务、删除反馈和收藏库回归通过。 | 尚未在真实账号执行删除模式并核验 B 站删除、掌库状态转为未备册及重试行为；该项不能标记为现场完成。 |
| R003/R004/R006/R007/R008/R009/R015 · I006/I007 | 已实施；响应性待现场验收 | 项目书先于代码补充第 9.5 条；本轮只使用非阻塞、有界复读，不增加主窗口同步扫描；工作树、构建和全量测试证据见 `.codex-artifacts/`。 | 自动化不能证明鼠标持续流畅；需在 Electron 开发版实际移动、点击、滚动、缩放、最小化、恢复和关闭窗口。 |

### 本轮确认项与排除项回读

- 已确认并纳入实施：R001、R002、R003（仅按实际存在功能解释）、R004、R005、R006、R007、R008、R009、R010、R011、R012、R013、R014、R015、R016、R017、R018。
- 本轮没有用户明确排除的已确认需求；R003 的“推荐草稿不存在”仅限制内部状态名不得被当作用户功能，不新增推荐入口。
- 仍待用户/现场决定或验收：所有截图中的精确文案、颜色、位置、弹窗自动关闭、真实 B 站改名/删除副作用、鼠标流畅度，以及 R014/R016 具体账号案例的原始 IPC 分支。未取得证据前不声称这些条目已完成。
