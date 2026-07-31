# 备册、宠物唤醒与收藏库入口修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除备册无变化时的同步配置重写，让宠物冷唤醒不抢焦且不阻塞侧栏，并保证小咪收藏库入口恢复 bilimi 后可靠展开收藏库。

**Architecture:** 三条路径分别建立小型可测试边界：备册保存决策留在 App 状态协调层；收藏库入口复用主窗口运行时就绪信号；宠物冷启动用单次异步调度状态机合并重复请求。保留真正关闭宠物、首次建册串行安全和现有收藏整理/DeepSeek 行为。

**Tech Stack:** Electron、React 19、TypeScript、Vitest、Testing Library。

---

### Task 1: 备册无变化快速路径

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] 写红灯测试：远端结果与当前 `favoriteLedgers` 相同，不调用 `patchPreferences`；有变化只调用一次。
- [ ] 运行 `node_modules\.bin\vitest.cmd run src/renderer/src/App.test.tsx`，确认因无变化仍保存而失败。
- [ ] 最小实现 ledgers 等价判断，结果相同时只刷新本地状态，不写 electron-store。
- [ ] 写红灯测试：备册按钮执行中禁用，连续点击只触发一次并只打开一次 B 站收藏页。
- [ ] 最小实现按钮本地 in-flight 状态，并移除 Floating Assistant 成功后的重复 snapshot 请求。
- [ ] 重跑 App、ControlledFavoriteLedgerPanel、FloatingAssistantApp 相关测试。

### Task 2: 小咪收藏库入口等待运行时就绪

**Files:**
- Modify: `electron/main/favoriteLibraryEntryFlow.ts`
- Modify: `electron/main/favoriteLibraryEntryFlow.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] 写红灯测试：来自浮窗的 `reveal` 在 `did-finish-load` 后、运行时 ready 前不得发送。
- [ ] 运行 `node_modules\.bin\vitest.cmd run electron/main/favoriteLibraryEntryFlow.test.ts`，确认当前过早发送而失败。
- [ ] 让入口接受 `isRuntimeReady/onceRuntimeReady`，复用主窗口 readiness map；浮窗来源始终发送一次 `reveal`。
- [ ] 恢复主窗口时不额外发送 `assistant:open`，并把卡片说明改为“唤醒 bilimi 并打开收藏库”。
- [ ] 重跑 favoriteLibraryEntryFlow 和面板测试。

### Task 3: 宠物冷唤醒后台化

**Files:**
- Create: `electron/main/floatingSealWakeController.ts`
- Create: `electron/main/floatingSealWakeController.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingSealMouseRecovery.ts`
- Modify: `electron/main/floatingSealMouseRecovery.test.ts`

- [ ] 写红灯测试：重复唤醒只调度一次；关闭可取消尚未执行的显示意图；已存在窗口只走非激活显示。
- [ ] 运行新增测试，确认控制器缺失而失败。
- [ ] 实现最小唤醒控制器，以 `setImmediate` 调度冷创建并合并请求。
- [ ] 将鼠标恢复轮询延后到宠物 renderer 加载并显示前，移除冷创建起始阶段的空轮询。
- [ ] 加载完成使用 `showInactive()`，热唤醒也使用 `showInactive()`，不调用 `focus()`。
- [ ] 真正关闭仍销毁窗口，并清理 pending wake 状态。
- [ ] 重跑宠物窗口、鼠标恢复和主进程静态约束测试。

### Task 4: 验证

**Files:**
- Verify only; no packaging or installer changes.

- [ ] 运行三个目标区域的 Vitest 测试文件。
- [ ] 运行相关 TypeScript 检查；若全仓受既有脏树错误影响，记录精确错误并确认新增区域没有新错误。
- [ ] 在真实 Electron 开发版验证：备册期间侧栏可切换；关闭后冷唤醒期间鼠标和侧栏可操作且不抢焦；小咪收藏库从隐藏/最小化主窗口恢复后展开收藏库。
- [ ] 检查 `git diff`，确认未覆盖 DeepSeek、札记和旧藏方案的已有改动。
