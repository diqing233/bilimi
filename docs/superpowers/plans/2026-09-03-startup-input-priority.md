# 启动输入优先与 renderer 隔离实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让启动期间的鼠标和窗口输入始终优先，并通过窗口入口分包、可取消后台调度和开发诊断消除历史优化无法收敛的问题，同时不改变已有业务行为。

**Architecture:** 主进程使用输入感知的可取消空闲调度器，前台输入会推迟所有尚未开始的非关键任务，后台阶段逐段重新检查安静窗口。renderer 入口按 URL 路由动态加载主窗口、悬浮助手、菜单和小咪，避免小咪启动解析主窗口重型业务模块。开发诊断只在 `BILIMI_STARTUP_DIAGNOSTICS=1` 时记录启动阶段、任务让路和输入活动摘要，不保存敏感数据。

**Tech Stack:** Electron 42、React 19、TypeScript、Vite/electron-vite、Vitest。

---

### Task 1: 需求账本和项目书核对

**Files:**
- Modify: `docs/项目功能项目书.md`
- Create: `docs/requirement-ledgers/2026-09-03-startup-input-priority.md`
- Create: `docs/superpowers/plans/2026-09-03-startup-input-priority.md`

- [x] 逐字记录本轮 R001-R003，并建立 I001-I004 索引。
- [x] 在项目书 1.1 增加输入优先性能预算、窗口 renderer 隔离、诊断和实机验收门禁。
- [x] 重新通读账本原文和索引，确认本轮只覆盖启动性能与不回归约束。

### Task 2: 输入感知调度器 RED → GREEN

**Files:**
- Create: `electron/main/startupInputScheduler.ts`
- Test: `electron/main/startupInputScheduler.test.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`
- Modify: `electron/main/index.ts`

- [x] 先写失败测试：排队任务在输入活动后不执行，安静窗口结束后才执行；取消任务不执行；每次阶段只能在重新检查安静窗口后开始。
- [x] 实现最小调度器，统一维护输入活动时间、可取消 timer/immediate 和 `queued/deferred/started/cancelled/failed/completed` 诊断事件。
- [x] 将现有小咪自动唤醒、创建和原生修补阶段接入调度器；保留显式唤醒和关闭清理语义。
- [x] 在主进程校验可信 renderer sender，接收 preload 的输入活动信号；不读取或存储输入内容。

### Task 3: renderer 入口隔离 RED → GREEN

**Files:**
- Modify: `src/renderer/src/main.tsx`
- Modify: `src/renderer/src/global.d.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`
- Test: `electron/main/index.mainWindowPetStartup.test.ts` and focused renderer entry tests if needed

- [x] 先写失败契约：入口不得静态导入四类重型窗口应用；路由只动态加载当前窗口所需模块；主窗口仍渲染原 `App`，小咪/菜单/助手仍保留原 URL 路由和行为。
- [x] 使用 `React.lazy`/动态 import 加载路由组件，保留 `StrictMode` 和可读的启动中 fallback。
- [x] preload 增加节流后的 `notifyStartupInputActivity`；入口安装被动 `pointermove/pointerdown/wheel/key/resize` 监听，首次输入立即通知主进程。
- [x] 不改变任何业务 IPC、URL、Cookie、代理、登录、点击穿透、拖动或窗口控制；由现有回归和构建门禁复核。

### Task 4: 诊断与回归验证

**Files:**
- Modify: `electron/main/index.ts`
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`
- Modify: `docs/requirement-ledgers/2026-09-03-startup-input-priority.md`
- Create: `.codex-artifacts/` startup diagnostic summaries and screenshots only

- [x] 运行定向测试，确认调度和路由契约先红后绿；最新定向结果为 5 files / 55 tests passed。
- [x] 运行 `npm test`、`npm run build`、`git diff --check`，检查工作树没有混入已有收藏/推荐账本；全量 246 files / 4270 tests passed，构建通过，差异检查无错误。三份既有收藏/推荐账本仍未跟踪且明确排除。
- [x] 使用 `BILIMI_STARTUP_DIAGNOSTICS=1 npm run dev` 记录首帧、首页收束、任务排队/让路/开始、小咪可见和输入活动摘要；证据来自隔离开发 profile，未采集用户输入或远端数据。
- [ ] 在开发版真实验证小咪出现前后连续鼠标移动、点击、滚动、拖动、缩放、最小化、恢复、关闭；已完成移动/点击/滚动/拖动和输入让路，缩放、最小化、恢复、关闭完整连续链路仍待可靠复验。
- [x] 逐项更新账本 I001-I004 的代码位置、测试、实机结果和仍无法验证条件；账本明确保留未完成实机门禁，不把测试通过写成体验完成。
