# 批阅参数并列切换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将批阅`赐 / 表`右端的两个参数下拉改为和札记`单 P · 多 P`相同的并列小切换，同时保留既有设置持久化和所有实际动作边界。

**Architecture:** `MemorialPanel`继续持有批阅动作主卡和`onPreferenceChange`回调，只把两个原生`select`替换成四个无副作用的按钮。`styles.css`为参数组提供与札记模式一致的无常驻边框、悬停/焦点细边框、选中颜色和短下划线；不共享会让札记定位规则泄漏到批阅卡的绝对布局选择器。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Electron/Vite。

---

### Task 1: 先锁定参数切换的无副作用契约

**Files:**
- Modify: `src/renderer/src/features/assistant/MemorialPanel.test.tsx:351-408`
- Test: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`

- [x] **Step 1: 写入失败测试**

  将原有原生组合框断言改成：两个带名称的参数组分别包含`一枚 / 两枚`和`随机 / 选择`按钮；没有`combobox`；初始选择项具有`aria-pressed="true"`和 R004 精确`title`；点击`两枚`、`选择`后只调用：

  ```ts
  expect(onPreferenceChange).toHaveBeenCalledWith({ defaultCoinCount: 2 })
  expect(onPreferenceChange).toHaveBeenCalledWith({ commentSubmitMode: 'choose' })
  expect(onAction).not.toHaveBeenCalled()
  ```

- [x] **Step 2: 运行红灯**

  Run: `npm test -- src/renderer/src/features/assistant/MemorialPanel.test.tsx`

  Expected: 现有`select`不能满足按钮、无组合框和`aria-pressed`断言，且测试明确因旧 UI 失败。

### Task 2: 最小替换参数控件与样式

**Files:**
- Modify: `src/renderer/src/features/assistant/MemorialPanel.tsx:299-345`
- Modify: `src/renderer/src/styles.css:2657-2738`
- Modify: `src/renderer/src/styles.test.ts`
- Test: `src/renderer/src/features/assistant/MemorialPanel.test.tsx`, `src/renderer/src/styles.test.ts`

- [x] **Step 1: 以四个按钮替换两个下拉**

  保留`stopActionEvent`，以两个`role="group"`参数组包裹：

  ```tsx
  <button type="button" aria-pressed={defaultCoinCount === 1} title={COIN_SETTING_TITLES[1]} onClick={() => onPreferenceChange?.({ defaultCoinCount: 1 })}>一枚</button>
  <span aria-hidden="true">·</span>
  <button type="button" aria-pressed={defaultCoinCount === 2} title={COIN_SETTING_TITLES[2]} onClick={() => onPreferenceChange?.({ defaultCoinCount: 2 })}>两枚</button>
  ```

  对`随机 / 选择`应用同一结构、`commentSubmitMode`和对应提示。按钮必须由包裹层阻止点击、按下和键盘事件冒泡，不修改大卡`onClick`。

- [x] **Step 2: 添加局部批阅参数样式**

  参数组使用能容纳两个中文选项的一行宽度；每个小项采用透明背景/边框、选中态颜色与短下划线，`hover`和`focus-visible`才显示`1px`细边框，明确取消阴影和位移。删除旧`select`的固定宽度、左分隔线和原生外观依赖，不影响札记模式选择器。

- [x] **Step 3: 添加样式契约并运行绿灯**

  在`styles.test.ts`断言批阅参数组和选项拥有透明常态、选中态、悬停/焦点细边框、无阴影/位移；运行：

  ```powershell
  npm test -- src/renderer/src/features/assistant/MemorialPanel.test.tsx src/renderer/src/styles.test.ts
  ```

  Expected: 两个文件全部通过，参数切换仍不调用大卡动作。

### Task 3: 文档、Electron 与完整回归

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-19-multipart-transcription-selection-and-mode-appearance.md`
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/superpowers/plans/2026-08-19-review-action-parameter-toggles.md`

- [x] **Step 1: Electron 开发版验收**

  在可识别视频的批阅页确认：`一枚 · 两枚`、`随机 · 选择`位于原卡右端且一行完整显示；常态无边框，键盘焦点只有当前小项细边框；切换后不显示批阅执行中、不会触发 B 站动作；大卡文字、图标、禁用状态和批阅区域其余控件不变。

- [x] **Step 2: 运行全量验证**

  Run: `npm test && npm run build && git diff --check`

  Expected: 全量测试、构建和差异检查均成功。

- [x] **Step 3: 回填账本并提交**

  回填 I006 的代码位置、测试和 Electron 证据；只暂存本主题账本、项目书、计划及实际修改的组件/测试/样式文件，排除 3 个无关未跟踪账本，再运行：

  ```powershell
  git commit -m "feat: unify review action parameter toggles"
  ```
