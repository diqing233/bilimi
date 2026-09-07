# 已绑定收藏夹改名一次确认备册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让本地规则改名或 B 站手动改名后的同一正式远端分册，在用户点击备册时统一进入一次“确认改名并继续备册”，确认后只改原精确 ID 并继续本次备册。

**Architecture:** 正式绑定的物理分册仍由 Electron 主进程和精确远端 ID 权威维护；renderer 在现有备册执行脚本前增加只读远端目录预检，取得该精确 ID 的当前标题并生成一次确认令牌。确认令牌只包含已展示的逻辑册/分册/远端 ID 元组；确认后调用既有 `renameBoundPhysicalShard`，再继续原有备册链，不允许名称搜索、重绑或创建替代。

**Tech Stack:** Electron、React、TypeScript、Vitest、Bilibili 页面脚本桥接。

---

## 文件与职责

- `src/renderer/src/features/favorites/favoriteLedgerApi.ts`：只读读取当前账号收藏夹目录，并按传入的精确正式分册元组返回标题不一致的改名预检结果。
- `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`：覆盖 B 站手动改名同 ID 的只读预检，不发出 `/folder/edit`、创建或视频写请求。
- `src/renderer/src/App.tsx`：把当前远端标题覆盖到已绑定改名预检；确认同一元组后直接调用原精确 ID 改名并继续既有备册。
- `src/renderer/src/App.test.tsx`：覆盖右侧/运行时单规则备册的预检、一次确认、取消及不走收养路径。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：确认按钮明确为“确认改名并继续备册”，继续携带同一预检元组。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`：覆盖一次确认的按钮文案、调用参数和取消零写入。
- `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`：收藏库当前/批量备册收到正式分册改名预检时显示同一确认语义，并一次确认后继续原操作。
- `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`：覆盖收藏库备册收到改名预检不显示“确认绑定”，确认后无需重新点击备册。
- `docs/项目功能项目书.md`、`docs/requirement-ledgers/2026-09-07-favorite-rename-runtime-branch-mismatch.md`：记录生效设计、R005–R009 的实现和验收证据。

### Task 1: 写入并验证只读标题漂移预检（R005、R007、R008、R009）

**Files:**

- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts`

- [ ] **Step 1: 写失败测试。** 模拟目录中 `id=4065561111` 的标题为`手动改过的收藏夹`，输入正式分册目标`bilimi·音乐舞台`；断言预检返回该同一 ID 的当前名、目标名和分册号，且没有 `/folder/edit`、`/folder/add`、`/resource/deal` 请求。

- [ ] **Step 2: 运行失败测试。**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "returns the exact formal shard title drift for a backup rename confirmation"`

Expected: FAIL，因为尚未导出只读正式分册改名预检脚本。

- [ ] **Step 3: 写最小实现。** 导出只读预检脚本；它只能读取当前账号目录，按传入的正式分册精确 ID 找当前标题，按每个分册的目标物理名称比较，且只返回不一致元组。目录无法读取时返回未验证结果，不用名称回退。

- [ ] **Step 4: 运行测试验证通过。**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts -t "returns the exact formal shard title drift for a backup rename confirmation"`

Expected: PASS。

### Task 2: 右侧/运行时备册按当前远端标题一次确认并继续（R005、R006、R007、R008、R009）

**Files:**

- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 写失败运行时测试。** 使用正式仓库 `physicalShards` 中的 ID `4106106611` 和本地规则名`bilimi·游戏专区`，让只读目录报告该 ID 当前名`用户改过的名称`。首次轻量备册断言返回`boundRenameCandidates`而非`unboundCandidates`，不调用改名、收养、创建或视频写；携带返回元组的第二次调用断言只调用 `renameFavoriteRepositoryBoundLedgerShard(accountMid, { logicalLedgerId, logicalTitle, remoteFolderId, shardNumber })` 一次，随后得到成功结果。

- [ ] **Step 2: 运行失败测试。**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "preflights a Bilibili-renamed formal shard for one confirmed backup rename"`

Expected: FAIL，因为当前仅比较持久化的分册标题，尚未读取 B 站当前标题。

- [ ] **Step 3: 写最小实现。** 由 `boundRenameCandidatesForTargets` 对每个正式分册生成真实分册目标名称；备册前调用 Task 1 的只读预检，以当前远端标题生成候选。确认元组不匹配时继续停在同一预检；匹配时强制对候选中的精确分册调用既有改名服务，成功后继续原 `buildEnsureFavoriteLedgersScript` / `buildSaveFavoriteLedgersScript` 及权威刷新。失败维持正式绑定，不走收养、创建或同步。

- [ ] **Step 4: 运行测试验证通过。**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "preflights a Bilibili-renamed formal shard for one confirmed backup rename"`

Expected: PASS。

### Task 3: 两个备册界面使用同一一次确认闭环（R006、R007、R008、R009）

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`

- [ ] **Step 1: 写失败界面测试。** 右侧备册收到改名候选时断言弹窗按钮为`确认改名并继续备册`，点击一次以相同 ID/分册号调用备册并关闭；收藏库备册收到同样结果时显示`确认修改 B 站收藏夹名称`，不显示`确认绑定 bilimi 收藏夹`，确认一次后以 `confirmBoundRename` 和同一元组重试。

- [ ] **Step 2: 运行失败测试。**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "确认改名并继续备册|bound rename"`

Expected: FAIL，因为当前按钮文案仍为`确认改名`，收藏库没有改名确认分支。

- [ ] **Step 3: 写最小实现。** 保持现有取消语义和隐藏 ID 的展示边界；右侧更名确认按钮改为`确认改名并继续备册`。收藏库保存改名候选与原工作夹范围，在一个改名确认窗中显示分册、当前名和目标名；一次确认后调用同一 `ensureFavoriteLedger` 请求，并在成功/失败后按原刷新语义收束。

- [ ] **Step 4: 运行测试验证通过。**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx -t "确认改名并继续备册|bound rename"`

Expected: PASS。

### Task 4: 回归、文档证据与提交（R005–R009）

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-rename-runtime-branch-mismatch.md`

- [ ] **Step 1: 定向回归。**

Run: `npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteRepositoryBindingService.test.ts`

Expected: PASS；既有精确 ID 改名、同名候选、普通创建、分册和失败保留绑定不回归。

- [ ] **Step 2: 全量验证。**

Run: `npm test; npm run build`

Expected: 两个命令均 exit 0。

- [ ] **Step 3: 开发版界面验收。** 启动当前分支开发版，只验收确认窗口文案、取消零副作用和鼠标/滚动/窗口操作响应；不点击真实 B 站改名确认，不读取或修改用户应用数据。

- [ ] **Step 4: 回填并提交。** 回填每个 R005–R009 的代码位置、自动化和界面验收证据；执行 `git status --short`、`git diff --stat`、`git diff --check`。随后仅提交本主题的代码、测试、项目书、账本和本计划，提交信息：`fix: continue backup after confirmed bound rename`。
