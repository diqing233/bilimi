# 删除后未备册投影与小咪后台加载实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 远端已清空后删除未绑定默认收藏夹立即投影为`未备册`，并使小咪只在后台预热和 Windows 原生修补完成后显示，避免启动期鼠标卡顿；同时让 NSIS 完成页的窗口控制与有效操作符合最新确认。

**Architecture:** 删除链路把“新鲜目录确认无精确 ID、无同名候选”的结果作为独立的主进程确认事实，沿用现有删除回调持久化并广播同一账号快照；仍有候选时保持原有未绑定知情同意。小咪链路由主窗口交互就绪信号触发，但将 hidden 创建、renderer 就绪、原生修补、鼠标恢复初始化和显示拆成可等待的异步阶段；可见前不启动恢复轮询。首页 guest WebView 只在用户明确浏览动作后挂载。NSIS 完成页通过专用显示回调启用最小化/最大化/关闭并隐藏无效的上一步/取消，保留完成与运行行为。

**Tech Stack:** Electron main/preload、React + TypeScript、Vitest、Windows `BrowserWindow`/DWM 原生修补。

---

### Task 1: 把无候选的未绑定默认规则纳入权威删除收尾

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:981-1019,1093-1189,1300-1415`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4060-4094`
- Modify: `electron/main/managedFavoriteLedgerDeletionPersistence.ts:1-30`
- Modify: `electron/main/favoriteRepositoryManagedFolderService.ts:50-60`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `electron/main/managedFavoriteLedgerDeletionPersistence.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: 写 I001 的失败回归测试。**

  - 在 `FavoriteLedgerOverview.test.tsx` 构造一条 `bindingState: 'unbound'`、无正式/历史远端 ID的默认规则；验证点击删除时仍调用删除预检，预检返回 `local-only` 后在用户选择“同时从 B 站删除”并确认时将该规则送入远端删除 IPC，而非直接走渲染器本地保存。
  - 在 `managedFavoriteLedgerDeletionPersistence.test.ts` 构造同一默认规则；验证主进程收到“远端已确认缺失”后保存 `bindingState: 'unbacked'`、`managedFolderDeletedByUser: true`，并发布一次快照。
  - 在 `oldFavoriteWorkspaceCoordinator.test.ts` 验证服务返回 `local-only` 候选时会把“远端已确认缺失”通知给既有持久化回调，而不请求 `deleteFolder`。

- [x] **Step 2: 运行新增测试，确认 RED。**

  Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

  Expected: 新增断言因当前无 ID 默认规则被归为 `localDefaultLedgerIds`、且持久化忽略空远端 ID而失败；既有断言保持通过。

- [x] **Step 3: 实现最小权威收尾。**

  - `FavoriteLedgerOverview` 将没有正式/历史 ID的默认规则也作为删除预检目标交给原有预览；实际同名候选继续进入同一个确认与知情同意页面。
  - 删除结果仍为 `local-only` 时，仅在用户选择“同时从 B 站删除”并经第二次新鲜预检确认后，协调器把逻辑规则 ID标为“远端已确认缺失”；该分支不调用 B 站删除。
  - 扩展现有删除持久化回调的内部数据，仅允许默认规则将这一事实收束为`unbacked`并广播；正常精确 ID删除仍复用 `applyConfirmedManagedFavoriteRemoteFolderDeletion`，自建规则、名称候选、部分失败和结果未知不变。
  - 渲染器在远端范围确认后只消费主进程广播；不得对该规则执行竞争性的 `onSaveLedgers`。

- [x] **Step 4: 运行 I001 回归至 GREEN。**

  Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/favoriteRepositorySyncService.test.ts`

  Expected: 新增“未绑定且无候选”测试通过；“同名未绑定候选需要确认”、精确历史 ID、已备册删除和部分删除回归均通过。

### Task 2: 让小咪在原生修补完成后才显示

**Files:**

- Modify: `electron/main/index.ts:397-531`
- Modify: `electron/main/floatingSealCaptionStrip.ts`
- Modify: `electron/main/floatingSealWhiteStripFix.ts`
- Test: `electron/main/index.mainWindowPetStartup.test.ts`
- Test: `electron/main/floatingSealCaptionStrip.test.ts`（如已有；否则创建针对完成 Promise 的单元测试）
- Test: `electron/main/floatingSealWhiteStripFix.test.ts`（如已有；否则创建针对完成 Promise 的单元测试）

