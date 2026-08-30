# 收藏夹删除刷新与本地工作夹投影 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 远端删除确认后自动收束本地投影，并让保存到收藏库的有成员 bilimi 规则稳定进入 bilimi 工作夹区域。

**Architecture:** 删除链路把“远端确认”与“本地收尾”拆为可测试的结果投影，成功时先完成幂等本地收尾再发布快照；本地保存链路统一写入带稳定逻辑规则 ID 的`bilimi-logical`文件夹，并在本地仓库中迁移旧`local:<ruleId>`投影。只用规则 ID迁移，绝不以名称推断 B 站身份。

**Tech Stack:** Electron、TypeScript、React、Vitest、FavoriteRepositoryService。

---

### Task 1: 锁定远端删除后的成功投影

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx:1188-1346`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx:686-760`

- [ ] **Step 1: 写失败测试。** 模拟 8 个默认规则和 2 个带真实远端 ID的远端草稿；远端接口返回全部成功，本地草稿删除和规则保存可完成。断言确认窗口关闭、两个草稿卡片消失、8 个默认卡片均显示`未备册`，且不调用第二次远端删除。

- [ ] **Step 2: 运行失败测试。**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "reconciles every confirmed remote deletion into the refreshed default projection"`

Expected: FAIL，当前路径在收尾异常/旧投影下保留删除确认或旧卡片。

- [ ] **Step 3: 实现最小收尾。** 把已确认远端 ID转为同一`next`规则投影；先删除已确认远端草稿、保存规则，再只在本地事实成功写回后更新 `draftLedgers`、各选择存储和快照，关闭删除模式。失败只保留检查点，不重发远端命令。

- [ ] **Step 4: 运行定向回归。**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: PASS，保留结果未知、部分失败、未绑定知情同意和单项删除覆盖。

### Task 2: 统一本地保存的逻辑工作夹身份

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts:4572-4695,5917-6035`
- Modify: `src/shared/favoriteRepository.ts:1880-1980`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts:8560-8610`
- Test: `src/shared/favoriteRepository.test.ts`

- [ ] **Step 1: 写失败测试。** 对当前批保存和整轮本地保存各建立一个无既有物理分册的规则，断言仓库生成`bilimi-logical:<ruleId>`、`logicalLedgerId=<ruleId>`、成员和`localDesiredFolderIds`一致；给旧`local:<ruleId>`准备成员和归属，断言同一事务迁移到逻辑 ID。另断言`bilibili:<folderId>`即使标题带`bilimi`也不迁移。

- [ ] **Step 2: 运行失败测试。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts -t "projects saved local rules as logical bilimi work folders" src/shared/favoriteRepository.test.ts -t "migrates a stable local ledger projection without touching Bilibili folders"`

Expected: FAIL，当前实现写入`local:<ruleId>`且缺少逻辑 ID。

- [ ] **Step 3: 实现最小数据迁移。** 为`commit-local-plan`增加受控逻辑工作夹输入；保存当前批和整轮时统一声明本轮有成员的规则为`bilimi-logical`，并在仓库命令中按精确规则 ID合并旧`local:<ruleId>`成员、归属和记录，删除旧本地投影。`inbox`仍使用`local:inbox`；无成员草稿不创建文件夹。

- [ ] **Step 4: 运行定向回归。**

Run: `npx vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/favoriteRepository.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

Expected: PASS，现有暂存、已绑定逻辑册、普通 B 站来源和恢复导航断言保持。

### Task 3: 验证更新与文档证据

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-30-favorite-deletion-refresh-and-library-projection.md`
- Verify: `docs/项目功能项目书.md`, `docs/contracts/favorites.md`

- [ ] **Step 1: 运行组合测试和静态检查。**

Run: `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts src/shared/favoriteRepository.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts && git diff --check`

Expected: PASS，无空白错误或无关文件改动。

- [ ] **Step 2: Electron 只读验收。** 在已有本地数据中打开删除模式和收藏库，确认删除成功后默认卡状态与工作夹分组；不点击会创建、绑定、删除、移动或同步 B 站的按钮。截图保存到`.codex-artifacts/`。

- [ ] **Step 3: 回填账本。** 按 I001/I002 记录代码位置、自动化结果、截图路径和未验证的真实 B 站副作用，再选择性提交本轮代码和文档。
