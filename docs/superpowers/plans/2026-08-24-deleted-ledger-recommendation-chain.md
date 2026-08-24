# 删除规则后的推荐、预览与同步投影一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使一个已采用推荐对应的已保存规则被删除后，推荐选择、整轮分类、归档预览和同步前目标从同一最终权威工作区快照读取。

**Architecture:** `assistant:delete-favorite-ledgers-local` 在同一个主进程串行操作中先记录被删规则，再从当前工作区推荐候选按规则语义解析关联候选，撤销这些候选的采用状态并持久化，最后以最终规则目录重分类。渲染器只在 IPC 成功返回后刷新权威工作区，不能在删除前乐观取消推荐。

**Tech Stack:** Electron IPC、TypeScript、React、Vitest、Testing Library。

---

### Task 1: 主进程删除事务的 RED 回归

**Files:**
- Modify: `electron/main/index.test.ts` 或现有覆盖 `assistant:delete-favorite-ledgers-local` 的测试文件
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: 写失败测试**

构造一个`previewing`工作区：候选`custom-author-up-alpha`已经采用，顶部有语义相同但 ID 不同的已保存规则；调用删除本地规则后断言最终快照：

```ts
expect(snapshot.recommendations.adoptedCandidateIds).not.toContain('custom-author-up-alpha')
expect(snapshot.classifications['1']?.targetLedgerIds).not.toContain('custom-author-up-alpha')
expect(snapshot.classifications['2']?.targetLedgerIds).toEqual(['remaining-ledger'])
```

再覆盖删除拒绝/重分类失败时：规则、采用候选和分类均保持删除前状态。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run <selected-main-test-files>`

Expected: 新用例失败，失败原因是删除 IPC 只删除偏好规则并直接重分类，没有撤销关联候选。

### Task 2: 实现同一串行删除事务

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/index.ts`

- [x] **Step 1: 增加受限协调器方法**

定义一个仅由已成功删除本地规则后调用的方法，接收已删除规则的稳定语义（ID、类型、规范化关键词），在`queue`内读取当前推荐状态，删除精确语义匹配候选的`adoptedCandidateIds`，追加推荐 overlay、持久化推荐规则投影，并返回最终工作区快照。

- [x] **Step 2: 在删除 IPC 中实现原子顺序**

删除 IPC 先保存新的规则目录；随后在同一调用中由协调器依次撤销关联候选采用、持久化、全轮重分类。若协调器步骤失败，在返回错误前补偿恢复原规则目录，不向渲染器发布成功；不得执行任何 B 站写入。

- [x] **Step 3: 运行 GREEN**

Run: `pnpm exec vitest run <selected-main-test-files>`

Expected: Task 1 的成功与失败回归通过。

### Task 3: 渲染器完整链路 RED/GREEN

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`（仅在测试证明需要刷新防护时）

- [x] **Step 1: 写失败测试**

模拟顶部同语义保存规则的删除 IPC 成功后，`openOldFavoriteWorkspaceV1`返回主进程最终快照。断言下方候选未勾选，归档预览只展示余下规则的真实计数；同步确认入口读取的预检目标仅包含余下规则。删除 IPC 拒绝时断言原勾选和预览保持。

- [x] **Step 2: 运行 RED**

Run: `pnpm exec vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 旧实现未刷新或旧推荐队列覆盖时失败。

- [x] **Step 3: 最小渲染器修复**

仅在主进程成功删除并完成事务后读取匹配账号、同一工作区的权威快照；拒绝迟到的旧刷新或旧推荐保存结果。不得新增第二个本地删除或推荐取消 IPC。

- [x] **Step 4: 运行 GREEN**

Run: `pnpm exec vitest run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: Task 3 的成功/失败链路通过。

### Task 4: 预检与冻结同源目标验证

**Files:**
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: 添加一致性回归**

在 Task 1 的最终快照上调用无副作用预检与冻结前读取，断言两者只出现仍在最终分类中的目标及其 AID；删掉的候选既不进入缺口备册清单，也不进入计划。

- [x] **Step 2: 运行定向回归**

Run: `pnpm exec vitest run electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: 预检、冻结与最终分类使用同一目标集合。

### Task 5: 账本、验证与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-24-deleted-ledger-recommendation-chain-desync.md`

- [x] **Step 1: 回填 I001–I003**

逐项记录实际代码位置、RED/GREEN 命令、自动化结果、未执行真实 B 站副作用与 Electron 只读验收状态。

- [x] **Step 2: 运行验证**

Run: `pnpm exec vitest run <related files>`, `npm test`, `npm run build`, `git diff --check`, `git diff --stat`, `git status --short`

Expected: 仅本轮文件与既有无关改动并存；不运行`dist`、发布、推送、合并或任何真实 B 站写操作。

- [x] **Step 3: 选择性提交**（`b94aacd6 fix: unify deleted favorite rule projections`；Electron 只读验收因无可控窗口未完成，已在账本记录。）

只暂存本轮主进程、渲染器、测试、账本和本计划；不包含当前未提交的 DeepSeek、同步选项、锁文件或临时结果。
