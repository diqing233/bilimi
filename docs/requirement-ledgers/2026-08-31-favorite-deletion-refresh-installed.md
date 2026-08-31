# 安装版收藏夹删除刷新收尾（2026-08-31）

## 原文区

### R001

附件截图：

- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-eeff248e-e9dc-4455-bb0a-035c95e7ac2e.png`
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-d21cfd57-6c2d-4f69-98cc-6acf8b57b0f1.png`
- `C:\Users\diqing\AppData\Local\Temp\codex-clipboard-20e59054-0360-4ed4-b73e-58222d0c7f9c.png`

> 安装版本还是老样子，讨论图一删除模式为什么显示已删除，本地状态待保存呢（实际我查看已经删除了），变成图二的样子，
> 正常情况应该只剩下默认收藏夹，变成未备册的状态（图三），当前没有设计这个刷新，应该自动刷新

### R002

> 先迭代项目书，再按照项目书和账本改，开始修复（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）

### R003

> 删除弹窗虽然消失了，但是状态没有更新，
> 正常情况应该只剩下默认收藏夹，变成未备册的状态（图二）
> 还有安装版本启动过程中鼠标卡住了，应该可以正常加载鼠标别卡和消失
> codex://threads/01a054c6-a043-74c1-abe7-bfd80268236a           你看看这个对话我正让它分析的问题，你续着检查

### R004

> 先迭代项目书，再按照项目书和账本改，开始（注意不要按钮点击变卡，不要影响已有功能，仔细核对项目书）

## 逐项索引

| 编号 | 状态 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | 已确认 / 已实施待验证 | 远端 B 站删除确认成功后，即使某个本地删除或刷新回调异常，也必须隔离异常并完成已确认目标的本地收尾和权威重投影；最终只保留默认收藏夹并显示`未备册`，已删除远端草稿消失。安装版必须由包含本修复的最新提交重新构建。 | 右侧掌库删除模式、删除确认窗口、掌库/收藏库/整理草稿投影。 | 远端精确 ID 已确认删除且本地收尾和权威重读成功时关闭确认；仅当本地收尾和权威重读都失败时显示`本地状态待保存`并保留检查点。 | 远端删除只执行一次；已确认 ID先从本地投影收敛，再尽力重读同一账号权威快照；单项回调失败不得阻断其它目标或旧卡片移除；主进程收尾后向掌库助手广播一次权威快照变化。 | 只清理已确认精确 ID的本地绑定/草稿并持久化默认规则的`未备册`状态；不重发 B 站删除，不执行创建、绑定、移动或视频写入。 | 不改变删除范围、二次确认、未绑定知情同意、整理收藏、DeepSeek、转写、视频同步、单个备册入口或正常按钮响应。 | `FavoriteLedgerOverview` 删除计划与本地回调；`electron/main/index.ts` 两条 managed-folder deletion 回调；账号权威快照；安装版构建产物。 | RED/GREEN 自动化：`FavoriteLibraryApp.test.tsx`、`index.favoriteHistoryWiring.test.ts`、`FavoriteLedgerOverview.test.tsx`、`favoriteRepositoryManagedFolderService.test.ts`、`managedFavoriteLedgerDeletionPersistence.test.ts` 通过；Electron/安装版真实删除与截图待验收。 |
| I002 | 已确认 / 已实施待验证 | 安装版启动期间鼠标可正常移动、点击、滚动、最小化、恢复和关闭；小咪透明窗口在 renderer 就绪前不拦截主窗口，不因启动初始化、鼠标恢复轮询或标题栏处理造成指针卡住、消失或点击延迟。 | Electron 主窗口启动时序、小咪透明/恢复控制器、主进程启动初始化。 | 主窗口创建后立即可交互；小咪 renderer 首屏和交互区域注册完成前保持隐藏且完全点击穿透；就绪后才显示并切换交互区域。 | 启动初始化异步分段执行并让出事件循环；不使用整页遮罩或忙碌光标掩盖阻塞；保留小咪拖动、控件点击和透明区域穿透。 | 只调整本地窗口创建/透明时序，不改变账号、收藏夹、B 站、DeepSeek、转写或视频数据；不执行任何远端写入。 | 不改小咪视觉设计、拖动规则、网页浏览、整理收藏、删除确认和同步业务语义。 | `electron/main/index.ts` 在 `app.whenReady` 初始化前创建主窗口并提前注册 readiness IPC；`floatingSealWindowOptions.ts`、`floatingSealMouseRecovery.ts`、`floatingSealMouseTransparency.ts`、`floatingSealWakeController.ts`、`PalaceMaidPetApp.tsx`；Electron 安装包构建产物。 | RED/GREEN：`index.favoriteHistoryWiring.test.ts` 验证主窗口先于慢初始化创建；`floatingSealWindowOptions.test.ts`、`floatingSealWakeController.test.ts`、`floatingSealMouseRecovery.test.ts`、`floatingSealMouseTransparency.test.ts` 共 24 个相关测试通过；开发版与重新构建安装版真实鼠标移动/点击/滚动/最小化/恢复/关闭验收待完成。 |

