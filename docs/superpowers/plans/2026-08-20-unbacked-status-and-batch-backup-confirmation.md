# 未备册状态与全量备册确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让真实 B 站远端草稿不影响已保存本地规则的备册状态，并让右侧一键备册在无候选时也准确展示锁定范围的全选目标。

**Architecture:** 保持主进程备册 API 和远端草稿投影不变。渲染层将远端草稿从全局备册状态灯优先级中移除；右侧确认弹窗在候选列表为空时改为只读的“本次创建目标”清单，而已有候选的默认全选和分册排序逻辑维持原样。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Electron renderer。

---

### Task 1: 固定状态与确认页回归

**Files:**

- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [x] **Step 1: 写入失败测试**

将只有远端草稿时全局状态灯的预期改为`未备册`；将无候选全量备册确认页的预期改为标题`确认创建并绑定 bilimi 收藏夹`，并断言每个锁定本地规则显示已勾选的创建目标。

- [x] **Step 2: 运行失败测试**

Run: `npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: FAIL，当前实现仍把远端草稿投影为`未绑定`，并且无候选确认页仍使用旧标题、没有已选创建目标。

### Task 2: 修正渲染状态与确认页

**Files:**

- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`

- [x] **Step 1: 修正全局状态灯优先级**

删除仅因`remoteOnlyDraftLedgerIds`返回`未绑定`的分支。保留`unboundLedgerIds`、`missingLedgerIds`和本地备册缺口的原有顺序，让全局灯只反映已保存本地规则。

- [x] **Step 2: 修正无候选确认页**

从`rebindCandidates`中识别`candidates.length === 0`的创建目标。确认页存在创建目标时使用标题`确认创建并绑定 bilimi 收藏夹`；每个无候选目标显示只读、已勾选的“将创建并绑定”行。已有候选继续使用现有默认全选、逐候选取消及分册顺序调整，不改变提交载荷。

- [x] **Step 3: 运行目标测试**

Run: `npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

Expected: PASS。

### Task 3: 更新项目合同与全量回归

**Files:**

- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-20-unbacked-shows-unbound.md`

- [x] **Step 1: 写入最终项目合同**

记录远端草稿不参与全局备册状态、右侧一键备册锁定当前勾选范围、已有候选默认全选、无候选创建确认页逐项显示已选目标，以及备册仅创建或明确绑定、绝不删除的边界。

- [x] **Step 2: 运行相关与全量验证**

Run: `npx vitest run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts && npm run build && git diff --check`

Expected: 所有测试和构建通过，差异无空白错误。

- [x] **Step 3: 记录账本证据并提交**

更新 I001、I002 的代码位置与验证证据；仅暂存本轮项目书、计划、账本、测试和实现文件，排除 `docs/requirement-ledgers/2026-08-20-deepseek-auto-summary-not-triggered.md`，创建一次本地提交。
