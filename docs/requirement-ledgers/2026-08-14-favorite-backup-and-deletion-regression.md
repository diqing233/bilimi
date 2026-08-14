# 备册草稿保护、左右删除分离与弹窗文案回归需求账本

本账本记录本轮主题从用户首次提出到明确说“开始”为止的全部用户原文。原文区永久保持不变；实施、测试和验收只追加在逐项索引表与实施记录中。

## 原文区

### R001

用户原文：

> 那为什么上一轮说的备册，删除功能还是没实现，备册删掉了草稿，删除两边会同时删，不是分开删

### R002

用户原文：

> 弹窗的文案也记得调整，开始

## 逐项索引表

| 条目 | 原文依据 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
|---|---|---|---|---|---|---|---|---|---|---|
| I001 | R001 | 点击右侧“备册”后，完整本地收藏夹规则集合必须原样保留；未保存草稿、未勾选已保存规则、远端发现草稿与其他本地规则都不得被筛出、覆盖或删除。仅已保存且已勾选、且不是 `local-draft` 的规则允许产生 B 站创建、改名、核验或绑定写入。 | 悬浮助手 `FloatingAssistantApp` 的 `syncFavoriteLedgers` 包装层；右侧 `FavoriteLedgerOverview` 到主进程保存、状态刷新和偏好回写链路。 | 备册按钮是否可点仍沿用“至少一个已保存且勾选的可备册规则”；草稿不因不可备册而从 UI 或偏好中隐藏。 | 备册调用完整数组；远端脚本自行跳过不应写 B 站的项；返回/刷新后右侧仍显示全部原有规则与草稿。 | 保存偏好必须使用完整数组；B 站不对草稿或未勾选项执行删除、创建、改名、绑定或收藏库删除。 | 不改变草稿手动删除既有路径，不改变扫描、批阅、整理收藏、回收站、视频详情页。 | `FavoriteLedgerOverview`、`FloatingAssistantApp`、`App.saveFavoriteLedgers`、B 站脚本。 | 已确认，实施中 | 新增“备册保留完整规则集合”失败测试；保存后的快照断言；定向 Vitest 与真实 Electron 只读界面验收。 |
| I002 | R001 | 左侧“收藏库”删除只处理左侧收藏库工作夹和成员关系；无论选择仅收藏库还是同时删除 B 站，都不能删除、过滤或丢失右侧收藏夹规则与草稿。若实际删除了 B 站收藏夹，右侧保留同一规则及其用户编辑内容，但清除失效远端绑定并显示未备册，以便之后通过普通“备册”重新建立。 | 左侧 `FavoriteLibraryApp` 三个点菜单和删除确认弹窗；主进程受管工作夹删除后的偏好持久化。 | 左侧弹窗仅从左侧入口出现；右侧规则卡和草稿卡始终保留。 | 仅收藏库：删左侧工作夹、保留 B 站和右侧规则绑定；同时删除 B 站：先成功删 B 站，再删左侧工作夹，右侧规则保留但变为未备册。失败继续显示现有“删除未成功，请稍后重试。”且不提前改变本地状态。 | 本地范围不写右侧偏好；远端范围只清理该规则的失效 B 站 ID/绑定状态，不移除规则、关键词、排序、启用状态或草稿。 | 不改变普通收藏夹、扫描、批阅、整理收藏、回收站、视频详情页，也不新加“待对账”提示。 | `FavoriteLibraryApp`、`favoriteRepositoryManagedFolderService`、`OldFavoriteWorkspaceCoordinator`、`managedFavoriteLedgerDeletionPersistence`、`favoriteLedgerDeletion`。 | 已确认，实施中 | 新增左侧本地/B 站两种删除范围的偏好与 UI 回归测试，断言右侧自建规则、默认规则和草稿仍存在。 |
| I003 | R001 | 右侧“收藏夹”删除只处理右侧规则/草稿；可由弹窗选择是否同时删除 B 站收藏夹，但绝不能删除左侧收藏库工作夹、关系或成员。默认收藏夹沿用既有可恢复语义：卡片和稳定 ID 保留为“已删除 · 未备册”，普通“备册”可恢复；自建规则从右侧移除。 | 右侧 `FavoriteLedgerOverview` 删除模式与确认弹窗；右侧 B 站删除 IPC。 | 右侧删除模式中选中后显示右侧专属弹窗；草稿直接删除不弹远端范围选择；默认收藏夹删除后保留恢复卡。 | 本地范围：仅删右侧自建规则/草稿或标记默认规则，不动 B 站和左侧收藏库。B 站范围：先删已核验 B 站目标，再更新右侧；左侧收藏库保持不变。 | 右侧远端删除必须走“仅 B 站”接口，禁止提交 `delete-local-managed-folders` 或触发左侧投影删除；删除失败保留右侧原状态和现有失败提示。 | 不改变左侧菜单职责、默认规则普通“备册”按钮名称、其他远端删除保护、扫描、批阅、整理收藏、回收站。 | `FavoriteLedgerOverview`、`favoriteRepositorySyncService.deleteManagedRemoteFolders`、IPC/preload 类型及组件测试。 | 已确认，实施中 | 新增右侧默认/自建规则在本地与 B 站范围内的回归测试，断言从不调用左侧删除接口或本地投影删除命令。 |
| I004 | R002 | 两个删除入口的弹窗必须明确写出“谁会被删除、谁会保留”，不再把另一侧写成会同步删除。继续保留原有失败提示，不添加“待对账”。 | 右侧 `FavoriteLedgerOverview` 删除弹窗；左侧 `FavoriteLibraryApp` 删除弹窗。 | 仅在各自删除确认弹窗可见时显示；草稿直接删除不新增弹窗。 | 右侧范围文案：`仅删除右侧 bilimi 收藏夹（保留收藏库和 B 站收藏夹）` / `同时从 B 站删除收藏夹（保留收藏库）`；说明分别明确“只移除右侧规则或草稿”与“收藏库工作夹和成员保持不变”。默认项额外说明“右侧保留为已删除 · 未备册，可通过备册恢复”。左侧范围文案：`仅从收藏库删除 bilimi 工作夹（保留右侧规则和 B 站收藏夹）` / `同时从 B 站删除收藏夹（保留右侧规则）`；说明实际删 B 站时右侧规则将变为未备册、可再次备册。 | 文案只描述本轮真实副作用；不改变确认复选框、未绑定二次确认、失败提示和远端目标清单。 | 不改无关弹窗与全局提示。 | 两个删除入口、远端范围状态、默认规则状态。 | 已确认，实施中 | 组件测试逐条断言精确文案和范围切换；真实 Electron 截图验收文字、位置、显示条件。 |

