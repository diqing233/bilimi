# 批阅动作卡标题行参数与小切换项视觉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让批阅的`投币厚赏`、`拟奏短评`与札记`转写音频`三组小切换项统一为“选中只变蓝、悬停/焦点才有细边框”，并让批阅参数仅占标题行右端、说明文字恢复完整宽度。

**Architecture:** 不改变任何 React 状态、事件处理或副作用。`MemorialPanel`已经把参数组作为动作卡的同级节点，因此只把带参数批阅卡从“主按钮 + 右侧 88px 网格列”改为与札记相同的相对容器 + 标题行右上绝对定位；动作卡标题为参数预留`104px`，说明行不预留参数宽度。三组`aria-pressed`小按钮沿用现有蓝色 token，移除选中下划线。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Electron/Vite。

---

### Task 1: 将已确认视觉和边界写入项目书与本轮计划

**Files:**
- Modify: `docs/项目功能项目书.md:59-60,93`
- Modify: `docs/requirement-ledgers/2026-08-19-multipart-transcription-selection-and-mode-appearance.md:R016-R017/I007-I008`
- Create: `docs/superpowers/plans/2026-08-20-review-action-card-layout-and-toggle-state.md`

- [x] **Step 1: 记录已确认设计**

  项目书明确三组小项的统一规则：静止无框、选中只显示蓝色文字、悬停或键盘焦点才显示细边框；批阅两张卡的参数绝对定位在标题第一行右侧，标题预留约`104px`，说明文字使用完整可用宽度。

- [x] **Step 2: 锁定不改边界**

  保持`单 P / 多 P`临时模式、`defaultCoinCount`、`commentSubmitMode`、悬浮提示、中点分隔、事件阻断以及`赐 / 表`大卡实际副作用的既有行为；不触发转写、DeepSeek、档案或 B 站写入。

### Task 2: 先用样式契约测试锁定缺陷（RED）

**Files:**
- Modify: `src/renderer/src/styles.test.ts:668-702,830-845`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 写入两条失败断言**

  将批阅样式断言改为期待以下规则，且断言三组选择态只含蓝色、不含`text-decoration`：

  ```ts
  expectStyleSnippet(
    '.memorial-panel__action-card--with-setting { position: relative; display: block;'
  )
  expectStyleSnippet(
    '.memorial-panel__action-setting { position: absolute; top: 2px; right: 8px; z-index: 1;'
  )
  expectStyleSnippet(
    '.memorial-panel__action-card--with-setting > .assistant-action-button > .assistant-action-button__label { padding-right: 104px; }'
  )
  expectStyleSnippet(
    '.memorial-panel__action-card--with-setting > .assistant-action-button > .assistant-action-button__description { padding-right: 4px; }'
  )
  expect(normalizedStyles).not.toContain(
    '.memorial-panel__action-setting-option[aria-pressed="true"] { color: var(--porcelain-primary); text-decoration:'
  )
  expect(normalizedStyles).not.toContain(
    '.video-notes__transcription-mode-option[aria-pressed="true"] { color: var(--porcelain-primary); text-decoration:'
  )
  ```

- [x] **Step 2: 运行并确认红灯**

  Run: `npm test -- src/renderer/src/styles.test.ts`

  实际：FAIL；64 项中 2 项失败，分别暴露批阅卡固定 `88px` 网格右栏和两组选择态下划线，证明测试先锁定了本轮缺陷。

### Task 3: 最小 CSS 修复（GREEN）

**Files:**
- Modify: `src/renderer/src/styles.css:2656-2759,3071-3134`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 将批阅参数改为标题行绝对定位**

  用以下结构替换固定右列，并保留现有卡片、参数组和小项的颜色、边框、hover/focus、禁用及事件覆盖规则：

  ```css
  .memorial-panel__action-card--with-setting {
    position: relative;
    display: block;
  }
  .memorial-panel__action-setting {
    position: absolute;
    top: 2px;
    right: 8px;
    z-index: 1;
    width: 88px;
    max-width: 88px;
  }
  .memorial-panel__action-card--with-setting > .assistant-action-button > .assistant-action-button__label {
    padding-right: 104px;
  }
  .memorial-panel__action-card--with-setting > .assistant-action-button > .assistant-action-button__description {
    padding-right: 4px;
  }
  ```

- [x] **Step 2: 移除三组已选项的下划线**

  保留`color: var(--porcelain-primary)`，从`.memorial-panel__action-setting-option[aria-pressed="true"]`和`.video-notes__transcription-mode-option[aria-pressed="true"]`移除`text-decoration`与`text-underline-offset`；不改变小项的悬停/焦点边框。

- [x] **Step 3: 运行绿色验证**

  Run: `npm test -- src/renderer/src/styles.test.ts`

  实际：PASS；`src/renderer/src/styles.test.ts` 64/64 通过，新定位规则存在，三组选择态均无下划线。

### Task 4: 回归业务交互、构建与真实界面验收

**Files:**
- Test: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`
- Test: `src/renderer/src/features/notes/VideoNotesPanel.test.tsx`
- Test: `src/renderer/src/styles.test.ts`

- [x] **Step 1: 运行受保护交互回归**

  Run: `npm test -- src/renderer/src/features/assistant/MemorialPanel.test.tsx src/renderer/src/features/notes/VideoNotesPanel.test.tsx src/renderer/src/styles.test.ts`

  实际：PASS；`MemorialPanel.test.tsx`、`VideoNotesPanel.test.tsx`、`styles.test.ts` 共 129 项通过；参数只保存偏好不触发大卡动作，单 P/多 P 只切模式且多 P 在主卡点击前不读取清单。

- [x] **Step 2: 构建**

  Run: `npm run build`

  实际：PASS；main、preload、renderer 均完成，没有 TypeScript 或 CSS 构建错误。

- [x] **Step 3: Electron 开发版人工验收**

  实际：通过可见界面核对批阅两张卡的参数位于标题第一行右侧、说明行恢复完整宽度；`一枚/两枚`、`随机/选择`和札记`单 P/多 P`静止无边框、选中仅蓝字无下划线，悬停/点击时显示小项细边框。点击`两枚`后已恢复`一枚`，未点击大卡，未产生投币、短评、转写、DeepSeek、档案或 B 站副作用。当前开发页一度为未识别视频，未伪造远端验收。

- [x] **Step 4: 原文逐项复核与分离提交**

  实际：已按 R016、R017 逐项回读原文和索引，实施记录写回账本；已执行全量 `npm test -- --reporter=dot`（236 个测试文件、3907 项通过）、`npm run build`、`git diff --check`。已分离暂存本计划、对应账本、项目书的三条本轮规则、`styles.css` 与 `styles.test.ts`；收藏库排序/本地登记等未提交主题保持原状。