- [x] **Step 1: 写 I002 的失败调度测试。**

  - 验证小咪创建保持 `show: false`；`did-finish-load` 后先等待白条/DWM修补和标题栏修补的完成 Promise，再初始化鼠标恢复，最后调用 `showInactive()`。
  - 验证鼠标恢复轮询的启动条件包含“小咪已可见”，主窗口交互就绪前不创建窗口、不启动 PowerShell 或 DWM移动。

- [x] **Step 2: 运行小咪测试，确认 RED。**

  Run: `npx vitest run electron/main/index.mainWindowPetStartup.test.ts electron/main/floatingSealCaptionStrip.test.ts electron/main/floatingSealWhiteStripFix.test.ts`

  Expected: 当前源码仅以 `setImmediate` 触发修补且没有可等待完成信号，新增时序断言失败。

- [x] **Step 3: 实现最小可等待的后台预热链。**

  - 让标题栏修补与白条/DWM修补导出不会阻塞主窗口的 `Promise` 完成接口；失败记录诊断但不能阻止小咪显示或阻塞主窗口。
  - `createFloatingSealWindow` 始终 hidden；其 `did-finish-load` 依次等待两个修补完成、初始化鼠标恢复（不轮询），再 `showInactive()`。
  - 鼠标恢复控制器仅在窗口可见时才启用轮询；隐藏、销毁、全屏隐藏和关闭继续停止轮询，拖动、控件交互和点击穿透保持原语义。

- [x] **Step 4: 运行 I002 回归至 GREEN。**

  Run: `npx vitest run electron/main/index.mainWindowPetStartup.test.ts electron/main/floatingSealCaptionStrip.test.ts electron/main/floatingSealWhiteStripFix.test.ts`

  Expected: 完整阶段顺序存在；小咪功能已有回归通过。

### Task 3: 文档、真实界面验收与提交前核对

**Files:**

- Modify: `docs/项目功能项目书.md:50-52,273-274,631`
- Modify: `docs/contracts/favorites.md:12-15,91-97`
- Modify: `docs/requirement-ledgers/2026-09-01-deletion-unbacked-projection-and-pet-background-loading.md`
- Modify: `electron/installer/installer.nsh`
- Test: `electron/installer/installer.finishPage.test.ts`
- Create: `.codex-artifacts/2026-09-01-*.png`

- [x] **Step 1: 更新账本索引。**

  为 I001、I002 分别记录代码位置、上述自动化测试命令与结果、Electron 只读验收截图路径；明确没有执行 B 站创建、绑定、删除、同步或视频写入。

- [ ] **Step 2: Electron/NSIS 只读验收。**

  - 使用可复现的本地状态/自动化 mock进入删除后的页面，只读确认默认规则卡片显示红色`未备册`，底部显示`部分 Bilimi 收藏夹尚未备册。`，不通过重启获得结果；截图保存 `.codex-artifacts/`。
  - 启动开发版，在不执行 B 站写入的前提下观察主窗口先可交互、小咪随后出现；验证鼠标移动、点击、滚动、最小化、恢复和关闭可响应；截图保存 `.codex-artifacts/`。无法在自动化环境证明“不卡”时据实写入未验证项。
  - 安装包完成页验证右上角最小化、最大化、关闭可用，底部仅保留完成按钮和运行 bilimi 复选框；不点击任何 B 站写入入口。

- [x] **Step 3: 运行提交前验证。**

  Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short --branch`

  Expected: 退出码为 0、没有空白错误；工作树只包含本轮代码、测试、项目书、契约、计划、账本和 `.codex-artifacts/`（截图不提交）。

- [ ] **Step 4: 逐条回读 R001-R003 后本地提交。**

  只在 I001、I002 各自具备代码位置、自动化结果和真实界面证据或明确未验证条件时，暂存本轮代码、测试和文档，执行一次 `git commit`；不得 push、merge、rebase、reset、stash、clean、revert 或 checkout。
