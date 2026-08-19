# 札记转写模式标题行布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让札记“转写音频”卡片的`单 P · 多 P`与标题同列，并让说明文字恢复完整内容宽度。

**Architecture:** 保留`VideoNotesPanel.tsx`的语义、状态和按钮结构，仅在`styles.css`覆盖该主卡的局部布局：模式控件上移到标题行，只有标题为其预留宽度，说明不再保留右侧空区。用现有的静态 CSS 契约测试防止重新压缩说明或恢复重叠。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Electron/Vite。

---

### Task 1: 锁定标题行与完整说明的样式契约

**Files:**
- Modify: `src/renderer/src/styles.test.ts:828-841`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 写入失败断言**

  在现有`styles notes transcription modes as borderless toggles instead of a dropdown`测试中，将预期替换为：

  ```ts
  expectStyleSnippet('.video-notes__transcription-mode { position: absolute; top: 2px; right: 8px;')
  expectStyleSnippet('.video-notes__primary-action-card > .assistant-action-button > .assistant-action-button__label { padding-right: 104px; }')
  expectStyleSnippet('.video-notes__primary-action-card > .assistant-action-button > .assistant-action-button__description { padding-right: 4px; }')
  ```

- [x] **Step 2: 运行红灯测试**

  Run: `npm test -- src/renderer/src/styles.test.ts`

  Expected: 该测试因当前模式`top: 8px`、标题与说明共同`padding-right: 104px`而失败。

### Task 2: 最小 CSS 布局调整

**Files:**
- Modify: `src/renderer/src/styles.css:3053-3110`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 将控件放入标题行**

  ```css
  .video-notes__transcription-mode {
    top: 2px;
  }
  ```

- [x] **Step 2: 只为标题预留模式宽度**

  ```css
  .video-notes__primary-action-card > .assistant-action-button > .assistant-action-button__label {
    padding-right: 104px;
  }
  .video-notes__primary-action-card > .assistant-action-button > .assistant-action-button__description {
    padding-right: 4px;
  }
  ```

- [x] **Step 3: 运行绿灯测试**

  Run: `npm test -- src/renderer/src/styles.test.ts src/renderer/src/features/notes/VideoNotesPanel.test.tsx`

  Expected: 两个测试文件全部通过，既有模式切换与多 P 入口断言保持有效。

### Task 3: 真实界面与全量回归

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-19-multipart-transcription-selection-and-mode-appearance.md`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/superpowers/plans/2026-08-19-transcription-mode-title-row-layout.md`

- [x] **Step 1: Electron 开发版验收**

  在可识别的 B 站视频页打开札记，确认：`单 P · 多 P`与标题同行、说明未被压缩或遮挡；静止无边框；悬停/焦点仅当前小项显示边框；切换模式不创建任务。

- [x] **Step 2: 运行全量验证**

  Run: `npm test && npm run build && git diff --check`

  Expected: 全部测试与构建成功，差异无空白错误。

- [x] **Step 3: 回填验收并提交**

  回填 I005 的实际代码位置、自动化结果与 Electron 验收；仅暂存本主题账本、项目书、计划、`styles.css`、`styles.test.ts`，不暂存 3 个无关未跟踪账本，然后运行：

  ```powershell
  git commit -m "fix: align transcription modes with title"
  ```
