# 清除已删除远端草稿的打开目标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 成功从 B 站删除一个未保存、仅名称识别的远端草稿后，右侧掌库不再把该草稿重新显示为“未备册”。

**Architecture:** 将“远端草稿删除成功”从 `FavoriteLedgerOverview` 通过现有面板层显式回传到 `FloatingAssistantApp`。父层仅在被删除 ID 等于当前请求打开的临时草稿时清空 `requestedLedgerId` 与标题，阻止 `projectFavoriteLedgerDraft` 再次生成该草稿；已保存规则、默认规则与收藏库投影保持不变。

**Tech Stack:** React、TypeScript、Vitest、React Testing Library。

---

### Task 1: 锁定删除远端临时草稿后的显示行为

**Files:**
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/favoriteLedgerDraftProjection.test.ts`

- [x] **Step 1: 写入失败的面板级回归测试**

为 `FavoriteLedgerOverview` 增加一个 `local-draft`、`remoteOnlyDraftLedgerIds` 和精确远端 ID 的删除场景；断言 B 站删除确认成功后，新的 `onRemoteDraftDeleted` 回调接收该 ID。为 `ControlledFavoriteLedgerPanel` 增加转发该回调的测试，确保中间层不丢失通知。

- [x] **Step 2: 运行针对性测试，确认其因缺少删除成功通知而失败**

Run: `npm test -- FavoriteLedgerOverview.test.tsx ControlledFavoriteLedgerPanel.test.tsx`

Expected: FAIL，测试报告 `onRemoteDraftDeleted` 尚未定义或未被调用；不得因测试环境或类型错误失败。

- [x] **Step 3: 写入最小生产实现**

在 `FavoriteLedgerOverviewProps` 增加可选 `onRemoteDraftDeleted`；仅在 `finalizeManagedDeletionPlan` 已完成且 `deletionScope === 'bilibili'` 时，向其传递本次计划的 `draftLedgerIds`。在 `ControlledFavoriteLedgerPanel` 和 `LedgerWorkspacePanel` 转发该回调；`FloatingAssistantApp` 只在回调 ID 与当前 `requestedLedgerId` 精确相等时清除 ID、标题及请求版本。

- [x] **Step 4: 运行针对性测试，确认通过**

Run: `npm test -- FavoriteLedgerOverview.test.tsx ControlledFavoriteLedgerPanel.test.tsx favoriteLedgerDraftProjection.test.ts`

Expected: PASS，新的删除回归测试及既有孤儿草稿投影测试均通过。

### Task 2: 回归验证与审计记录

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-14-managed-folder-delete-retention-question.md`

- [x] **Step 1: 执行本轮相关完整测试与类型检查**

Run: `npm test -- FavoriteLedgerOverview.test.tsx ControlledFavoriteLedgerPanel.test.tsx favoriteLedgerDraftProjection.test.ts`，然后运行项目的 TypeScript/构建检查脚本。

Expected: 所有命令退出码为 0；不得改变 B 站、收藏库或开发配置中的用户数据。

- [x] **Step 2: 更新账本 I001 的实际代码位置、自动化测试、界面验收和未验证条件**

记录精确代码位置与命令输出。真实 Electron 界面验收仅在开发版启动后执行；如果当前会话不能安全执行，不以自动化测试替代并明确标为待验收。

- [x] **Step 3: 检查提交范围并本地提交**

Run: `git status --short`、`git diff --stat`、`git diff --check`。

仅提交本计划、账本、回归测试及本轮生产代码，提交信息：`fix: clear deleted remote draft target`。

## 实施记录（2026-09-15）

- RED：新增 `FavoriteLedgerOverview` 回归测试后，`npm test -- FavoriteLedgerOverview.test.tsx` 以缺少 `onRemoteDraftDeleted` 调用失败；新增精确 ID 清理测试后，`npm test -- FloatingAssistantApp.test.ts` 以函数不存在失败。
- GREEN：`FavoriteLedgerOverview` 在 B 站范围删除完整成功后仅回传 `remoteDraftTargets` 的草稿 ID；`ControlledFavoriteLedgerPanel` 与 `LedgerWorkspacePanel` 原样转发；`FloatingAssistantApp` 仅对匹配的当前请求 ID 清除临时目标。初版行内回调触发了现有掌库渲染隔离测试，已改为 `useStableCallback`，并以 `FloatingAssistantApp.renderIsolation.test.tsx` 验证设置页切换不重渲染掌库。
- 回归补充：新增批量删除 `partial-failed` 场景，RED 中 `onRemoteDraftDeleted` 为 0 次调用；GREEN 只根据 `succeededRemoteFolderIds` 回传对应 `remoteDraftTargets` 草稿 ID，绝不回传同批失败的已保存规则。单测转绿。
- 验证：定向 4 文件 292/292 通过；完整 `npm test -- --reporter=dot --maxWorkers=1 --minWorkers=1` 为 255 文件、4694 测试通过；`npm run build` 通过（仅既有的 FloatingAssistantApp 动态/静态导入分包提示）。
- 手工界面验收：Computer Use 初始化因认证错误不可用；未执行真实 B 站删除，待开发版手工验证“已删除远端临时草稿立即从右侧消失”。
