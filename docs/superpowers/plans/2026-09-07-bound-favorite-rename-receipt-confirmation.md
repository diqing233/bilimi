# 已绑定改名回执权威确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已确认的精确远端分册改名在 IPC 回执缺少完整 `shards` 时，以一次只读权威快照确认后继续原备册，而不误报失败。

**Architecture:** renderer 仍先调用既有主进程精确 ID 改名命令。仅当命令回执没有同一逻辑册、分册号、远端 ID、`bound` 状态和目标名称的完整分册时，读取一次同账号 `openFavoriteRepositoryAccount`；该快照满足同一五元组才替代不完整回执用于本地投影，否则保持失败且不触发任何其他 B 站写入。

**Tech Stack:** React、TypeScript、Electron IPC、Vitest。

---

### Task 1: 回归测试（R010）

**Files:**

- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 写失败测试。** 在已正式绑定分册的确认备册场景，让 `renameFavoriteRepositoryBoundLedgerShard` 返回没有匹配分册的 `shards`，而第二次 `openFavoriteRepositoryAccount` 返回同一 `logicalLedgerId`、`shardNumber`、`remoteFolderId`、`bound` 与目标标题。断言请求仍成功，且不调用收养、创建或视频写入。

- [x] **Step 2: 验证 RED。** 运行 `npx vitest run src/renderer/src/App.test.tsx -t "continues a confirmed bound rename when the authority snapshot confirms an incomplete IPC receipt"`；修改前得到 `ok: false`，验证不完整回执被直接判失败。

### Task 2: 最小只读确认（R010）

**Files:**

- Modify: `src/renderer/src/App.tsx`

- [x] **Step 1: 实现最小确认。** `App.tsx` 让回执匹配同时校验目标标题；不匹配时读取 `openFavoriteRepositoryAccount(accountMid)`，从 `physicalShards` 匹配逻辑册、分册号、精确远端 ID、`bound` 和目标标题，并将命中分册包装为原有投影可消费的快照。读取失败或任一字段不一致都保留失败，不创建、重绑或再次改名。

- [x] **Step 2: 映射可诊断错误。** 对“回执不完整且权威快照未确认”提供专用中文失败原因，保留底层诊断字符串；其他既有失败映射不变。

- [x] **Step 3: 验证 GREEN。** 重跑 Task 1 命令后通过；另补“权威快照不确认时不进入备册”的失败闭环用例。

### Task 3: 回归、证据与提交（R010）

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-rename-runtime-branch-mismatch.md`

- [x] **Step 1: 定向回归。** 运行 `npx vitest run src/renderer/src/App.test.tsx electron/main/favoriteRepositoryBindingService.test.ts`，225 个测试通过；最终两条 R010 专项用例也通过。

- [x] **Step 2: 全量验证。** 补充失败闭环测试后，`npm test` 通过 249 个文件 / 4452 个测试，`npm run build` 退出码 0。

- [x] **Step 3: 回填并提交。** R010 已回填代码位置、自动化和真实界面待验收边界；提交前已运行 `git status --short`、`git diff --stat`、`git diff --check`，仅提交本主题文件，提交信息为 `fix: confirm bound rename from authority snapshot`。
