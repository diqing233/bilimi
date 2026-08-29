# 同步前备册状态与整理收藏响应实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or equivalent). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“确认并同步到 B 站”严格先完成备册与权威状态刷新，再显示同步进度，同时隔离账号退出/切换造成的旧备册状态泄漏，并保持按钮和窗口响应。

**Architecture:** 在渲染器建立账号状态清理与代次保护；备册完成后的权威读取使用同账号 single-flight，且在同步执行入口前完成一次 fail-closed 预检。将状态刷新从重复等待改为可去重的阶段任务，但同步启动只接受已完成的权威预检结果；界面只锁定重复提交按钮，不给整个整理区域设置忙碌光标。

**Tech Stack:** TypeScript、React、Electron、Vitest。

---

### Task 1: 增加账号状态隔离与顺序回归（RED）

**Files:**
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写入账号清理失败测试**

覆盖账号从 `100` 变为空、从 `100` 切到 `200`、旧账号状态读取晚到三种情形，断言快照不得携带旧账号的 `favoriteLedgerStatus`。

- [ ] **Step 2: 写入备册先行失败测试**

模拟备册返回已绑定但权威状态读取尚未完成，断言确认处理不会先调用 `executeConfirmedBilibiliSync`；状态刷新成功且重新预检无缺口后才允许进入同步。

- [ ] **Step 3: 运行 RED**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "account|备册|同步进度|stale"`

Expected: 新增断言在当前实现失败，明确暴露旧状态未清理、异步结果可回写或同步启动顺序不满足的问题。

### Task 2: 修复账号状态清理和 single-flight 刷新（GREEN）

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: 统一清理账号失败路径**

在 `readBilibiliAccountMid` 的空账号、无活动 WebView 和异常分支统一清空 `accountMid`、`favoriteLedgerStatus`、`favoriteLedgerStatusCacheRef` 并递增代次。

- [ ] **Step 2: 清理账号变化回调的旧快照**

在 `onBilibiliAccountChanged` 触发异步 `loadSnapshot` 前立即投影空账号状态；只允许当前代次和当前账号的异步结果写回。

- [ ] **Step 3: 去重备册后状态读取**

保留备册后的权威刷新，但以账号级 single-flight 复用在途读取；状态刷新失败保持错误/可重试事实，不将旧缓存重新作为已备册依据。

- [ ] **Step 4: 移除整理区域忙碌光标**

仅删除同步相关 `data-busy` / `data-preview-preparing` 的 `cursor: progress` 样式影响，保留按钮禁用和准确阶段状态，不改变任何业务锁。

### Task 3: 固定备册先行再同步（GREEN）

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 保持单弹窗并等待权威确认**

在统一备册确认处理完成后，先完成状态刷新和重新预检；只有无 `missingLedgers`、无 `requiredPhysicalShards` 且账号仍有效时才清理弹窗并调用 `executeConfirmedBilibiliSync`。

- [ ] **Step 2: 失败/未知停留确认窗**

备册失败、账号失效、状态刷新失败或预检变化时，更新同一弹窗错误，不启动同步，不伪造同步中。

### Task 4: 验证、账本证据与提交

- [ ] **Step 1: 运行聚焦回归**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx electron/main/favoriteRepositorySyncService.test.ts`

- [ ] **Step 2: 运行全量检查**

Run: `npm test`; `npm run build`; `git diff --check`; `git diff --stat`; `git status --short`。

- [ ] **Step 3: 只读 Electron 验收**

启动开发版，仅观察账号失效后的状态清空、备册确认阶段和同步进度出现顺序；不点击真实创建、绑定、删除、移动或视频写入按钮。截图统一保存到 `.codex-artifacts/`。

- [ ] **Step 4: 更新账本并提交**

按 I001、I002、I003 分别记录代码位置、自动化结果、Electron 截图和未验证真实 B 站副作用；仅提交本轮项目书、账本、计划、代码和测试文件，不加入 `pnpm-lock.yaml`、`pnpm-workspace.yaml`。
