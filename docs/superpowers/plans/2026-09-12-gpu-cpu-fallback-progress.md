# GPU 回退 CPU 转写状态与进度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 GPU 回退 CPU 的转写状态显示模型和简洁运行时信息，并移除 68% 假进度。

**Architecture:** 保持主进程实际转写与回退策略不变，只在共享队列数据已有字段上整理 UI 文案，并让渲染器把音频推理阶段标记为不定进度。详细回退原因继续留在队列数据中，不直接占用活动卡片。

**Tech Stack:** Electron main/preload 数据契约、React、TypeScript、Vitest、Testing Library。

---

### Task 1: 运行状态文案红灯测试

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`

- [ ] 添加 CPU 回退活动卡片测试：显示 `faster-whisper large-v3`、`CPU（int8）`、简短回退状态，不显示长 `runtimeFallbackMessage`。
- [ ] 添加全局状态测试：活动 CPU 回退详情保留模型名并使用简洁文案。
- [ ] 运行两个聚焦测试文件，确认新断言因现有文案缺失/过长而失败。

### Task 2: 进度格式化红灯测试

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

- [ ] 添加活动分段测试，确认文本为 `正在转写第 1 / 1 段`，且进度元素没有确定的 `value` 属性。
- [ ] 保留/补充后续阶段测试，确认合并或生成阶段仍显示确定百分比。
- [ ] 运行聚焦测试，确认现有 `68%` 行为使新断言失败。

### Task 3: 实现简洁运行时状态与不定进度

**Files:**
- Modify: `src/renderer/src/features/notes/VideoNotesPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [ ] 增加模型标签和运行时文案格式化，活动项显示模型、实际设备和计算类型；CPU 回退只显示简短状态。
- [ ] 扩展 `FormattedProgress` 以表达不定进度；分段转写渲染 `<progress max={100}>` 而不传 `value`，保留段号标签。
- [ ] 全局状态详情加入实际 CPU 回退摘要，避免只显示 GPU 探测默认状态。

### Task 4: 回归验证

**Files:**
- No additional production files unless a scoped test exposes a regression.

- [ ] 运行相关 renderer、queue、provider 和 transcription service 测试。
- [ ] 运行 `npm test`、`npm run build`、`git diff --check`。
- [ ] 运行开发版/预览版关键转写路径，记录界面验收结果；不安装 NSIS 包，除非另行授权。
- [ ] 更新需求账本每项的代码位置、测试和界面证据，确认无无关文件。