## 实施前核对

已确认：I001（R001、R002、R003、R004）、I002（R003、R004）。

待用户决定：无。

被明确替代：无。

明确不做：不执行真实 B 站删除、创建、绑定、移动或视频写入；不修改 DeepSeek、转写、视频同步、普通 B 站来源关系和单个备册入口。

## 实施计划

1. 更新项目书删除结果和启动响应性条款，明确远端结果、本地收尾、权威重读的阶段隔离，以及安装版必须重新构建。
2. 在 `FavoriteLedgerOverview.test.tsx` 先增加失败回归：远端删除已确认时，本地草稿/规则删除回调或刷新异常不能阻止已确认目标从投影移除；默认规则最终为`未备册`；远端删除调用次数保持一次。
3. 在小咪/主进程测试中增加失败回归：主窗口创建不等待慢初始化；renderer 就绪前小咪隐藏且透明穿透，既有恢复控制器仍保留拖动与交互区域语义。
4. 以最小范围调整删除后的权威快照通知与启动窗口时序；不改远端删除请求与其它整理流程。
5. 运行聚焦删除/启动回归、全量 `npm test`、`npm run build`、`git diff --check`，更新本账本证据并提交。

## 实施证据

### I001（R001、R002、R003、R004）

- **代码位置：** `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1174-1278` 将远端草稿逐项删除、默认规则收敛、本地投影更新和刷新回调分阶段处理；`src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1369-1397` 在远端精确 ID 成功后隔离本地清理异常，避免重复发起 B 站删除。`electron/main/index.ts:2127-2133` 与 `2392-2398` 在持久化确认删除结果后广播一次 `notifyFloatingAssistantSnapshotChanged()`，让掌库助手消费新的权威快照。远端部分成功仍沿用原有逐项结果和检查点逻辑（同文件 `1343-1365`）。
- **自动化测试：** `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx` 121/121、`src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx` 154/154、`electron/main/favoriteRepositoryManagedFolderService.test.ts` 41/41、`electron/main/managedFavoriteLedgerDeletionPersistence.test.ts` 5/5、`electron/main/index.favoriteHistoryWiring.test.ts` 4/4 通过；本轮收藏夹/小咪聚焦回归共 `508/508` 通过。
- **全量验证：** `npm test` 通过（`243` 个测试文件，`4175` 个测试）；`npm run build` 通过；`git diff --check` 通过。
- **界面与安装版：** 本轮未执行真实 B 站删除，也未点击安装版删除按钮；`.codex-artifacts/` 无新增界面截图。当前 `D:\bilimi\bilimi.exe` 时间戳早于本轮源码提交，仍是旧安装包，不能作为修复后行为证据；需要后续按打包门禁重新构建并在开发版、预览版、安装版完成只读验收。
- **远端副作用边界：** 自动化测试只使用 mock，不创建、绑定、删除、移动 B 站收藏夹，不写入视频；修复路径不触发整轮重分类、DeepSeek、备册或视频同步。真实远端删除结果、账号权威重读和安装版界面刷新仍待验收。

### I002（R003、R004）

- **代码位置：** `electron/main/index.ts:2056-2059` 现在先注册助手 readiness IPC 并创建主窗口，再异步执行代理偏好、本地服务和可恢复事务初始化；移除末尾重复创建。`electron/main/floatingSealWindowOptions.ts` 保持 `show:false` 与 `paintWhenInitiallyHidden:false`，`floatingSealWakeController.ts` 继续在 renderer ready 后才 `showInactive()`，透明/鼠标恢复控制器和小咪 renderer 的既有交互区域逻辑未改。
- **自动化测试：** `electron/main/index.favoriteHistoryWiring.test.ts` 新增启动顺序回归；`floatingSealWindowOptions.test.ts` 1/1、`floatingSealWakeController.test.ts` 6/6、`floatingSealMouseRecovery.test.ts` 5/5、`floatingSealMouseTransparency.test.ts` 3/3 通过。
- **真实界面验收：** 尚未启动本轮开发版或重新构建安装版进行鼠标移动、点击、滚动、最小化、恢复、关闭的真实验收；当前旧安装包不能作为修复后证据。需在重新构建后按发布清单记录截图/结果。
- **远端副作用边界：** 启动时序修复不调用 B 站创建、绑定、删除、移动、同步或视频写入，也不改变 DeepSeek、转写和整理收藏数据。
