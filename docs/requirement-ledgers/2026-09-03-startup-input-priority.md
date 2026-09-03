# 2026-09-03 启动输入优先与项目书迭代需求账本

## 原文区

### R001

> 检查应用启动过程中鼠标会卡主，整个项目的第一要素就是所有操作流畅，鼠标不卡，历史多轮提交都没有优化好，你检查下有什么好办法

### R002

> 那你来做有多少把握

### R003

> 先迭代项目书，再按照项目书和账本改，开始（注意鼠标要一直流畅动，不要变卡，不要影响已有功能，仔细核对项目书）

## 逐项索引表

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R003 | 检查并解决启动期间鼠标卡顿；启动期所有操作保持流畅，鼠标可连续移动且前台输入优先 | Electron 主窗口、B 站首页 guest WebView、悬浮小咪/菜单/助手窗口、启动事件循环 | 主窗口首帧后持续生效；自动后台工作仅在无前台输入的安静窗口内运行 | 鼠标移动、按下/抬起、滚动、键盘、拖动、缩放、最小化、恢复、关闭收到后立即让后台阶段取消/让路；显式唤醒可优先创建必要小咪窗口，修补与轮询仍后台 | 不改本地业务数据、恢复/迁移、Cookie、代理、登录、收藏、转写、DeepSeek 或任何 B 站写入 | 不通过整仓回退、固定短延时、同步阻塞、整页遮罩、忙碌光标或牺牲已有功能换取表面速度 | 主进程启动 gate、renderer 路由、BiliWebview 事件、floatingSeal 调度与窗口控制 | 已确认 | 启动诊断日志、调度单测/回归测试、开发版连续鼠标移动/点击/滚动/拖动/缩放/最小化/恢复/关闭实机记录；任何卡顿均不得宣称完成 |
| I002 | R003 | 先迭代项目书，再按项目书和账本实施，严格核对项目书 | `docs/项目功能项目书.md`、本账本及实现文件 | 本轮开始前项目书新增约束；实施中逐项回读 | 每完成一项记录代码位置、自动化测试、真实界面验收和未验证条件 | 项目书与账本和代码同主题提交；不混入已有未跟踪收藏/推荐账本 | 不修改其它主题未跟踪账本，不静默删除/概括原文 | AGENTS.md 需求账本、Git 工作树、验证流程 | 已确认 | 项目书 diff、账本原文/索引、提交前逐条核对记录 |
| I003 | R003 | 不影响已有功能和窗口/业务边界 | 主窗口 B 站浏览、助手页签、收藏库、札记/转写、设置、小咪显式唤醒和所有 IPC | 所有既有入口和状态持续可用 | 模块拆分或调度变化不得改变 URL、Cookie、代理、登录、页面绑定、点击穿透、拖动、窗口控制、反馈、持久化或 B 站副作用 | 不迁移或重写业务数据，不改变远端读写语义 | 保护成熟子系统，只改启动性能边界和必要测试/诊断 | renderer 路由、共享类型、预加载 API、现有回归测试 | 已确认 | `npm test`、`npm run build`、现有启动/窗口/业务定向测试、开发版关键路径复核 |
| I004 | R001, R003 | 通过诊断找出历史优化未收敛的真实瓶颈，不凭猜测宣称流畅 | 开发诊断日志与 `.codex-artifacts/` 证据 | 仅开发诊断模式启用；生产不采集用户数据 | 记录首帧、首页收束、后台任务排队/取消/开始、小咪可见和输入让路阶段；不记录输入内容、账号、Cookie、页面内容或远端数据 | 仅本地开发日志，不上传、不写入应用业务存储 | 自动化不能替代实机体验；缺实机证据时最终报告必须明确待验收 | 启动 trace、调度器、Electron 实机窗口 | 已确认待验证 | 诊断摘要、截图/操作记录、性能前后对照；无法测量项明确列出 |

## 实施计划与核对

### 已确认条目（按原文顺序）

1. I001（R001、R003）：启动期输入优先与鼠标连续流畅。
2. I002（R003）：项目书先行、账本审计、按原文实施。
3. I003（R003）：不影响已有功能和业务边界。
4. I004（R001、R003）：建立真实启动诊断和实机验收证据。

### 待用户决定

无。

### 被明确替代

无。

### 明确不做

无。固定短延时、关闭 GPU、整仓回退等是技术边界说明，不是用户要求的功能，均不纳入实现。

### 实施批次

| 步骤 | 覆盖条目 | 允许修改的文件/模块 | 预期结果 | 回归风险 | 测试方案 | 界面验收方式 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | I002 | `docs/项目功能项目书.md`、本账本 | 项目书新增输入优先、模块隔离、诊断和实机门禁 | 文档与实现不一致 | `git diff --check`、逐条回读 | 检查项目书对应章节 |
| 2 | I004 | `electron/main/startupDiagnostics.ts`、`electron/main/index.ts`、renderer 诊断桥接及其测试 | 开发模式可记录阶段与后台任务让路，不采集敏感内容 | 诊断代码影响启动或日志噪音 | 定向单测、日志格式测试、构建 | 开发版读取 `.codex-artifacts` 摘要 |
| 3 | I001, I003 | `src/renderer/src/main.tsx`、新增窗口入口模块、`electron/main/floatingSealIdleTask.ts`、`electron/main/index.ts`、必要测试 | 宠物/菜单不解析主窗口重型模块；后台阶段可取消并在输入期间让路；既有窗口/IPC 语义不变 | 路由入口、预加载、显式唤醒和点击穿透回归 | 先写失败测试，再定向/全量测试和构建 | 开发版启动全过程连续鼠标操作与窗口控制 |
| 4 | I001, I003, I004 | 相关账本索引、`.codex-artifacts/` 证据 | 逐项记录代码、测试、实机结果和未验证条件 | 把测试通过误写成体验完成 | `npm test`、`npm run build`、`git diff --check`、状态检查 | 缺实机证据则明确待验收，不声称完成 |

