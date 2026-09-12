# 备册绑定状态回归修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复用户明确备册后卡片、状态灯和收藏库状态不一致的问题，并使新确认的远端 ID 安全替换陈旧 ID。

**Architecture:** 正式物理分册增加“用户明确确认采用”的可持久化来源。主进程只在该来源的采用命令或账户重开恢复时，清除同一逻辑册的删除保护；普通投影、同步扩容和改名不触发该动作。渲染层从一个共享的派生状态取得未备册、未绑定、部分已备册和已备册标签。

**Tech Stack:** TypeScript、Electron IPC、electron-store、Vitest、React Testing Library。

---

## File structure

- `src/shared/favoriteRepository.ts`：物理分册来源字段、命令校验及同分册 ID 替换的状态保留。
- `src/shared/favoriteLedgerBindingProjection.ts`：根据正式分册及受控恢复选项投影规则 ID、删除保护和删除历史。
- `src/shared/favoriteLedgerBackupState.ts`：供助手卡片、全局状态灯使用的同一展示状态派生。
- `electron/main/favoriteRepositoryBindingService.ts`：仅显式采用写入来源字段；改名和自动创建不晋升删除保护。
- `electron/main/favoriteRepositoryIpc.ts`、`electron/main/index.ts`：将采用/改名区分为结构化事件；主进程同步投影并返回权威绑定字段。
- `src/renderer/src/App.tsx`：采用主进程返回的权威绑定字段，不再自行清除删除保护。
- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`、`FloatingAssistantApp.tsx`、`features/favorites/favoriteLibraryModel.ts`：显示同一绑定状态。
- 对应 `*.test.ts(x)`：覆盖持久化恢复、替换 ID、删除保护、IPC 事件以及卡片/状态灯/收藏库文案。

### Task 1: 固化用户确认采用的来源与安全投影

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Modify: `src/shared/favoriteLedgerBindingProjection.ts`
- Test: `src/shared/favoriteRepository.test.ts`
- Test: `src/shared/favoriteLedgerBindingProjection.test.ts`

- [x] **Step 1: 写失败测试**：断言 `userConfirmedAdoption` 只有在同逻辑分册的新 exact ID 已正式 `bound` 时允许替换旧 ID；普通 bound 分册保留 `managedFolderDeletedByUser` 和全部删除历史。
- [x] **Step 2: 运行失败测试**：`npm test -- src/shared/favoriteRepository.test.ts src/shared/favoriteLedgerBindingProjection.test.ts`，确认新字段/受控投影尚未实现导致失败。
- [x] **Step 3: 最小实现**：为物理分册命令与快照增加可选 `userConfirmedAdoption`；兼容 replay 时以历史 `favorite-adoption:` 命令作为明确采用来源。投影仅在 `allowUserConfirmedDeletionRecovery` 为真时清除标记、清除 pending 字段，并只从删除历史移除该采用分册的 exact ID。
- [x] **Step 4: 运行通过测试**：重跑上一步命令，确认 ID 冲突仍被拒绝、旧的不同删除 ID仍保留。

### Task 2: 主进程采用/改名与可恢复投影边界

**Files:**
- Modify: `electron/main/favoriteRepositoryBindingService.ts`
- Modify: `electron/main/favoriteRepositoryIpc.ts`
- Modify: `electron/main/index.ts`
- Test: `electron/main/favoriteRepositoryBindingService.test.ts`
- Test: `electron/main/favoriteRepositoryIpc.test.ts`
- Test: `electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`

- [x] **Step 1: 写失败测试**：确认采用 IPC 传入 exact ID 后得到主进程权威规则；rename 只刷新普通投影；投影异常不把已提交的远端采用伪装为失败且写入诊断。
- [x] **Step 2: 运行失败测试**：`npm test -- electron/main/favoriteRepositoryBindingService.test.ts electron/main/favoriteRepositoryIpc.test.ts electron/main/favoriteLedgerConfigurationRefreshIpc.test.ts`。
- [x] **Step 3: 最小实现**：采用命令设置来源；IPC 向回调传递 `{ kind: 'adoption' | 'rename', logicalLedgerId, remoteFolderId }`，只对 adoption 允许解除保护。账户打开使用持久化来源恢复一次投影；所有自动分册/改名调用普通投影；任何吞掉的后续错误写 `console.error` 诊断。
- [x] **Step 4: 运行通过测试**：重跑上一步命令，确认候选采用不创建/改名/移动视频，改名和扫描无法解除删除保护。

### Task 3: 消除渲染器双真相并统一显示状态

**Files:**
- Create: `src/shared/favoriteLedgerBackupState.ts`
- Test: `src/shared/favoriteLedgerBackupState.test.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/favorites/favoriteLibraryModel.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Test: `src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`

- [x] **Step 1: 写失败测试**：同一规则同时有正式分册线索和未绑定证据时，卡片与状态灯均显示 `部分已备册 · 仍待绑定`，不再一个显示 `已备册`、另一个显示 `未绑定`；收藏库存在部分 bound 分册时也显示该状态。
- [x] **Step 2: 运行失败测试**：`npm test -- src/shared/favoriteLedgerBackupState.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/favorites/favoriteLibraryModel.test.ts`。
- [x] **Step 3: 最小实现**：共享派生函数把用户删除标记优先解析为未绑定、冲突的 bound/unbound 解析为部分已备册。`App.tsx` 使用采用 IPC 返回的权威规则字段，删除乐观清除 marker 的代码；收藏库将“存在部分正式分册”作为 `partial` 状态。
- [x] **Step 4: 运行通过测试**：重跑上一步命令，并运行 `npm test -- src/renderer/src/App.test.tsx` 检查现有候选、取消、失败和改名流程。

### Task 4: 文档核对、全量验证与交付

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-12-backup-binding-status-regression.md`
- Modify: `docs/superpowers/plans/2026-09-12-backup-binding-status-regression.md`

- [x] **Step 1: 回读 R001–R008**：在账本索引逐条填写实际代码位置、自动测试命令、结果和仍需真实界面验收的条件。
- [x] **Step 2: 静态与自动验证**：`git diff --check` 退出 0；`npm test` 退出 0（253 files / 4619 tests）；`npm run build` 退出 0。
- [x] **Step 3: 形态验收**：`npm run dev` 与 `npm run preview` 均退出 0 且启动 Electron。真实点击验收未完成：Computer Use 报 `unsupported Codex auth method: apikey`，已在账本逐项标注为待人工验收，未把启动成功当作交互通过。
- [x] **Step 4: 发布前检查与提交**：已运行 `git status --short`、`git diff --stat`、`git diff --check`，当前仅本轮文件；只读审查无 P0/P1，准备创建一个本地提交。用户若再次明确要求打包，才在干净已提交树上执行 `npm run dist:win`。

## Plan self-review

- R001 的显示冲突由任务 3 覆盖；R002–R005 的既有边界与删除保护由任务 1–2 覆盖；R006 的取消/失败零写入由任务 2–3 回归；R007 的 exact-ID 替换与冲突拒绝由任务 1–2 覆盖；R008 的文档优先和可审计证据由任务 4 覆盖。
- 本计划没有自动认领、名称作为 ID、额外 B 站写入、删除远端夹、重分类或打包步骤。
