# 已绑定改名加载态精确回读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B 站已确认改名后，页面暂时加载不再中断同一远端 ID 的回读、正式绑定标题提交与本次备册继续。

**Architecture:** 保留页面桥对加载、导航和账号变化的保护。绑定服务仅将精确详情读取返回的 `target-loading` 识别为当前验证循环的短暂不可读，并复用既有有界间隔重新读取同一 `remoteFolderId`；任何其他错误仍按原路径失败，名称匹配、远端 ID、正式绑定与刷新顺序不变。

**Tech Stack:** TypeScript、Electron、Vitest。

---

### Task 1: 加载态回读的失败回归（R011）

**Files:**

- Modify: `electron/main/favoriteRepositoryBindingService.test.ts`

- [x] **Step 1: 写失败测试。** 为已正式绑定 `game-loading` 分册构造一次用户确认改名：目录预检返回旧标题，`renameFolder` 成功；首次 `readFolder` 抛出 `Error('target-loading')`，第二次返回同一 `game-loading` ID、目标标题和成员数。断言调用在一次 `waitForInventoryRetry(250)` 后成功提交原 ID 的 `bound` 标题，且不调用收养或创建。

- [x] **Step 2: 验证 RED。** 运行 `npx vitest run electron/main/favoriteRepositoryBindingService.test.ts -t "retries an exact bound rename read after the bound page is temporarily loading"`；现状因 `target-loading` 直接失败，符合预期。

### Task 2: 最小有界加载态重试（R011）

**Files:**

- Modify: `electron/main/favoriteRepositoryBindingService.ts:100-116`
- Modify: `electron/main/favoriteRepositoryBindingService.ts:319-345`

- [x] **Step 1: 实现精确暂态判定。** 新增仅识别错误原因 `target-loading` 的局部判断；不匹配的桥接错误继续原样抛出，不能吞掉导航、账号、网络、风险控制或远端响应错误。

- [x] **Step 2: 继续既有验证循环。** 在已绑定改名的 `readExactRemoteFolderForRename()` 捕获处，若该次是 `target-loading` 且尚有下一次有界检查，则继续循环；下一轮先执行既有等待再读相同 `remoteFolderId`。循环结束仍未得到同 ID目标标题时保留原“未确认”失败语义。

- [x] **Step 3: 验证 GREEN。** 专项用例通过；`npx vitest run electron/main/favoriteRepositoryBindingService.test.ts` 为 60/60 通过，之后与 `App.test.tsx` 联跑为 227/227 通过。

### Task 3: 项目文档、全量验证与提交（R011）

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-07-favorite-rename-runtime-branch-mismatch.md`
- Modify: `docs/superpowers/plans/2026-09-07-bound-favorite-rename-loading-retry.md`

- [x] **Step 1: 回填账本。** 已记录 `target-loading` 现场堆栈、测试代码位置、精确 ID/无创建无重绑无视频写入边界，以及真实 B 站界面仍待验收。

- [x] **Step 2: 执行验证。** `bindingService + App` 为 227/227 通过；`npm test` 为 249 文件 / 4453 测试通过，`npm run build` 退出码 0，`git diff --check` 退出码 0。开发版只确认进程仍来自本分支，不主动触发 B 站改名。

- [x] **Step 3: 提交。** 检查 `git status --short` 与 `git diff --stat` 只包含 R011 代码、测试和文档后，创建一个本地提交；不合并、推送、rebase 或删除分支/工作树。