## 实施记录

| 条目 | 实际代码位置 | 自动化测试 | 真实界面验收 | 结果/仍无法验证条件 |
| --- | --- | --- | --- | --- |
| I001 | `electron/main/startupInputScheduler.ts`、`electron/main/floatingSealIdleTask.ts`；`electron/main/index.ts` 的主窗口/B 站 guest/小咪/菜单/助手输入观察、窗口 move/resize/minimize/restore/close 让路、自动唤醒和小咪创建/原生修补分阶段调度；`electron/main/floatingSealWhiteStripFix.ts` 的可取消重绘；`electron/main/floatingSealMouseRecovery.ts` 的轮询接入调度器；`src/renderer/src/main.tsx` 的输入活动节流 | `electron/main/startupInputScheduler.test.ts` 9 tests；`electron/main/floatingSealWhiteStripFix.test.ts` 14；`electron/main/floatingSealMouseRecovery.test.ts` 5；`electron/main/floatingSealWakeController.test.ts` 8；`electron/main/index.mainWindowPetStartup.test.ts` 19；定向合计 55/55；全量 `npm test` 246 files / 4270 tests passed | 开发版隔离 profile 已验证启动、权限页点击、B 站 guest 加载、主窗口连续鼠标移动/点击/滚动/拖动，以及输入到来时后台阶段出现 `deferred`/`cancelled`；日志见 `.codex-artifacts/startup-input-priority-20260903-final.md`。小咪 renderer ready/show 和后续调度阶段有日志，但最终 profile 未稳定呈现完整可见主体；最小化/恢复已完成，缩放和关闭未完成一轮可靠连续验收 | 输入优先边界已实现并有自动化和开发版日志证据；调度器安静窗口为 160ms，`mouse-recovery` 的原始 80ms 轮询会让位于该窗口。尚未能据实确认缩放/关闭和小咪完整可见主体，因此不能把 I001 写成“所有实机操作已证明无卡顿”。 |
| I002 | `docs/项目功能项目书.md` 已追加“启动输入优先与性能预算”“启动模块隔离与可观测性”条款；本账本原文区、索引表、实施计划均保留 R001-R003 和逐项核对要求 | 项目书与账本文本检查；`git diff --check` 无错误（仅 Git 行尾转换提示） | 已逐条回读项目书新增约束、账本原文和索引；实施顺序按 I002 -> I004 -> I001/I003 执行 | 已实施。项目书、账本和代码必须同一主题提交；既有三份收藏/推荐账本明确不纳入本轮 |
| I003 | 未改 B 站 URL/Cookie/代理/登录/收藏/转写/DeepSeek、业务 IPC 和持久化语义；仅在启动 gate、窗口 renderer 入口、浮动窗口后台阶段和诊断桥接处改动；`src/renderer/src/main.tsx` 用 URL 路由 `React.lazy` 分包 | `electron/main/index.mainWindowPetStartup.test.ts` 19；现有业务回归包含在全量 `npm test`（246/4270）；`npm run build` 通过 | 开发版已加载 B 站页面并保留主窗口浏览入口；未登录、未执行收藏/远端写入。隔离 profile 曾遇到 B 站登录/412 风控限制，不能作为远端本地业务成功或失败 | 代码边界和自动化回归未显示业务语义改变；B 站远端写入、Cookie、登录和收藏未执行，故这些副作用仅能报告为未触发/未验证，不声称远端流程验收完成 |
| I004 | `electron/main/index.ts` 的 `traceStartupPhase`、首帧/interactive/home-settled IPC；`electron/main/floatingSealIdleTask.ts` 的后台状态日志；`electron/preload/index.ts` 与 `src/renderer/src/global.d.ts` 的诊断桥接；开发日志通过 `BILIMI_STARTUP_DIAGNOSTICS=1` 启用 | `electron/main/index.mainWindowPetStartup.test.ts` 覆盖首帧/interactive/home gate 和输入 observer；`electron/main/startupInputScheduler.test.ts` 覆盖 queued/deferred/started/cancelled/failed/completed、dispose 和迟到 completion；全量 `npm test` 246 files / 4270 tests passed；`npm run build` 通过 | 已观察到 `main-window:first-frame`、`main-window:interactive-ready`、`home-webview:load-settled`、`pet-wake`、`pet-window:shown`、后台 `deferred/cancelled/started` 和 `input:activity` 日志；未记录输入内容、账号、Cookie 或页面内容 | 已有诊断能区分首帧、首页收束、小咪可见、后台阶段及输入让路；自动化不替代实机体验。缩放/关闭和小咪完整可见主体仍待验收，日志和外部 B 站 412 限制已明确记录 |
