# 已绑定收藏夹改名按弹窗前后名称确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已绑定收藏夹改名收敛为弹窗改名前名称/目标名称与一次同 ID 改名结果的直接比较。

**Architecture:** Renderer 继续以当前精确远端 ID生成弹窗候选并校验确认元组。确认后把弹窗当前名称传给主进程；主进程只校验本地正式绑定仍是同一 ID，发送一次改名请求，并以请求成功返回代表目标名称已应用，随后提交目标标题。移除改名后的详情读取、重试和权威快照补读；失败保持原绑定。

**Tech Stack:** Electron、React、TypeScript、Vitest、Bilibili 页面脚本桥接。

---

### Task 1: 固化一次改名和弹窗名称元组

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron/preload/index.ts`
- Modify: `electron/main/favoriteRepositoryBindingService.ts`
- Test: `src/renderer/src/App.test.tsx`
- Test: `electron/main/favoriteRepositoryBindingService.test.ts`

- [x] **Step 1: Write the failing tests.** Added renderer coverage for the confirmed title pair and a service regression proving one successful rename commits the target title without calling `readFolder`, `readFolderInventory`, or waiting.
- [x] **Step 2: Run the focused tests and verify RED.**

Run: `npx vitest run src/renderer/src/App.test.tsx electron/main/favoriteRepositoryBindingService.test.ts -t "dialog|one rename|without.*readFolder|currentRemoteTitle"`

Expected: FAIL because the current request omits the dialog current title and the service performs post-rename reads/retries.

- [x] **Step 3: Implement the minimal path.** IPC, preload and renderer now pass the dialog name pair; the bound path validates only the formal local tuple plus the target name and sends one exact-ID rename. It commits the target title only after a non-rejected, non-unknown result. Candidate-adoption behavior remains separate.
- [x] **Step 4: Run the focused tests and verify GREEN.**

Run: `npx vitest run src/renderer/src/App.test.tsx electron/main/favoriteRepositoryBindingService.test.ts`

Expected: PASS, including unchanged ordinary creation, same-name candidate binding, multi-shard naming, rejection, and no-create/no-rebind/no-video-write regressions.

### Task 2: Remove obsolete confirmation-only renderer fallback

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: Write the failing test.** Added the renderer regression for an incomplete IPC response that continues the backup without an additional authority-snapshot read.
- [x] **Step 2: Run the test and verify RED.**

Run: `npx vitest run src/renderer/src/App.test.tsx -t "does not read authority snapshot after dialog-confirmed rename"`

Expected: FAIL because the current renderer falls back to `readBoundRenameAuthoritySnapshot` whenever the response lacks a full shard list.

- [x] **Step 3: Implement the minimal change.** The renderer treats the successful exact-ID result as the dialog-confirmed result and projects the displayed target name directly; the authority snapshot helper and failure branch are removed. Cancellation and rejected/unknown responses remain fail-closed.
- [x] **Step 4: Run the focused renderer suite.**

Run: `npx vitest run src/renderer/src/App.test.tsx`

Expected: PASS.

### Task 3: Documentation, regression, and commit

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-rename-runtime-branch-mismatch.md`
- Modify: `docs/superpowers/plans/2026-09-07-bound-favorite-rename-dialog-match.md`

- [x] **Step 1: Run full verification.** `npm test` passed: 249 files / 4454 tests (350.16s); `npm run build` passed; `git diff --check` passed. Final inspection found only the R012 files listed in this plan.
- [x] **Step 2: Update R012 evidence.** Updated the project book and requirement ledger, including R010/R011 supersession and the real-account UI limitation.
- [ ] **Step 3: Commit only this topic.** Ready for the required local commit.

Commit message: `fix: simplify bound rename confirmation`