## 与上一轮账本的关联

- 本账本 R001 明确替代 `2026-08-14-favorite-backup-and-deletion-boundaries.md` 的 I001/I003 中“右侧默认收藏夹删除同时移除左侧收藏库工作夹”的部分。原账本 R008 原文永久保留，但以本轮较晚的 R001“删除两边会同时删，不是分开删”为准。
- 其余既有已确认边界继续有效：默认项普通“备册”恢复、失败提示“删除未成功，请稍后重试。”、不修改扫描/批阅/整理收藏/回收站。

## 实施前核对与计划

当前分支：`main...origin/main [ahead 891, behind 1]`。最新本地提交：`3fd384ec fix: preserve favorite backup and deletion boundaries`。开始前工作树干净，`git diff --check` 通过。本轮允许修改范围：上述四项直接涉及的右侧备册包装层、左右删除入口/持久化、相关 IPC 语义、相关 Vitest、本文账本；不修改未列出的业务流程。

1. R001 / I001：先在 `FloatingAssistantApp` 的备册包装层写失败测试，证明传入含未保存/未勾选项时该层目前把它们筛掉；最小修改为完整转发，并运行右侧备册与主保存链路回归。风险：保存结果覆盖账户偏好；验收：远端脚本仍跳过草稿/未启用写入，完整数组仍被回写。
2. R001 / I002：先在 `managedFavoriteLedgerDeletionPersistence` 写失败测试，覆盖左侧本地删除保留右侧完整规则、左侧 B 站删除保留规则但清理绑定；最小修改为按“远端是否实际删除”仅更新失效绑定，绝不过滤规则；校正左侧本地删除回调的远端标记。风险：默认规则恢复状态、远端重新备册；验收：左侧两种范围不会删右侧数据。
3. R001 / I003：先替换当前“右侧默认本地删除会删除左侧工作夹”的旧预期测试为失败测试；右侧默认项两个范围都不得调用左侧删除 API，右侧 B 站范围统一使用仅远端删除接口。风险：默认项恢复、远端删除原子性；验收：右侧自建/默认各范围不提交左侧投影删除。
4. R002 / I004：先为两个弹窗补充精确文案和范围切换失败测试，再改 JSX 文案；验收：右侧/左侧文案分别描述各自职责，保留现有失败提示和未绑定确认。
5. 按 R001-R002 逐项回读，运行定向 Vitest、TypeScript 构建、`git diff --check`；尝试真实 Electron 开发版只读界面验收，不执行任何会改写用户本地数据或 B 站数据的最终删除/备册确认。

