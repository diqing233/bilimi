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
- [x] 追加 R004/R005：记录持续移动时小咪不出现且停止后仍卡的原文，以及本次开始授权；索引新增 I005。
- [x] 为首页看门狗、隐藏/关闭取消和稳定空闲门禁先补失败测试。
- [x] 实现真实加载收束与超时诊断分离，修正窗口事件注册并为小咪阶段增加生命周期守卫。
- [x] 重新运行定向测试和构建，完成隔离开发版启动/小咪原生窗口证据并回填账本；全量测试已运行至结束，但有两项基线无关失败，按项目门禁不得提交。完整人工连续移动、缩放、最小化、恢复、关闭连续手感仍待验收。
- [x] 追加 R006：隔离开发版允许自动小咪较慢，优先保证鼠标连续流畅；R007 实机表明不能把连续移动当作无限期 gate。自动首次显示从首页真实收束起最少等待 600ms，连续移动不重置它；真实交互则重新开始 600ms 安静窗口。已先完成 RED，再以输入类别最小实现。
- [x] 在正确 `BILIMI_TEST_USER_DATA` 隔离 profile 记录首页收束→自动小咪创建的时间线：r8 日志显示连续 pointermove 后 `home-webview:load-settled +34123ms`、`pet-window:shown +35226ms`；r9 重新启动并检出独立 320×380 小咪窗口。Windows 自动化不能注入无按键 pointermove，不以点击/拖动伪造此项；完整人工操作手感留待验收。

### Task 5: 连续指针移动下的自动小咪显示 RED → GREEN

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-03-startup-input-priority.md`
- Modify: `electron/main/startupInputScheduler.ts`
- Test: `electron/main/startupInputScheduler.test.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`
- Modify: `electron/main/floatingSealWakeController.ts`
- Test: `electron/main/floatingSealWakeController.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`
- Modify: `src/renderer/src/main.tsx`, `electron/preload/index.ts`, `src/renderer/src/global.d.ts`

- [x] 追加 R007 原文和 I007 索引；先修改项目书，明确连续 `pointermove` 是流畅性指标而非无限期自动显示阻塞条件，按下/抬起、滚动、键盘与窗口控制仍是完整阻塞条件。
- [x] 先写失败测试：指针移动容忍的任务只等待最近一次真实交互的标准安静窗口；普通任务仍被指针移动推迟；自动小咪 `wake()` 把首次创建标记为“忽略连续指针移动”，显式唤醒不改变。
- [x] 实现最小输入类别：renderer/preload/主进程把 `pointermove` 与真实交互分开；调度器只对被明确标记的自动首次创建忽略前者，普通原生修补、鼠标恢复和用户操作保持现有完整安静窗口。
- [x] 运行定向测试（5 files / 61 tests）、`npm run build` 和 `git diff --check`；全量 `npm test` 完整运行后 4274 passed / 2 failed，两个失败均为基线无关的安装器 CRLF 断言和收藏历史正则块截取，未提交。隔离 profile 记录首页收束→小咪显示；持续移动自动显示有 r8 日志证据，其他完整人工操作手感不由自动化冒充，仍待验收。

### Task 6: 首页 guest 早到事件保留 RED → GREEN

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-09-03-startup-input-priority.md`
- Modify: `electron/main/index.ts`
- Modify: `electron/preload/index.ts`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/global.d.ts`
- Test: `electron/main/index.mainWindowPetStartup.test.ts`

- [x] 根据 R007 的新实机结果检查启动日志：日志仅有 `home-webview:load-timeout` 时，小咪自动唤醒未获资格；这与连续移动调度本身分离。
- [x] 先写失败契约，覆盖主进程缓存真实 `dom-ready`/`did-stop-loading`/主帧 `did-fail-load`，以及 renderer 后到时的首页 guest id 认领桥接。
- [x] 只为主窗口实际附加的 guest 缓存真实收束；可信首页 renderer 报告其数值 webContents id 后，若已缓存则释放同一首页 gate。未知 id、其它标签和看门狗超时仍不释放。
- [x] 运行定向 6 files / 92 tests 与构建；r12 隔离开发版不经任何 B 站写入，在 `home-webview:load-settled +2997ms` 后记录 `pet-window:create +3773ms`、`pet-window:shown +3953ms`，并检出独立小咪窗口。Windows 自动化不能注入纯连续 pointermove，完整鼠标手感和所有窗口控制仍保留人工验收。
- [x] 最终全量门禁：Windows 工作树的两条源码文本断言原先把 LF 写死，导致与本轮无关的 CRLF 误失败；断言已收窄为兼容两种行尾，未改应用行为。`npm run build` 退出码 0；`npm test` 退出码 0，246 files / 4281 tests passed。纯连续鼠标移动、缩放、最小化、恢复和关闭的实机整段体验仍不得由自动化替代。
