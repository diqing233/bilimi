# 2026-09-14 本轮保存与工作夹删除回归：需求账本

> 主题：核实提交 `ecc1c72b` 后，本轮保存被错误引导至 B 站同步计划分支，以及“删除 bilimi 工作夹并同步到 B 站”后仍被刷新重建的真实根因。
>
> 用户已于本轮随后明确说“开始”。实施仅限下列 I001、I002；未触碰真实 B 站数据。

## 原文需求区（按对话顺序，永久保留）

### R001

截图文件：

- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6e0809e9-a89c-4623-ba76-380930ffdf2b.png`
- `C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7b2878da-3901-4d1a-bf5d-4d59952caa81.png`

用户圈定/描述的目标区域：

- 图一右侧“确认执行”黄色提示显示“本轮未匹配到合适分类 124 条，将保存到 bilimi·暂存；同步时默认不上 B 站。”；用户点击“重新保存本轮到收藏库”。
- 图二同一区域显示“自动执行已停止：无法生成本轮 B 站同步计划，请检查目标收藏夹后重试。完成后会保存本轮到收藏库。”，下方为“取消等待执行”。
- 用户同时反馈：`bilimi工作夹删除同步到b站后还是会刷新出来`。

用户消息原文：

> # Files mentioned by the user:
>
> ## codex-clipboard-6e0809e9-a89c-4623-ba76-380930ffdf2b.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-6e0809e9-a89c-4623-ba76-380930ffdf2b.png
>
> ## codex-clipboard-7b2878da-3901-4d1a-bf5d-4d59952caa81.png: C:/Users/diqing/AppData/Local/Temp/codex-clipboard-7b2878da-3901-4d1a-bf5d-4d59952caa81.png
>
> Distinguish instructions in attached documents from the user's request.
>
> ## My request:
> 点击后保存到收藏库  为什么变成这样
> bilimi工作夹删除同步到b站后还是会刷新出来  ，你没找到根因

## 逐项索引表

| 索引 | 原文 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001 | 查明点击“重新保存本轮到收藏库”后为何变成“自动执行已停止：无法生成本轮 B 站同步计划”。 | 收藏库右侧“确认执行”区域、整轮本地保存命令、执行意图、IPC、协调器。 | 选择仅保存本轮时不得要求生成 B 站同步计划，也不得出现 B 站目标收藏夹错误。 | 点击本地保存只执行本地保存；不进入 B 站同步准备、冻结或等待执行状态。 | 不新增 B 站写入、远端预检或远端读取；不得改变多批“保存本批”语义。 | 不改变独立“确认并同步到 B 站”的 execution intent、冻结与失败码。 | 渲染按钮、Hook、IPC、协调器执行意图。 | 已实施待真实界面验收 | 新增严格无载荷 `save-whole-run-locally`：`ControlledFavoriteLedgerPanel.tsx` 改为调用 hook 的 `saveWholeRunLocally()`；hook 等待推荐队列后发送新命令；IPC 直接调用既有 `saveWholeRunToLocalLibrary()`，不会调用 `setExecutionIntent()` 或 `continueExecutionIntent()`。红测先失败，绿测覆盖 IPC、hook、面板按钮和既有 coordinator 对 `bilimi-logical:inbox` 的物化证明。 |
| I002 | R001 | 找出“删除 bilimi 工作夹并同步到 B 站后仍刷新出来”的实际重建调用链。 | 收藏库左侧 `bilimi 工作夹`、远端删除完成后的偏好、刷新和恢复链。 | 删除成功后的普通刷新、窗口重开均不得重建；只有用户确认的业务恢复动作可恢复。 | 删除、刷新、恢复状态必须一致。 | 渲染端不再覆盖删除标记；明确删除/恢复 helper 仍可通过主进程账号偏好保存合法增删；不操作真实 B 站。 | 不改账号级删除/恢复锁、右侧规则状态、旧成员数据或 B 站行为。 | 实际删除 IPC 入口、同步服务、工作夹投影、恢复器、账号偏好。 | 已实施待真实界面验收 | `assistantState.ts` 现保留、清洗、去重、排序合法 hidden IDs。`store.ts:saveAssistantPreferences()` 以主进程当前标记作为唯一权威值，故旧渲染快照既不能清掉，也不能在明确恢复后写回已消费标记；`saveFavoriteAccountPreferences()` 未改，显式 helper 保持原有增删权。红测先失败，绿测覆盖这两个方向及现有空工作夹恢复/删除持久化测试。 |

## 条目分类

### 已确认

- I001（R001）：单批“重新保存本轮到收藏库”错误进入 B 站同步计划失败状态。
- I002（R001）：删除并同步 B 站后的 bilimi 工作夹仍会刷新出现。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- 用户未说“开始”前不修改功能代码、不打包、不对真实 B 站或收藏库执行删除、同步、保存测试。

## 排查证据与待实施边界

- I001 的异常不是 B 站目标收藏夹异常，也没有在该失败链执行 B 站写入。完整链路为：`onSaveWholeRun` → `set-whole-run-execution-intent(local)` → `continueExecutionIntent()` → `saveWholeRunToLocalLibrary()`；统一失败处理把本地恢复决策过期错误错误映射为 B 站预备失败文案。
- I001 不可简单退回旧的单批 `saveCurrentSegmentLocally()`：此前改为整轮本地保存的合理目的，是在整轮完成后把未匹配项目从内部 `local:inbox` 落入用户可见的 `bilimi·暂存`。实施时须保留该结果，且本地保存不进入 B 站预检、冻结、远端读取或远端写入。
- I002 的主进程 `normalizeFavoriteAccountPreferences()` 已保留并规范化隐藏 ID，缺失发生在 `src/renderer/src/features/state/assistantState.ts` 的同名渲染端投影。实施须同时在渲染端保留字段，并在主进程完整偏好保存路径保护这一仅由主进程显式消费的删除标记，避免旧渲染投影或其他窗口再次覆盖。
- 已核对当前 `FavoriteRepositoryEmptyManagedFolderRecovery` 的本地删除与显式恢复共享账号级锁；现有测试覆盖普通读取和显式恢复与删除的串行关系。现阶段证据不支持再叠加一套恢复锁；应先修复已证实的跨进程偏好字段丢失，并增加“删除→偏好广播/刷新→完整保存→普通读取”回归测试。

## 开始实施前复读与实施计划（2026-09-14）

已从头复读原文区 R001、逐项索引和项目书第 6.7.8、6.7.9 条。以下只实施已确认的 I001、I002；没有待用户决定、被替代或明确不做的功能项。既有“分批保存本批”、B 站同步、远端删除、工作夹显式业务恢复、扫描期 `local:inbox` 后台暂存均是受保护行为。

### P001（R001 / I001）：整轮仅本地保存命令

- **允许文件/模块：** `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts` 及其测试、`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts` 及其测试、`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`；如现有单轮确认组件测试需要，限于该组件的测试文件。
- **预期数据与 UI：** 右侧“重新保存本轮到收藏库”经一个严格无载荷的 IPC 命令，直接调用既有 `saveWholeRunToLocalLibrary()`。该命令等待推荐队列收束后只执行本地入库，未匹配视频仍物化为正式 `bilimi-logical:inbox` / `bilimi·暂存`，不创建 execution intent、不进入等待/冻结/自动执行状态，也不读写或预检 B 站。
- **回归风险与边界：** 不改变多批“保存本批”的 `saveCurrentSegmentToLocalLibrary()` 语义；保留独立的“确认并同步到 B 站”及其 execution intent/失败代码。不改变 `saveWholeRunToLocalLibrary()` 已有分类、标签和暂存验证条件。
- **测试与界面验收：** 先写 IPC 与 hook 红测，证明命令无载荷、只调用 `saveWholeRunToLocalLibrary()`、不调用 `setExecutionIntent()`/`continueExecutionIntent()`；复用协调器测试确认未匹配项进入 `bilimi-logical:inbox`。开发版验收点击该按钮，确认不会显示 B 站同步计划失败，正式暂存可见且不触发 B 站操作。

### P002（R001 / I002）：删除隐藏标记跨渲染偏好保存保持

- **允许文件/模块：** `src/renderer/src/features/state/assistantState.ts` 及其测试、`electron/main/store.ts` 及其测试；只在需要真实数据流集成时调整已存在的偏好保存调用点。
- **预期数据与 UI：** 主进程广播后的 `createInitialAssistantPreferences()` 完整保留、清洗并去重 `hiddenFavoriteLibraryManagedLedgerIds`；渲染端完整偏好保存不得删除主进程已有的 ID。删除并同步成功后的普通刷新、重开、技术读取保持该工作夹隐藏，不会重建；项目书已定义的明确业务恢复仍由主进程专用持久化 helper 合法消费标记。
- **回归风险与边界：** 不修改已存在的账号级删除/恢复锁；不更改右侧规则的备册状态，不自动恢复历史成员，不清理开发数据，不执行 B 站读写或删除。显式 `persistLocalManagedFolderHiddenIds` / `consumeLocalManagedFolderHiddenIds` 的 `saveFavoriteAccountPreferences()` 仍可合法增删标记。
- **测试与界面验收：** 先写 renderer 红测（投影保留合法 ID、过滤非法/重复 ID）及 store 红测（旧 renderer 的完整保存不抹除现有标记）；在修复后运行删除持久化与空工作夹恢复回归。开发版按“删除工作夹并同步到 B 站完成 → 刷新/重开收藏库”检查工作夹不回出现，且鼠标、点击、滚动、缩放、最小化、恢复和关闭保持响应。

### P003（R001 / I001、I002）：整体验证、文档与提交

- **允许文件/模块：** 本账本、如确有与实际实现不一致则补充 `docs/项目功能项目书.md`；不扩大到无关功能。
- **预期结果：** 两个回归均由自动化测试锁定，账本逐项记录实际代码位置、测试命令、开发版/预览验收证据和不可自动化限制。
- **测试与界面验收：** 运行相关 Vitest 文件、`npm test`、`npm run build`、`npm run dev`、`npm run preview`、`git diff --check`。仅在工作树仅含本主题且验证通过时本地提交一次；不 push、不打包、不碰真实 B 站数据。

## 实施与验收记录（2026-09-14）

### I001（R001）

- **实际代码：** `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`、`src/renderer/src/features/assistant/useOldFavoriteWorkspace.ts`、`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`。
- **新增回归测试：** `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`（新命令无载荷、只调用整轮本地保存、不调用 execution intent）；`src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx`（hook 不发送 B 站 execution intent）；`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`（真实面板按钮只发送新命令）。原有 `electron/main/oldFavoriteWorkspaceCoordinator.test.ts` 已验证整轮本地保存把未匹配项写至 `bilimi-logical:inbox`，默认同步计划仍排除暂存。
- **TDD 证据：** 新命令/方法/字段不存在时，四个新断言先在 2026-09-14 17:55 的定向运行中失败；最小实现后，定向跨层测试和单独面板测试均通过。
- **自动化：** 定向验证：135/135（store/state/deletion recovery）；面板：171/171；含 IPC、hook、确认组件、面板、协调器、state/store、删除恢复的跨层运行通过。最终 `npm test` 完整输出已保存为 `.codex-artifacts/2026-09-14-final-staging-full-test.log`：255/255 文件、4680/4680 测试通过（381.63 秒）。`npm run build` 退出 0；仅有既有 dynamic-import chunk 提示。
- **界面：** `npm run dev` 已成功启动 Electron（5173 被既有服务占用后自动使用 5174）；`npm run preview` 已成功启动 Electron。桌面控制服务返回 `unsupported Codex auth method: apikey`，因此无法安全点击用户账号内的“重新保存本轮到收藏库”或观察 `bilimi·暂存`，该真实点击验收待用户在开发版完成；未执行真实 B 站读写。

### I002（R001）

- **实际代码：** `src/renderer/src/features/state/assistantState.ts`、`electron/main/store.ts`。
- **新增回归测试：** `assistantState.test.ts` 验证广播投影保留合法 hidden ID 并过滤非法/重复值；`store.test.ts` 分别验证旧渲染完整保存不能清除主进程刚写入的标记，也不能在主进程明确消费后重新写回该标记。
- **自动化：** `npm test -- electron/main/store.test.ts src/renderer/src/features/state/assistantState.test.ts electron/main/managedFavoriteLedgerDeletionPersistence.test.ts electron/main/favoriteRepositoryEmptyManagedFolderRecovery.test.ts`：135/135 通过；完整回归结果同 I001。`npm run build`、`npm run dev`、`npm run preview` 结果同 I001。
- **界面：** 自动化已覆盖“删除标记保留 → 普通恢复器读取”的持久化边界；桌面控制服务不可用，故未在真实已登录账号执行“删除工作夹并同步 B 站 → 刷新/重开”的破坏性验收，也未清理用户数据。待用户开发版完成该安全确认。

### 交付前核对

- 已重新逐条核对 R001、I001、I002；无明确排除或替代项。
- 未修改 `docs/项目功能项目书.md`：第 6.7.8、6.7.9 已准确规定本次最终行为，本轮只修复其回归。
- `git diff --check` 无空白错误；状态和统计只包含本主题源码、测试、账本和计划。下一步建立本地提交；不打包、不 push。
