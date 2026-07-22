# DeepSeek 反馈面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让旧藏归档预览中的所有 DeepSeek 任务反馈都以全宽、可理解且状态正确的面板显示。

**Architecture:** `OldFavoriteArchivePreviewStep` 将主进程反馈标准化为运行、失败、完成三种视图状态，再交给一个局部反馈组件渲染。CSS 只让该反馈组件承担全宽进度和换行，不改 DeepSeek 服务、批次、取消或重试的业务逻辑。

**Tech Stack:** React、TypeScript、Vitest、现有 `OldFavoriteWorkspaceDeepSeekFeedback` 状态与 CSS。

---

### Task 1: 为 DeepSeek 反馈状态建立可测试的展示模型

**Files:**
- Create: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts`
- Create: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] **Step 1: 写入失败测试，覆盖运行、取消中、失败、重试完成与成功**

为模型测试输入真实 feedback 形状并断言：运行态 action 为 `cancel`；取消请求 action 为 `cancelling`；有 failures 的结束态 action 为 `retry`；无 failures 的结束态 action 为 `none`。失败摘要必须保留 batch 索引与影响视频数。

```ts
expect(toDeepSeekFeedbackView({ status: 'running', message: '整理中', progress }, false)).toMatchObject({ kind: 'running', action: 'cancel' })
expect(toDeepSeekFeedbackView({ status: 'failed', message: '失败', failures: [failure] }, false)).toMatchObject({ kind: 'failed', action: 'retry' })
```

组件测试断言运行时有“取消 DeepSeek 整理”，失败时有“重试失败批次”，完成时两者都不存在，并且所有状态都有 `aria-label="DeepSeek 整理反馈"`。

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

Expected: FAIL，展示模型及统一反馈容器不存在。

- [ ] **Step 3: 最小实现统一反馈组件**

在模型中导出：

```ts
export type DeepSeekFeedbackView = {
  kind: 'running' | 'failed' | 'completed'
  action: 'cancel' | 'cancelling' | 'retry' | 'none'
  summary: string
  progress?: { completedChunks: number; totalChunks: number; completedVideos: number; totalVideos: number; value: number }
  failures: Array<{ chunkIndex: number; affectedVideoCount: number; message: string }>
}
```

在 `OldFavoriteArchivePreviewStep` 用一个 `favorite-ledger-panel__deepseek-feedback` 容器呈现模型结果。复用现有 `onCancelDeepSeek` 和 `onRetryFailedDeepSeekChunks`，不改变 callback 签名。失败详情继续调用 `deepSeekFailureMessage`，但放在可展开区域。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

Expected: PASS，按钮严格随任务状态切换。

### Task 2: 修复全宽反馈与进度布局

**Files:**
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`
- Test: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

- [ ] **Step 1: 写入失败样式与 DOM 契约**

在归档预览测试中断言反馈容器、进度容器和轨道都带稳定 class；在 `styles.test.ts` 断言：

```ts
expectStyleSnippet('.favorite-ledger-panel__deepseek-feedback { width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: 6px;')
expectStyleSnippet('.favorite-ledger-panel__deepseek-feedback-copy { min-width: 0; overflow-wrap: anywhere; white-space: normal;')
expectStyleSnippet('.favorite-ledger-panel__deepseek-feedback .favorite-ledger-panel__deepseek-archive-progress-track { width: 100%; box-sizing: border-box;')
```

- [ ] **Step 2: 运行失败测试确认 RED**

Run: `npm test -- --run src/renderer/src/styles.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

Expected: FAIL，复合反馈仍使用 `deepseek-archive-status` 的紧凑单行规则。

- [ ] **Step 3: 最小实现全宽 CSS**

新增 `.favorite-ledger-panel__deepseek-feedback` 的全宽 grid 规则；将摘要文本放入 `.favorite-ledger-panel__deepseek-feedback-copy`，允许换行。进度轨在反馈容器内使用 `width: 100%; box-sizing: border-box`。删除或停止使用 `.favorite-ledger-panel__deepseek-archive-status` 的 `white-space: nowrap`、`text-overflow: ellipsis` 组合，避免它承载包含进度与操作的复合内容。保留工具卡、全宽 DeepSeek 区块和改动记录虚线。

- [ ] **Step 4: 运行测试确认 GREEN**

Run: `npm test -- --run src/renderer/src/styles.test.ts src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`

Expected: PASS，样式和 DOM 都保证反馈面板与进度轨全宽且可换行。

### Task 3: 回归 DeepSeek 交互并提交

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx`
- Modify: `src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts`
- Modify: `src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts`
- Modify: `src/renderer/src/styles.css`
- Modify: `src/renderer/src/styles.test.ts`

- [ ] **Step 1: 运行组件与主进程定向回归**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/useOldFavoriteWorkspace.test.tsx electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: PASS，取消与重试仍向既有主进程命令路由，任务批次行为未改变。

- [ ] **Step 2: 运行构建并提交**

Run: `npm run build`

Expected: exit 0.

```bash
git add src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.tsx src/renderer/src/features/assistant/OldFavoriteArchivePreviewStep.test.tsx src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.ts src/renderer/src/features/assistant/oldFavoriteDeepSeekFeedbackModel.test.ts src/renderer/src/styles.css src/renderer/src/styles.test.ts
git commit -m "fix: unify old favorite deepseek feedback"
```
