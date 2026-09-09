# 显式远端收藏夹发现恢复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅在用户主动保存或备册时恢复 B 站只读观察和正式绑定改名确认，且不把观察结果自动写成收藏库分册或 B 站变更。

**Architecture:** 复用 `FavoriteLedgerOverview` 的既有确认链。观察候选默认不选；选择后才保存本地未绑定草稿。备册保留原目标列表，保存只做只读预检和本地草稿，不进入备册写入。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron IPC。

---

### Task 1: 只读预检契约

**Files:** `src/renderer/src/App.test.tsx`, `src/renderer/src/App.tsx`

- [ ] 先新增失败测试：一次 `remoteObservationPreflight` 同时返回 `remoteObservations` 和 `boundRenameCandidates`，并断言未运行 B 站写脚本。
- [ ] 运行 `npx vitest run src/renderer/src/App.test.tsx -t "returns remote observations and bound rename candidates together" --reporter=dot`，预期因预检提前返回而失败。
- [ ] 只在预检分支调用既有正式绑定分册读取，并把改名候选写回预检结果；不调用 `runScript`、改名写入或恢复投影。
- [ ] 重跑同一测试及现有只读预检用例，预期通过。

### Task 2: 备册观察确认

**Files:** `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`, `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [ ] 先将“观察不打断备册”替换成失败测试：预检后出现“发现疑似 bilimi 收藏夹”，默认不保存草稿。
- [ ] 新增失败测试：选中候选并确认后仅保存 `createRemoteObservationFavoriteLedgerId('88')`、`bindingState: 'unbound'`、`pendingRemoteBinding: true` 的本地草稿；随后备册目标仍是原 `['music']`。
- [ ] 运行 `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "remote-only observation|selected remote observation" --reporter=dot`，预期失败。
- [ ] 为首次备册加只读预检；实现默认不选、取消只关闭、选择后才保存草稿。备册模式成功保存后使用原目标继续现有备册；无选择直接继续；保存失败停止。
- [ ] 重跑上述测试，预期通过。

### Task 3: 保存只读提示与组合确认

**Files:** `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`, `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [ ] 先新增失败测试：规则保存成功后发起只读预检并显示观察候选；确认时绝不进入备册写入。
- [ ] 新增失败组合测试：观察确认完成后，若同次预检有正式绑定改名候选，打开已有改名确认。
- [ ] 运行 `npx vitest run src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx -t "save.*remote observation|observation.*bound rename" --reporter=dot`，预期失败。
- [ ] 保存成功后以保存规则 ID 调只读预检；预检失败不撤销保存。保存模式确认仅保存选中草稿，之后打开暂存的改名确认；取消全部关闭、下次主动操作可再提示。
- [ ] 重跑上述测试，预期通过。

### Task 4: 回归、账本与提交

**Files:** `docs/requirement-ledgers/2026-09-08-favorite-library-duplicate-shards.md`

- [ ] 运行 `npx vitest run src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx --reporter=dot`，确认删除、绑定、改名和观察回归。
- [ ] 运行 `npm test`、`npm run build`、`git diff --check`、`git status --short` 与 `git diff --stat`。
- [ ] 更新账本 I006 的代码位置和验证证据；重新逐条核读 R001–R007 后，仅提交本主题文件，提交信息为 `fix: restore explicit remote favorite discovery`。不修改 `docs/requirement-ledgers/2026-09-08-save-round-to-library-disabled.md`。
