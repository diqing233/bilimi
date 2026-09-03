# 小咪启动默认关闭 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 默认不自动显示小咪；关闭宠物持久抑制下一次自动启动，显式唤醒恢复后续自动启动，并保留设置开关。

**Architecture:** 在共享 `AssistantPreferences` 与主进程 store 中新增布尔偏好 `autoShowPetOnStartup`，缺失值规范化为 `false`。主进程只在该偏好为 `true` 时让首页真实收束触发自动小咪 gate；用户关闭宠物通过既有偏好 patch 写入 `false`，显式唤醒默认写入 `true` 后唤醒。网页全屏仅使用主进程内存中的一个 `petHiddenForVideoFullscreen` 标记：只有真实可见的小咪被临时隐藏后才置位，退出全屏只能消费该标记；不使用 sessionId、额外全屏 IPC 或生命周期状态机。

**Tech Stack:** Electron 42、React 19、TypeScript、electron-store、Vitest。

---

### Task 1: 需求与项目书约束

**Files:**
- Create: `docs/requirement-ledgers/2026-09-03-pet-startup-default-off.md`
- Create: `docs/superpowers/plans/2026-09-03-pet-startup-default-off.md`
- Modify: `docs/项目功能项目书.md`

- [x] **Step 1: 记录 R001-R005 原文与 I001-I003 索引**

保留“默认关闭”“关闭宠物是否持久化”“增加按钮”“开始”的完整原文；索引明确新偏好仅控制后续启动自动显示。

- [x] **Step 2: 写入项目书边界**

在启动输入优先章节增加：`autoShowPetOnStartup` 缺失时为 `false`；该开关只阻止 `scheduleAutomaticFloatingSealWake()`；显式唤醒、B 站加载和主窗口启动仍保持现有语义。

### Task 2: 偏好与自动 gate 的 RED → GREEN

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `electron/main/store.ts`
- Test: `electron/main/store.test.ts`
- Modify: `electron/main/index.ts`
- Test: `electron/main/index.mainWindowPetStartup.test.ts`

- [x] **Step 1: 写失败回归测试**

在 `store.test.ts` 断言：缺失 `autoShowPetOnStartup` 时 `loadAssistantPreferences()` 返回 `false`，而持久化 `true` 被保留；在启动契约测试中断言 `maybeScheduleAutomaticFloatingSealWake()` 先读取该偏好并在 `false` 时返回。

- [x] **Step 2: 运行 RED**

Run: `npm test -- --run electron/main/store.test.ts electron/main/index.mainWindowPetStartup.test.ts`

Expected: 新断言失败，提示缺少 `autoShowPetOnStartup` 或自动 gate 未受其控制。

- [x] **Step 3: 实现最小持久化与 gate**

在共享类型、`AssistantPreferences`、默认值、load/save/patch 和 renderer 标准化中新增 `autoShowPetOnStartup`。在启动阶段快照该偏好，并在 `maybeScheduleAutomaticFloatingSealWake()` 开头加入：

```ts
if (!automaticPetStartupEnabledForThisLaunch) return
```

显式 `wakeAssistantPetWindow()` 默认持久写入 `true`，`closeAssistantPetWindow()` 默认持久写入 `false`；内部临时收起/恢复传入 `persistStartupPreference: false`，不改变 WebView 加载逻辑。

- [x] **Step 4: 运行 GREEN**

Run: `npm test -- --run electron/main/store.test.ts electron/main/index.mainWindowPetStartup.test.ts`

Expected: PASS，且显式唤醒相关断言不回归。

### Task 3: 宠物设置开关与 renderer 规范化 RED → GREEN

**Files:**
- Modify: `src/renderer/src/features/state/assistantState.ts`
- Test: `src/renderer/src/features/state/assistantState.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Test: `src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

- [x] **Step 1: 写失败回归测试**

断言 `createInitialAssistantPreferences()` 在缺失值时给出 `autoShowPetOnStartup: false`、显式 `true` 被保留；渲染测试要求“启动时自动显示小咪”复选框初始未勾选，切换后经现有 patch 入口提交 `{ autoShowPetOnStartup: true }`。

- [x] **Step 2: 运行 RED**

Run: `npm test -- --run src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

Expected: FAIL，缺少偏好字段和设置控件。

- [x] **Step 3: 实现最小设置控件**

在“宠物设置”中、全屏自动收起选项附近使用现有 `SettingsPreferenceCheckbox`：

```tsx
<SettingsPreferenceCheckbox
  checked={preferences.autoShowPetOnStartup}
  onCommit={(checked) => actions.current.persistPreferencePatch({ autoShowPetOnStartup: checked })}
