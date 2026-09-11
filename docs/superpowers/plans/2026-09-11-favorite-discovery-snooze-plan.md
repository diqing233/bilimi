# 收藏夹发现提示暂不提醒实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement each task with a failing test first, then verify the complete suite before committing.

**Goal:** 为收藏夹发现汇总提示增加按账号持久化的“暂不提醒”，并在下一次有效只读发现成功后唤醒。

**Architecture:** 将隐藏标记放入现有 `FavoriteAccountPreferences`，由 App 负责账号级持久化与成功发现后的清除，由 `FavoriteLedgerOverview` 负责纯 UI 显示/隐藏。通过 FloatingAssistantApp 和 ControlledFavoriteLedgerPanel 透传，避免新增全局状态或 B 站写入。

**Tech Stack:** React 19、TypeScript、Vitest、Electron preload 偏好 patch、现有 AssistantPreferences 归一化。

---

### Task 1: 偏好字段与归一化

**Files:**
- Modify: `src/shared/types.ts` (`FavoriteAccountPreferences`)
- Modify: `src/renderer/src/features/state/assistantState.ts` (`normalizeFavoriteAccountPreferenceMap`)
- Test: `src/renderer/src/features/state/assistantState.test.ts`

- [ ] 写测试：旧账号偏好默认 `favoriteDiscoveryNoticeDismissed` 为 `false`，布尔值可被保留，非法值归一化为 `false`。
- [ ] 运行该测试并确认在字段不存在前失败。
- [ ] 增加可选字段 `favoriteDiscoveryNoticeDismissed?: boolean` 并在账号偏好归一化中保留严格布尔值。
- [ ] 运行定向测试确认通过。

### Task 2: 掌库提示 UI

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`

- [ ] 写测试：有发现结果且未隐藏时同时显示“查看详情”和“暂不提醒”；隐藏时两者都不显示；点击按钮只调用回调，不触发保存/同步。
- [ ] 运行测试确认失败。
- [ ] 增加 `remoteDiscoveryNoticeDismissed` 与 `onDismissRemoteDiscoveryNotice` props，在现有提示旁渲染按钮并按字段隐藏。
- [ ] 运行组件定向测试确认通过。

### Task 3: 透传与账号级持久化回调

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`, `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

- [ ] 写测试：当前账号的隐藏字段被传到概览组件；点击回调通过现有偏好 patch 写入该账号，其他账号字段不变。
- [ ] 运行测试确认失败。
- [ ] 透传 props；在 FloatingAssistantApp 中按当前账号构造最小 `favoriteAccountPreferences` patch，立即更新 UI 并等待现有 scheduler 持久化。
- [ ] 运行透传与持久化定向测试确认通过。

### Task 4: 发现成功后的唤醒

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [ ] 写测试：隐藏后普通刷新/新建/重命名/删除成功发布新发现时清除标记并通知快照；刷新失败或只读目录未验证时不清除。
- [ ] 运行测试确认失败。
- [ ] 在 `publishManualFavoriteDiscovery` 成功得到 verified 结果后清除账号字段；让备册成功后的最终只读发现复用同一清除 helper；失败分支不清除。
- [ ] 运行 App 定向测试确认通过，并核对不执行额外 B 站写入。

### Task 5: 关联回归、账本与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-11-one-click-backup-unbound-notice-order.md`

- [ ] 运行组件、App、收藏夹 API/库视图、观察器/协调器回归。
- [ ] 运行 `npm test -- --reporter=dot --maxWorkers=1 --minWorkers=1`、`npm run build`、`git diff --check`。
- [ ] 更新 R014-R016 的实施位置、测试证据和真实 Electron 待验收记录。
- [ ] 检查工作树只含本轮文件，提交一次本地 `main` commit，不 push/merge/rebase。
