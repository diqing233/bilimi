# Runtime Status Model Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简 DeepSeek 后台任务详情，并在转写详情与状态灯悬浮提示中显示真实模型和可信的 GPU 就绪状态。

**Architecture:** 在 `FloatingAssistantApp.tsx` 中增加纯格式化辅助函数，把展示规则与 React 状态拼装分开。转写状态继续使用现有 `GlobalStatusItem.detail` 作为后台任务详情和状态灯 tooltip 的唯一信息源，运行任务模型取队列快照，空闲模型取当前账户偏好，GPU 状态取任务实际设备或现有探测结果。

**Tech Stack:** React、TypeScript、Vitest

---

### Task 1: 锁定精简文本规则

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] **Step 1: Write the failing tests**

在 `FloatingAssistantApp.test.ts` 中为新的纯函数增加断言：DeepSeek 摘要只列已开启简称并将任务另起一段；转写模型行使用友好名称；CUDA 实际设备或匹配的可用 GPU 探测显示“GPU 已就绪”，CPU/不匹配探测不显示。

- [ ] **Step 2: Run tests to verify they fail**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Expected: FAIL，因为新的格式化函数尚未导出。

- [ ] **Step 3: Write the minimal implementation**

在 `FloatingAssistantApp.tsx` 中实现并导出：

```ts
formatDeepSeekRuntimeDetail(preferences, tasks, validatingConnection)
formatTranscriptionModelStatus(modelId, gpuReady)
```

DeepSeek 函数返回模型/开启功能行、`执行任务：` 和任务列表；转写函数复用现有模型显示名，并仅在传入可信 `gpuReady` 时追加 `GPU 已就绪`。

- [ ] **Step 4: Run the focused tests**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

Expected: PASS。

### Task 2: 接入运行状态并验证回归

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Test: `src/renderer/src/features/assistant/assistantGlobalStatusCenter.test.ts`

- [ ] **Step 1: Connect the DeepSeek status**

让活动 DeepSeek 状态使用 `formatDeepSeekRuntimeDetail`，删除重复标题与五段功能长说明；其他连接状态保持原逻辑。

- [ ] **Step 2: Connect the transcription status**

为 `globalTranscriptionStatus.detail` 的各状态增加模型行。运行任务优先读取 `runningItem.transcriptionModelId`；GPU 就绪条件为任务 `actualDevice/progress.actualDevice === 'cuda'`，或当前模型与 `transcriptionGpuProbe.modelId` 匹配且探测状态为 `available`。

- [ ] **Step 3: Run relevant regression tests**

Run: `node_modules\.bin\vitest.cmd run src/renderer/src/features/assistant/FloatingAssistantApp.test.ts src/renderer/src/features/assistant/assistantGlobalStatusCenter.test.ts`

Expected: 两个测试文件全部 PASS；如有既有警告，原样记录。

- [ ] **Step 4: Verify the development UI**

在正在运行的 Electron 开发版中检查全局提示下拉和转写状态灯 tooltip：DeepSeek 两段式文本正确，转写模型可见，GPU 未确认时无误报。

- [ ] **Step 5: Commit only scoped files**

只暂存本设计、计划、`FloatingAssistantApp.tsx` 和对应测试；明确排除两份 2026-07-30 旧藏文档。提交信息：`fix: clarify runtime model status`。不 push。

