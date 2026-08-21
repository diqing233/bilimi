# Missing Formal Shard Deletion Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当正式分册绑定缺失但规则仍留有历史精确远端 ID 时，使删除模式安全识别该 ID并让状态停止伪装为已备册，同时保留既有一键备册闭环。

**Architecture:** 以正式 `physicalShards` 作为唯一“已备册”事实；历史规则 ID仅在用户已进入既有 B 站删除确认流后，经过当前目录按精确 ID核验才能成为未正式绑定删除候选。删除成功或本次确认目录已缺失才收敛该 ID；备册 API、直接创建、同名未绑定确认与创建前二次检查不改。

**Tech Stack:** Electron、TypeScript、React、Vitest。

---

### Task 1: 文档与状态规则（I002 / R004）

**Files:**

- Modify: `docs/项目功能项目书.md` §4.1
- Modify: `docs/contracts/favorites.md` §5
- Modify: `docs/requirement-ledgers/2026-08-22-missing-formal-shard-deletion-reconciliation.md`

- [x] **Step 1: 写明正式分册是“已备册”唯一事实**

  遗留 `bilibiliFolderId(s)`、标题、数量和`bindingState=bound`在无正式分册时只能用于诊断和经确认的精确 ID删除核验；不能单独显示`已备册`。

- [x] **Step 2: 写明删除安全边界**

  目录重新读取仍含历史精确 ID时，沿用未绑定知情确认；不按标题、`·N`后缀、数量或次序猜测其它 ID。目录确认缺失时，仅在这次已确认删除收敛本地旧绑定。

### Task 2: RED — 历史精确 ID候选与状态投影（I001 / R001–R003）

**Files:**

- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 写出正式分册为空、历史 ID仍出现在目录的失败服务测试**

  建立无 `physicalShards` 的 repository、为 `game` 传入历史精确 ID及真实标题 `bilimi·游戏专区·2`，并让当前目录返回同一 ID。断言预览将该 ID作为要求未绑定知情确认的候选，删除执行只向该 ID发请求。

- [x] **Step 2: 运行 RED 并确认原因**

  运行：`npx vitest run electron/main/favoriteRepositorySyncService.test.ts -t "includes a verified historical remote id when formal shards are missing"`

  预期：失败；当前实现仅从正式分册或规则显示名作名称匹配生成候选，遗漏历史 ID及`·2`标题。

- [x] **Step 3: 写出规则状态不再信任旧 bound 的失败渲染测试**

  传入正式分册缺失的状态投影与仍含旧 ID的规则，断言显示`未备册`，不显示`已备册`；同时断言已有正式分册时仍显示`已备册`。

- [x] **Step 4: 运行 RED 并确认原因**

  运行：`npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "does not display backed up from a legacy remote id without a formal shard"`

  预期：失败；当前 `bindingState=bound`直接显示`已备册`。

### Task 3: GREEN — 最小候选与投影修复（I001）

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/App.tsx`（仅将主进程权威分册状态投影为规则状态所必需的最小部分）
- Modify: `electron/main/favoriteRepositorySyncService.ts`
- Test: `electron/main/favoriteRepositorySyncService.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/App.test.tsx`（若状态投影由 App 承担）

- [x] **Step 1: 以历史精确 ID扩展删除预览输入**

  页面只对“用户选中的默认规则、正式分册缺失、仍含历史远端 ID”的项提交历史精确 ID和上次观察标题；不扩展到自建规则、未选规则或普通删除。

- [x] **Step 2: 在主进程按当前目录精确核验并生成候选**

  `FavoriteRepositorySyncService`仅接受页面提交的历史 ID；目录存在该 ID时生成要求未绑定知情确认的候选，目录缺失时生成`missing-remote`本地收敛候选。执行前继续以预览同一精确 ID复核，不改变其它候选的名称匹配规则。

- [x] **Step 3: 删除成功/缺失确认后收敛同一历史 ID**

  仅消费服务返回的成功 ID或预览确认缺失 ID；移除规则的旧 ID、标题、数量与旧`bound`投影。远端失败、结果未知、预览取消与本地删除均不清理。

- [x] **Step 4: 用正式分册投影覆盖旧`bound`显示**

  有完整正式分册时继续显示`已备册`；不存在分册时将旧 ID显示为`未备册`，保留它作为详情/删除核验线索，不自动创建、绑定或改名。

- [x] **Step 5: 运行 GREEN**

  运行 Task 2两条指定测试，确认通过；再运行相应文件完整测试。

### Task 4: 既有备册回归与证据（I001、I002）

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-22-missing-formal-shard-deletion-reconciliation.md`

- [x] **Step 1: 回归一键备册安全路径**

  运行：`npx vitest run src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteRepositorySyncService.test.ts`

  覆盖已勾选无候选直创直绑、同名未绑定确认、创建前二次检查、删除证据过滤和远端草稿独立投影。

- [x] **Step 2: Electron 只读验收**

  在开发版只打开删除预览或观察状态：不点“我已确认”、未绑定知情确认或最终删除；保存截图到`.codex-artifacts/`。记录无法在无真实远端副作用下复现的删除回执和重新备册闭环。

- [x] **Step 3: 更新账本证据并提交前检查**

  记录代码位置、RED/GREEN、只读界面截图和真实 B 站副作用缺口；运行`git diff --check`、`npm test`、`npm run build`、`git diff --stat`和`git status --short`。只暂存本轮项目书、契约、账本、计划、代码和测试。