/>
<span>启动时自动显示小咪</span>
```

通过既有偏好 patch 管线保存；“唤醒宠物”与“关闭宠物”按钮继续走显式持久化生命周期。全屏流程将在下一任务改为请求主进程原子地临时隐藏/恢复，不允许 renderer 直接唤醒一个本不存在的小咪。

- [x] **Step 4: 运行 GREEN**

Run: `npm test -- --run src/renderer/src/features/state/assistantState.test.ts src/renderer/src/features/assistant/FloatingAssistantApp.renderIsolation.test.tsx`

Expected: PASS。

### Task 4: 最小全屏防唤醒（RED → GREEN）

**Files:**
- Modify: `src/renderer/src/App.tsx:999-1052`
- Test: `src/renderer/src/App.test.tsx:7233-7285`
- Modify: `electron/main/index.ts` 的宠物关闭/唤醒与既有 IPC
- Test: `electron/main/index.mainWindowPetStartup.test.ts`

- [x] **Step 1: 写失败回归测试**

在 `App.test.tsx` 写入两种状态：默认关闭时进入、计时并退出网页全屏后不得调用 `wakeAssistantPet`；小咪尚未被成功临时关闭时，退出全屏不得请求恢复。保留“此前已可见”分支，断言计时后通过既有关闭入口临时关闭，且只有关闭回执为真时再通过既有唤醒入口恢复。`index.mainWindowPetStartup.test.ts` 断言主进程以 `petHiddenForVideoFullscreen` 标记保护恢复，关闭普通小咪时清理标记。

```ts
let petHiddenForVideoFullscreen = false
```

- [x] **Step 2: 运行 RED**

Run: `npm test -- --run src/renderer/src/App.test.tsx electron/main/index.mainWindowPetStartup.test.ts`

Observed: `2026-09-04` 运行目标用例后，两个 renderer 断言因仍走 session 专用桥接而未调用既有 close/wake 入口，主进程契约因缺少 `petHiddenForVideoFullscreen` 失败。

- [x] **Step 3: 写入最小主进程状态**

在 `index.ts` 添加仅在主进程内存中存在的 `petHiddenForVideoFullscreen` 标记。临时隐藏复用既有 `assistant-pet:close`：只有主窗口 renderer 发出的 `{ temporarilyForVideoFullscreen: true }`、当前小咪窗口存在、未销毁且 `isVisible()` 时，才设置标记并隐藏；尚未可见时取消待创建唤醒后返回 `false`。任何普通关闭清除标记。恢复复用既有 `assistant-pet:wake`：只有主窗口 renderer 发出的 `{ restoreAfterVideoFullscreen: true }` 且标记为 `true` 时才清除标记并唤醒，其他情况返回 `false`。两个全屏选项均不写启动偏好。renderer 保持局部“已成功临时隐藏”标记，只有 close 回执为真才在退出全屏调用 wake；异步 close 回执晚于退出时，若已离开全屏则立即恢复一次。

```ts
closeAssistantPetWindow({ temporarilyForVideoFullscreen: true })
wakeAssistantPetWindow({ restoreAfterVideoFullscreen: true })
```

不新增 preload 或 `BilimiDesktopApi` 全屏方法；既有关闭/唤醒入口分别增加明确的主进程内部临时选项。删除 sessionId、额外全屏 IPC 和生命周期文件。保留原有延时、提示文案、可见小咪全屏隐藏与不持久化语义。

- [x] **Step 4: 运行 GREEN**

Run: `npm test -- --run src/renderer/src/App.test.tsx electron/main/index.mainWindowPetStartup.test.ts`

Observed: `2026-09-04` 目标用例通过；默认关闭全屏往返没有唤醒，未成功隐藏时不请求恢复，已显示小咪仍按原延时隐藏和恢复。

### Task 5: 构建、隔离启动与账本回填

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-03-pet-startup-default-off.md`

- [x] **Step 1: 运行定向与完整验证**

Run: `npm run build`

Run: `npm test`

Observed: `2026-09-04` 定向测试为 8 文件 380 项通过；`npm run build` 退出码 0；`npm test` 为 246 文件 4293 项通过。

- [x] **Step 2: 使用隔离 profile 重启开发版**

Run: `BILIMI_STARTUP_DIAGNOSTICS=1` 和独立 `BILIMI_TEST_USER_DATA` 启动 `npm run dev`，观察 `main-window:interactive-ready` 与 `home-webview:load-timeout` 后不存在 `pet-wake:scheduled`、`pet-window:create` 或原生小咪阶段。`2026-09-04` 证据：`.codex-artifacts/pet-default-off-fullscreen-20260904.log`。该隔离 profile 停在 Windows 网络权限页；仅验证默认关闭启动路径，不替代真实 B 站视频、全屏或鼠标手感验收。

- [x] **Step 3: 回填逐项证据并提交**

更新 I001-I003 的代码位置、测试、实机结果与未验证条件；运行 `git diff --check`、`git status --short`、`git diff --stat`，仅提交本轮文件：

```text
feat: disable automatic pet startup by default
```
