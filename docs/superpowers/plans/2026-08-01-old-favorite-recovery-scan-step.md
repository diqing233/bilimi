# 恢复草稿默认扫描概览修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复未完成的整理草稿后默认显示扫描概览，并在恢复重载失败时保留可重试选择和明确错误，同时不改变所选视频重新整理直接进入归档预览的行为。

**Architecture:** 页面步骤只由 `ControlledFavoriteLedgerPanel` 协调。持久化全库工作区首次载入时停在扫描概览；标签补取运行或暂停时强制停在扫描概览；恢复决定成功重载后显式回到扫描概览。后台刷新继续保留用户手动选择的步骤，恢复重载失败只更新恢复弹窗错误，不清除现有草稿。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library

---

### Task 1: 固化恢复页面规则

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 修改持久化 preview 测试，使首次挂载和再次挂载都断言扫描概览为当前步骤，且不触发命令。**

```tsx
expect(screen.getByRole('button', { name: '扫描概览' })).toHaveAttribute('aria-current', 'step')
expect(screen.getByRole('heading', { name: '扫描概览' })).toBeInTheDocument()
expect(screen.queryByRole('region', { name: '归档预览' })).not.toBeInTheDocument()
```

- [ ] **Step 2: 增加标签补取 `running` 与 `paused` 的首次恢复测试，断言二者都停在扫描概览。**

- [ ] **Step 3: 增加 `continue-original` / `merge-latest` 成功重载测试，先手动进入归档预览，再选择恢复，断言最终返回扫描概览。**

- [ ] **Step 4: 扩展失败恢复测试，断言弹窗继续存在、按钮恢复可用，并显示“恢复整理草稿失败，请重试。”。**

- [ ] **Step 5: 运行红灯测试。**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: 新增/修改断言因当前默认进入归档预览且失败无提示而失败。

### Task 2: 最小修复步骤协调

**Files:**
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`

- [ ] **Step 1: 增加恢复失败状态，并在账号切换、打开恢复选择和恢复成功时清空。**

```tsx
const [recoveryDecisionError, setRecoveryDecisionError] = useState<string | null>(null)
```

- [ ] **Step 2: 首次持久化 `previewing` 工作区默认保留 `scan`；标签补取运行或暂停时强制使用 `scan`；后续后台刷新不覆盖当前步骤。**

```tsx
const tagEnrichmentActive = snapshot.tagEnrichment?.status === 'running' || snapshot.tagEnrichment?.status === 'paused'
if (snapshot.status === 'scanning' || recovery || tagEnrichmentActive) return 'scan'
if (snapshot.status !== 'previewing') return 'confirm'
return currentStep
```

- [ ] **Step 3: `continue-original` / `merge-latest` 重载成功后显式 `setStep('scan')`；重载返回空值时保留弹窗并设置可重试错误。**

```tsx
if (!restored || 'recovery' in restored) {
  setRecoveryDecisionError('恢复整理草稿失败，请重试。')
  return
}
setStep('scan')
```

- [ ] **Step 4: 在恢复弹窗内以 `role="alert"` 显示恢复错误。**

- [ ] **Step 5: 运行定向测试并保持绿色。**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: PASS。

### Task 3: 回归与真实开发版验收

**Files:**
- Verify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Verify: `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

- [ ] **Step 1: 运行面板与渲染隔离相关测试。**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

- [ ] **Step 2: 在正在运行的 Electron 开发版验证恢复草稿默认扫描概览、合并成功不残留按钮、手动进入归档预览仍有效。**

- [ ] **Step 3: 运行 `git diff --check`，审查最终补丁后建立本地提交，不 push。**
