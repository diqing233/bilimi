# 当前收藏夹备册提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让当前视频卡片只依据当前匹配收藏夹规则的实际状态显示“未备册”。

**Architecture:** 在渲染层增加一个纯判定函数，使用当前分类 ID与已验证的 `FavoriteLedgerStatus` 做精确匹配；卡片提示由该函数驱动。全局工作区备册状态和 B 站读写流程保持不变。

**Tech Stack:** React、TypeScript、Vitest、Testing Library。

---

### Task 1: 当前规则状态判定

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/favoriteWorkspaceReadiness.test.ts`

- [x] **Step 1: Write the failing test**

  添加测试：当前规则 `game` 已绑定、另一个规则 `entertainment` 在 `missingLedgerIds` 中时，当前规则不应被判定为缺失；反向测试当前规则在 `missingLedgerIds` 中时应判定为缺失。

- [x] **Step 2: Run the focused test and verify the failure**

  运行 `npm test -- src/renderer/src/features/assistant/favoriteWorkspaceReadiness.test.ts`，确认新断言因现有函数只支持全局判断而失败。

- [x] **Step 3: Implement the minimal pure function and wire the card hint**

  导出按当前 `ledgerId` 精确判断的函数；要求 `favoriteLedgerStatus.verified === true`，并检查当前 ID 是否出现在 `missingLedgerIds` 或 `unboundLedgerIds`，再替换 `favoriteProvisioningHint` 的全局条件。

- [x] **Step 4: Run focused and related tests**

  运行 `npm test -- src/renderer/src/features/assistant/favoriteWorkspaceReadiness.test.ts src/renderer/src/features/assistant/MemorialPanel.test.tsx`，确认通过。

- [x] **Step 5: Run repository verification**

  运行 `npm test`、`git diff --check`、`git status --short`，确认无测试失败、无空白错误、没有超出本轮文件范围的业务改动。

- [ ] **Step 6: Commit and package**

  将本轮需求账本、设计/计划文档、测试和实现一起提交；工作树干净后按项目入口运行 `npm run dist:win`。
