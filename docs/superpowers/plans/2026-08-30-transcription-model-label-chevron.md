# 转写模型推荐文案与箭头 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一转写模型选择器箭头外观，并仅为 `faster-whisper large-v3-turbo` 增加“（推荐）”显示。

**Architecture:** 复用 `TranscriptionModelSettings.tsx` 已有的标签与当前模型后缀生成链路；只将触发按钮中的文字箭头替换为现有 SVG chevron。依赖现有 `aria-expanded` CSS 旋转规则，不改下拉状态管理或模型业务流程。

**Tech Stack:** React、TypeScript、Vitest、CSS。

---

### Task 1: 为推荐标签和 SVG 箭头补回归覆盖

**Files:**
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`（若测试文件不存在则使用同目录现有转写模型测试文件）

- [x] **Step 1: 写失败测试**
  - 断言触发按钮和对应选项均包含 `faster-whisper large-v3-turbo（推荐）`。
  - 断言普通 `faster-whisper large-v3` 不包含“推荐”。
  - 断言触发按钮包含带 `viewBox="0 0 16 16"` 的 SVG chevron，且不再渲染文字 `⌄`。

- [x] **Step 2: 运行定向测试确认失败**

运行：`npm test -- --run src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

预期：推荐文案断言或 SVG 箭头断言失败，证明测试覆盖当前缺口。

### Task 2: 实现最小 UI 修改

**Files:**
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.tsx`
- Modify: `src/renderer/src/styles.css`（仅在现有箭头样式确有必要时调整尺寸）

- [x] **Step 1: 更新标签生成**
  - 将 `faster-whisper-large-v3-turbo` 的 `LABELS` 值改为 `faster-whisper large-v3-turbo（推荐）`。
  - 将普通 `faster-whisper-large-v3` 保持为无推荐后缀。
  - 保持 `currentSuffix()` 原样，使当前 turbo 模型显示为 `faster-whisper large-v3-turbo（推荐）（当前模型）`。

- [x] **Step 2: 替换箭头节点**
  - 用现有统一路径的 SVG 替换文字 `⌄`，保留 `assistant-settings__transcription-model-chevron` 类名、`aria-hidden` 和 `aria-expanded` 旋转选择器。
  - 不改变点击、键盘和 portal 菜单逻辑。

### Task 3: 验证并记录

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-30-transcription-model-label-chevron.md`

- [x] **Step 1: 运行定向测试、`npm run build`、`git diff --check`**
- [x] **Step 2: 在 Electron 开发版只读确认推荐文案和箭头外观/旋转，不点击安装、下载或删除**
- [x] **Step 3: 在账本 I001/I002 记录代码位置、测试结果、截图路径和未验证条件**
- [ ] **Step 4: 检查 diff 仅包含本轮文件并创建本地提交**

## R007 更正

R006 原计划误将普通 `faster-whisper large-v3` 设为推荐；按需求账本 R007，推荐对象改为 `faster-whisper large-v3-turbo`。R006 的原始计划文字保留在 Git 历史中，本轮实施以 R007 和项目书为准。