## 实施与验收记录

### 状态索引更新（追加）

| 条目 | 状态 | 实际代码位置 | 自动化验证 | 真实界面验收 |
|---|---|---|---|---|
| I001 | 已实施待真实界面验收 | `src/renderer/src/features/assistant/FloatingAssistantApp.tsx` 的 `ledgersForFavoriteBackup` 与 `syncFavoriteLedgers` | `FloatingAssistantApp.test.ts` 覆盖完整规则集合（含未保存/未勾选项）不被筛除；本轮 6 个定向文件 585 项通过。 | 开发版 Electron 进程在运行；Windows UI 自动化运行时无法提供可用的 `sky.documentation` 接口，未执行写操作，也未取得只读截图。 |
| I002 | 已实施待真实界面验收 | `src/shared/favoriteLedgerDeletion.ts`、`electron/main/managedFavoriteLedgerDeletionPersistence.ts`、`electron/main/oldFavoriteWorkspaceCoordinator.ts`、`electron/main/index.ts`、`FavoriteLibraryApp.tsx` | 持久化测试覆盖本地左删不写右侧、远端左删仅清绑定并保留规则；协调器测试覆盖远端删除事实回传；本轮 585 项及 IPC/同步/App 回归 201 项通过。 | 同上；未点击删除确认。 |
| I003 | 已实施待真实界面验收 | `FavoriteLedgerOverview.tsx` 的右侧删除计划、默认项标记与远端专用 `deleteManagedRemoteFolders` 调用 | 组件测试覆盖右侧本地/远端默认项均不调用收藏库删除 API、默认项显示“已删除 · 未备册”；本轮 585 项通过。 | 同上；未点击删除确认或备册。 |
| I004 | 已实施待真实界面验收 | `FavoriteLedgerOverview.tsx` 与 `FavoriteLibraryApp.tsx` 的两个删除弹窗及右侧帮助说明 | 组件测试断言四条精确范围文案、保留对象说明及未绑定确认；本轮 585 项通过。 | 同上；未取得运行时截图，不能将组件测试等同于真实视觉验收。 |

### 本轮验证汇总

- `npm test -- src/shared/favoriteLedgerDeletion.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx --reporter=dot`：6 个文件、585 项通过。
- `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts electron/main/favoriteRepositorySyncService.test.ts src/renderer/src/App.test.tsx --reporter=dot`：3 个文件、201 项通过。
- `npm run build`：通过。
- `git diff --check`：通过。
- 两组 Vitest 输出都有既有 React `act(...)` 警告，但均以退出码 0 完成，没有断言失败。
