# DeepSeek 草稿恢复与范围弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点击“整理收藏”时自动按当前事实恢复可恢复草稿，使 DeepSeek 可正常执行；将范围菜单改为带正确上下文默认值的确认弹窗。

**Architecture:** 复用主进程已有的 `merge-latest` 恢复能力，而不修改恢复基线、分类优先级或 B 站执行链路。渲染进程在“整理收藏”入口自动选择 `merge-latest`（无变更时使用 `continue-original`），并在归档预览用本地、一次性的弹窗状态承载 DeepSeek 模式与批次范围。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library。

---

## 账本覆盖与范围

- R001、R002：根因已核实为旧恢复决策指纹，计划仅修复渲染入口闭环；不触发新的 DeepSeek 或 B 站副作用。
- R003：`整理收藏` 自动恢复可恢复预览草稿，恢复后打开当前草稿；不出现恢复选择弹窗；保留 `rescan`/结果对账等不属于可恢复预览草稿的保护流程。
- R004、R005、R006：移除常驻范围菜单，仅保留 `DeepSeek 整理` 按钮；弹窗默认 `low-confidence-and-unclassified`，在当前批次打开默认 `current`，本轮总览打开默认 `all`。
- 明确不改：DeepSeek 三种参数语义、单批次时隐藏批次范围、DeepSeek 运行/取消/进度、手动分类优先级、扫描和 B 站执行时机。

### Task 1: 自动恢复入口的回归测试（R001–R003）

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: 写出失败测试**

```tsx
it('automatically merges a recoverable preview draft when organizing favorites', async () => {
  // recoveryChoices: ['view', 'continue-original', 'merge-latest', 'rescan']
  // click 整理收藏
  // expect command select-recovery-decision choice merge-latest
  // expect no 检测到未完成的整理草稿 dialog
  // expect 归档预览 step after refreshed preview
})

it('continues an unchanged recoverable preview draft without showing recovery choices', async () => {
  // recoveryChoices: ['view', 'continue-original', 'rescan']
  // click 整理收藏
  // expect command choice continue-original
})
```

- [x] **Step 2: 运行失败测试并确认失败原因是仍弹出恢复选择**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "automatically merges|continues an unchanged"`

Expected: FAIL，断言缺少自动 `select-recovery-decision` 调用或仍显示恢复弹窗。

### Task 2: 在整理入口自动采用当前恢复结果（R001–R003）

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx:403-492`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 1: 实现最小恢复选择器**

```tsx
const recoveryChoice = summary.recoveryChoices.includes('merge-latest')
  ? 'merge-latest'
  : summary.recoveryChoices.includes('continue-original')
    ? 'continue-original'
    : null
if (recoveryChoice) {
  await restoreRecoveryDraft(summary, recoveryChoice, request guards)
  return
}
```

`restoreRecoveryDraft` 必须使用摘要中的 revision、调用既有 IPC 命令、刷新权威快照，并把 `previewing` 草稿打开到 `preview` 步骤。恢复失败只在原“整理收藏”入口展示原有失败反馈，不能让 DeepSeek 服务、B 站或扫描被调用。

- [x] **Step 2: 运行 Task 1 测试并确认通过**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx -t "automatically merges|continues an unchanged"`

Expected: PASS。

### Task 3: DeepSeek 范围弹窗的失败测试（R004–R006）

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [x] **Step 1: 写出失败测试**

```tsx
it('opens DeepSeek range dialog with current-batch defaults', () => {
  // current view: click DeepSeek 整理
  // expect dialog radio low-confidence... checked and 当前批次 checked
  // cancel -> callback not called
})

it('defaults the range dialog to all batches from the whole-run overview', () => {
  // viewScope='all': click DeepSeek 整理
  // expect 本轮所有批次 checked
  // confirm -> callback(low-confidence-and-unclassified, 'all')
})
```

- [x] **Step 2: 运行失败测试并确认缺少弹窗与上下文默认项**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx -t "range dialog"`

Expected: FAIL，找不到对话框或默认选中项错误。

### Task 4: 以无持久化弹窗替换常驻范围菜单（R004–R006）

**Files:**

- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx:1-8,67-71,348-351,516-550`
- Modify: `src/renderer/src/styles.css:5355-5443,8207-8223`（仅在现有样式不足以表达语义单选组时）
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [x] **Step 1: 实现最小弹窗状态与提交路径**

```tsx
const openDeepSeekDialog = () => {
  setDeepSeekMode('low-confidence-and-unclassified')
  setDeepSeekScope(viewScope === 'all' ? 'all' : 'current')
  setDeepSeekDialogOpen(true)
}

const confirmDeepSeekDialog = () => {
  setDeepSeekDialogOpen(false)
  onOrganizeWithDeepSeek(deepSeekMode, hasMultipleSegments ? deepSeekScope : 'current')
}
```

用已有 `OldFavoriteModal`、`fieldset`/`legend` 和带文字的原生 `radio` 构成选项；单批次时不渲染批次范围。取消与关闭只关闭弹窗、不修改草稿也不调用 DeepSeek。

- [x] **Step 2: 运行 Task 3 测试并确认通过**

Run: `npm test -- src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx -t "range dialog"`

Expected: PASS。

### Task 5: 跨页面回归、界面验收与账本证据

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-15-deepseek-recovery-decision-stale.md`
- Verify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Verify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Verify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

- [x] **Step 1: 运行定向回归**

Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx electron/main/oldFavoriteWorkspaceCoordinator.test.ts`

Expected: PASS，证明恢复合并、手动分类保留、DeepSeek 参数映射和弹窗交互未回归。

- [ ] **Step 2: 在 Electron 开发版验收**

按两条入口分别验证：当前批次归档预览打开 DeepSeek 弹窗默认“当前批次”；本轮总览打开时默认“本轮所有批次”；取消不启动请求；确认才启动；旧恢复决策在点击“整理收藏”后不再阻止 DeepSeek。

- [x] **Step 3: 逐项更新账本索引**

记录每条 I001–I004 的代码位置、定向测试结果和实际界面验收；任何无法执行的 Electron 验收必须如实标记，不得以自动测试代替。

- [ ] **Step 4: 最终检查和单次本地提交**

Run: `git diff --check; git status --short; git diff --stat`

Expected: 仅本轮代码、测试、计划和账本将被暂存。明确排除 `docs/requirement-ledgers/2026-08-15-local-only-deletion-binding-state-persistence.md`。

## 回退记录（2026-08-15）

用户在 R007、R008 中指出：本计划的自动恢复实现扩大到了关闭整理后的既有草稿／增量路径，超出仅修复 DeepSeek 旧决策过期的范围。产品代码与测试已恢复为 `a4d31986^`，本计划不得再被视作已执行；后续必须重新讨论并将触发条件限定在 DeepSeek 问题内。
