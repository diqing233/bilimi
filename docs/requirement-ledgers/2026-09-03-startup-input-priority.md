# 2026-09-03 启动输入优先与项目书迭代需求账本

## 原文区

### R001

> 检查应用启动过程中鼠标会卡主，整个项目的第一要素就是所有操作流畅，鼠标不卡，历史多轮提交都没有优化好，你检查下有什么好办法

### R002

> 那你来做有多少把握

### R003

> 先迭代项目书，再按照项目书和账本改，开始（注意鼠标要一直流畅动，不要变卡，不要影响已有功能，仔细核对项目书）

### R004

> 目前启动后，如果鼠标持续移动的话，小咪就不会出现，直到停止才会出现，但是出现前还是会卡，不清楚是不是宠物的原因，你继续检查整个启动路径，该怎么改

### R005

> 可以开始，整个新分支做完

### R006

> 隔离开发版可以正常启动慢

### R007

> 不卡了，但是鼠标持续移动，小咪不会出现

## 逐项索引表

| 编号 | 原文编号 | 精确目标 | 目标界面/数据位置 | 显示与隐藏条件 | 交互与状态变化 | 持久化/迁移/B 站副作用 | 明确不改的边界 | 上下游依赖 | 状态 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| I001 | R001, R003 | 检查并解决启动期间鼠标卡顿；启动期所有操作保持流畅，鼠标可连续移动且前台输入优先 | Electron 主窗口、B 站首页 guest WebView、悬浮小咪/菜单/助手窗口、启动事件循环 | 主窗口首帧后持续生效；自动后台工作仅在无前台输入的安静窗口内运行 | 鼠标移动、按下/抬起、滚动、键盘、拖动、缩放、最小化、恢复、关闭收到后立即让后台阶段取消/让路；显式唤醒可优先创建必要小咪窗口，修补与轮询仍后台 | 不改本地业务数据、恢复/迁移、Cookie、代理、登录、收藏、转写、DeepSeek 或任何 B 站写入 | 不通过整仓回退、固定短延时、同步阻塞、整页遮罩、忙碌光标或牺牲已有功能换取表面速度 | 主进程启动 gate、renderer 路由、BiliWebview 事件、floatingSeal 调度与窗口控制 | 已确认 | 启动诊断日志、调度单测/回归测试、开发版连续鼠标移动/点击/滚动/拖动/缩放/最小化/恢复/关闭实机记录；任何卡顿均不得宣称完成 |
| I002 | R003 | 先迭代项目书，再按项目书和账本实施，严格核对项目书 | `docs/项目功能项目书.md`、本账本及实现文件 | 本轮开始前项目书新增约束；实施中逐项回读 | 每完成一项记录代码位置、自动化测试、真实界面验收和未验证条件 | 项目书与账本和代码同主题提交；不混入已有未跟踪收藏/推荐账本 | 不修改其它主题未跟踪账本，不静默删除/概括原文 | AGENTS.md 需求账本、Git 工作树、验证流程 | 已确认 | 项目书 diff、账本原文/索引、提交前逐条核对记录 |
| I003 | R003 | 不影响已有功能和窗口/业务边界 | 主窗口 B 站浏览、助手页签、收藏库、札记/转写、设置、小咪显式唤醒和所有 IPC | 所有既有入口和状态持续可用 | 模块拆分或调度变化不得改变 URL、Cookie、代理、登录、页面绑定、点击穿透、拖动、窗口控制、反馈、持久化或 B 站副作用 | 不迁移或重写业务数据，不改变远端读写语义 | 保护成熟子系统，只改启动性能边界和必要测试/诊断 | renderer 路由、共享类型、预加载 API、现有回归测试 | 已确认 | `npm test`、`npm run build`、现有启动/窗口/业务定向测试、开发版关键路径复核 |
| I004 | R001, R003 | 通过诊断找出历史优化未收敛的真实瓶颈，不凭猜测宣称流畅 | 开发诊断日志与 `.codex-artifacts/` 证据 | 仅开发诊断模式启用；生产不采集用户数据 | 记录首帧、首页收束、后台任务排队/取消/开始、小咪可见和输入让路阶段；不记录输入内容、账号、Cookie、页面内容或远端数据 | 仅本地开发日志，不上传、不写入应用业务存储 | 自动化不能替代实机体验；缺实机证据时最终报告必须明确待验收 | 启动 trace、调度器、Electron 实机窗口 | 已确认待验证 | 诊断摘要、截图/操作记录、性能前后对照；无法测量项明确列出 |
| I005 | R004, R005 | 启动路径必须区分真实首页加载收束与看门狗超时；持续输入时小咪可延后但不能让主窗口卡顿；停止输入后也不得立刻集中执行原生阶段 | 主窗口首页 guest WebView、主进程小咪自动唤醒 gate、后台阶段 | 只有 `dom-ready`/`did-stop-loading`/`did-fail-load` 等真实事件才能释放自动创建资格；超时只记诊断；小咪隐藏/关闭后已排队阶段不得继续执行 | 输入活动继续推迟尚未开始的后台阶段；每个小咪阶段重新经过稳定空闲检查；显示前不启用鼠标恢复轮询；关闭/隐藏取消所有排队阶段 | 不改变 B 站 URL/Cookie/代理/登录、业务 IPC、本地业务数据和远端写入；诊断不采集输入内容 | 不用固定延时伪造加载完成，不因宠物显示牺牲主窗口，不把 PowerShell/DWM 当作显示前置 | `App.tsx` 首页加载状态、preload IPC、`index.ts` gate/窗口生命周期、输入调度器 | 已确认 | 定向回归测试、全量测试、构建、开发版连续输入和小咪出现前后窗口操作记录 |
| I006 | R006 | 隔离开发版可让小咪自动出现更慢；启动性能决策优先保证鼠标连续流畅 | 自动小咪唤醒的输入感知调度器 | 自动小咪仅在首页真实收束后开始；从收束起最少等待 600ms，且真实交互后再经过 600ms 安静窗口；显式唤醒不延迟 | 连续移动不应无限期推迟首次最小显示；点击、滚动、键盘和窗口操作继续推迟自动创建 | 不改业务数据、B 站 URL/Cookie/代理/登录、任何远端写入或用户显式唤醒语义 | 不通过固定启动延时伪造加载完成；不延长既有窗口控制或用户明确操作 | `startupInputScheduler` 输入类别、`scheduleAutomaticFloatingSealWake` | 已实施待隔离实机验证 | RED/ GREEN 回归；正确隔离 profile 下观察首页收束→小咪显示与持续移动，验证 600ms 真实交互安静窗口和主窗口响应 |
| I007 | R007 | 连续移动鼠标时仍自动出现小咪，同时鼠标保持流畅 | 首页真实收束后的自动小咪唤醒、首次 hidden 小咪窗口创建与显示 | 首页真实收束后，连续指针移动不能无限期阻止自动显示；自动唤醒从收束起最少等待 600ms；按下/抬起、滚动、键盘、拖动、缩放、最小化、恢复、关闭等交互仍延后未开始的高成本阶段 | 首次最小小咪窗口创建可穿过连续 `pointermove`，但必须在最近一次真实交互后的 600ms 安静窗口开始；后续边界/置顶/鼠标恢复/白条/DWM/标题栏阶段仍在完整安静窗口分段运行 | 不改 B 站 URL/Cookie/代理/登录、本地业务数据、持久化、显式唤醒和任何远端写入 | 不以取消输入保护、同步原生修补或固定伪造首页收束来换取显示；不把自动小咪改为抢焦点显示 | `startupInputScheduler` 输入类别、renderer/preload 输入桥接、`floatingSealWakeController` 创建选项、启动测试 | 已实施待隔离实机验证 | 失败回归测试证明连续指针移动不推迟已获资格的自动创建；隔离开发版记录“首页收束→小咪显示”且连续移动期间无可感知卡顿，随后验证实际交互仍会让后续原生阶段让路 |

### R007 续验记录（2026-09-03）

| 条目 | 实际代码位置 | 自动化验证 | 隔离 Electron 验收 | 结果与边界 |
| --- | --- | --- | --- | --- |
| I004、I005 | `electron/main/index.ts`：`did-attach-webview` 对实际 main guest 缓存 `dom-ready`、`did-stop-loading` 和主帧 `did-fail-load`；`registerHomeWebviewGuest()` 仅接受可信主窗口报告且已附加的数值 id；`src/renderer/src/App.tsx`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts` 只桥接首页 guest 的 id | 新增 RED→GREEN 契约 `keeps a real home guest load outcome when the renderer identifies the WebView after its event fires`；最新定向 6 files / 92 tests passed | r11 首次隔离 profile 在启动前提示页未创建首页 guest，故仅记录 timeout；完成提示后真实首页收束并出现小咪。r12 同 profile 重启：`input:pointer-move +385ms`、`home-webview:load-settled +2997ms`、`pet-window:create +3773ms`、`pet-window:shown +3953ms`；Windows 窗口枚举与截图均检出独立小咪 | 根因不是把 timeout 当收束，而是 renderer 可能在真实 guest 事件后才取得 id；现在先缓存真实事件再按首页 id 认领。看门狗、其它标签、未知 id 均不能放行。未登录，未执行收藏、评论、投币、转写、DeepSeek 或任何 B 站写入。 |
| I006、I007 | `electron/main/startupInputScheduler.ts` 与 `electron/main/index.ts` 的 `ignorePointerMove`、两段 600ms 自动创建门槛保持不变；本次仅修复真实首页收束资格传递 | `startupInputScheduler.test.ts` 的连续 `pointer-move` 600ms 用例和 80ms 鼠标恢复轮询用例；`index.mainWindowPetStartup.test.ts` 自动创建与 guest 收束契约；最新定向 6 files / 92 tests passed | r12 的首个 `pointer-move` 发生在首页首帧之前，首页真实收束后仍在约 956ms 内完成小咪显示；独立小咪窗口可见 | Windows 自动化接口无法注入“无按键、持续移动”的纯 pointermove，不能把点击、拖动伪造为该验收；用户仍须在开发版中持续移动鼠标核对手感。缩放、最小化、恢复、关闭的完整连续体验也仍待人工验收，故本轮不声称所有流畅性项已完成。 |

### 最新全量验证记录（2026-09-03）

| 条目 | 实际代码位置 | 自动化验证 | 结果与仍无法验证条件 |
| --- | --- | --- | --- |
| I001、I003、I005、I006、I007 | `electron/main/index.ts`、`electron/main/startupInputScheduler.ts`、`electron/main/floatingSealIdleTask.ts`、`electron/main/floatingSealWakeController.ts`、`electron/preload/index.ts`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`、`src/renderer/src/global.d.ts`；首页 guest 早到收束另由主进程缓存再可信认领 | `npm run build` 退出码 0；`npm test` 退出码 0，246 files / 4281 tests passed；本轮启动定向契约包括 6 files / 92 tests passed | 自动创建只会从真实首页 guest 收束放行，连续无按键 `pointermove` 不重置首次最小创建门槛，真实交互仍让后续重阶段等待。实际开发版 r12 已记录收束到小咪可见；但 Windows 自动化无法产生纯连续 `pointermove`，所以该项鼠标手感以及缩放、最小化、恢复、关闭的整段体验仍须人工验收。 |
| I003（测试门禁） | `electron/installer/installer.finishPage.test.ts`、`electron/main/index.favoriteHistoryWiring.test.ts` | 两条已有源码文本断言先在本 Windows 工作树以 CRLF 失败；改为同时接受 LF/CRLF 后，定向 2 files / 6 tests 与上述全量测试通过 | 仅修正测试对文本行尾的跨平台匹配，不修改安装器、收藏历史或任何应用运行行为。 |

## 实施计划与核对

### 已确认条目（按原文顺序）

1. I001（R001、R003）：启动期输入优先与鼠标连续流畅。
2. I002（R003）：项目书先行、账本审计、按原文实施。
3. I003（R003）：不影响已有功能和业务边界。
4. I004（R001、R003）：建立真实启动诊断和实机验收证据。
5. I005（R004、R005）：真实首页收束、超时诊断、关闭取消和启动阶段稳定空闲门禁。
6. I006（R006）：允许隔离开发版启动更慢，但不牺牲鼠标连续流畅。
7. I007（R007）：连续移动不能无限期阻止小咪自动出现，且鼠标持续流畅。

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
| 5 | I005 | `src/renderer/src/App.tsx`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`、`electron/main/index.ts`、启动测试 | 看门狗不再伪装真实收束；隐藏/关闭取消所有小咪阶段；事件注册类型安全 | 首页未收束时小咪不自动创建；小咪隐藏后迟到任务误执行 | 先写失败测试，再定向测试、全量测试和构建 | 开发版持续移动/停止鼠标，观察主窗口响应和小咪阶段诊断 |
| 6 | I006 | `electron/main/startupInputScheduler.ts`、`electron/main/floatingSealIdleTask.ts`、`electron/main/index.ts`、调度器/启动测试 | 自动小咪首次创建在首页真实收束至少 600ms、且最近真实交互安静 600ms 后进行；连续移动不无限期阻止显示 | 错误延迟显式唤醒或后台后续阶段；多阶段在停止输入后集中执行 | 先写任务级输入类别失败测试和自动唤醒契约，再最小实现并跑定向/全量测试 | 正确隔离 profile 下记录首页收束→小咪创建间隔及连续移动/停止后的主窗口响应 |
| 7 | I007 | `docs/项目功能项目书.md`、`electron/main/startupInputScheduler.ts`、`electron/main/floatingSealIdleTask.ts`、`electron/main/floatingSealWakeController.ts`、`electron/main/index.ts`、renderer/preload 输入桥接和对应测试 | 仅连续 `pointermove` 不再重置自动首次创建资格；实际交互仍推迟自动创建，后续原生阶段保持完整输入让路 | 小咪在移动中创建仍可能影响指针，或错误把点击/滚动/拖动视为可忽略 | 先写输入类别和自动创建选项的失败测试；定向测试、全量测试、构建和隔离开发版连续移动实测 | 记录首页收束→小咪显示；持续移动、点击/滚动/拖动/缩放/最小化/恢复/关闭分别验证，不把自动化当作实机流畅证明 |

## 实施记录

| 条目 | 实际代码位置 | 自动化测试 | 真实界面验收 | 结果/仍无法验证条件 |
| --- | --- | --- | --- | --- |
| I001 | `electron/main/startupInputScheduler.ts`、`electron/main/floatingSealIdleTask.ts`；`electron/main/index.ts` 的主窗口/B 站 guest/小咪/菜单/助手输入观察、窗口 move/resize/minimize/restore/close 让路、自动唤醒和小咪创建/原生修补分阶段调度；`electron/main/floatingSealWhiteStripFix.ts` 的可取消重绘；`electron/main/floatingSealMouseRecovery.ts` 的轮询接入调度器；`src/renderer/src/main.tsx` 的输入活动节流 | `electron/main/startupInputScheduler.test.ts` 9 tests；`electron/main/floatingSealWhiteStripFix.test.ts` 14；`electron/main/floatingSealMouseRecovery.test.ts` 5；`electron/main/floatingSealWakeController.test.ts` 8；`electron/main/index.mainWindowPetStartup.test.ts` 19；定向合计 55/55；全量 `npm test` 246 files / 4270 tests passed | 开发版隔离 profile 已验证启动、权限页点击、B 站 guest 加载、主窗口连续鼠标移动/点击/滚动/拖动，以及输入到来时后台阶段出现 `deferred`/`cancelled`；日志见 `.codex-artifacts/startup-input-priority-20260903-final.md`。小咪 renderer ready/show 和后续调度阶段有日志，但最终 profile 未稳定呈现完整可见主体；最小化/恢复已完成，缩放和关闭未完成一轮可靠连续验收 | 输入优先边界已实现并有自动化和开发版日志证据；调度器安静窗口为 160ms，`mouse-recovery` 的原始 80ms 轮询会让位于该窗口。尚未能据实确认缩放/关闭和小咪完整可见主体，因此不能把 I001 写成“所有实机操作已证明无卡顿”。 |
| I002 | `docs/项目功能项目书.md` 已追加“启动输入优先与性能预算”“启动模块隔离与可观测性”条款；本账本原文区、索引表、实施计划均保留 R001-R003 和逐项核对要求 | 项目书与账本文本检查；`git diff --check` 无错误（仅 Git 行尾转换提示） | 已逐条回读项目书新增约束、账本原文和索引；实施顺序按 I002 -> I004 -> I001/I003 执行 | 已实施。项目书、账本和代码必须同一主题提交；既有三份收藏/推荐账本明确不纳入本轮 |
| I003 | 未改 B 站 URL/Cookie/代理/登录/收藏/转写/DeepSeek、业务 IPC 和持久化语义；仅在启动 gate、窗口 renderer 入口、浮动窗口后台阶段和诊断桥接处改动；`src/renderer/src/main.tsx` 用 URL 路由 `React.lazy` 分包 | `electron/main/index.mainWindowPetStartup.test.ts` 19；现有业务回归包含在全量 `npm test`（246/4270）；`npm run build` 通过 | 开发版已加载 B 站页面并保留主窗口浏览入口；未登录、未执行收藏/远端写入。隔离 profile 曾遇到 B 站登录/412 风控限制，不能作为远端本地业务成功或失败 | 代码边界和自动化回归未显示业务语义改变；B 站远端写入、Cookie、登录和收藏未执行，故这些副作用仅能报告为未触发/未验证，不声称远端流程验收完成 |
| I004 | `electron/main/index.ts` 的 `traceStartupPhase`、首帧/interactive/home-settled IPC；`electron/main/floatingSealIdleTask.ts` 的后台状态日志；`electron/preload/index.ts` 与 `src/renderer/src/global.d.ts` 的诊断桥接；开发日志通过 `BILIMI_STARTUP_DIAGNOSTICS=1` 启用 | `electron/main/index.mainWindowPetStartup.test.ts` 覆盖首帧/interactive/home gate 和输入 observer；`electron/main/startupInputScheduler.test.ts` 覆盖 queued/deferred/started/cancelled/failed/completed、dispose 和迟到 completion；全量 `npm test` 246 files / 4270 tests passed；`npm run build` 通过 | 已观察到 `main-window:first-frame`、`main-window:interactive-ready`、`home-webview:load-settled`、`pet-wake`、`pet-window:shown`、后台 `deferred/cancelled/started` 和 `input:activity` 日志；未记录输入内容、账号、Cookie 或页面内容 | 已有诊断能区分首帧、首页收束、小咪可见、后台阶段及输入让路；自动化不替代实机体验。缩放/关闭和小咪完整可见主体仍待验收，日志和外部 B 站 412 限制已明确记录 |
| I005 | `src/renderer/src/App.tsx`、`electron/preload/index.ts`、`src/renderer/src/global.d.ts`、`electron/main/index.ts`：首页看门狗只上报 timeout、不释放自动 gate；小咪 hide/closed 取消排队阶段并在每个原生回调检查可见生命周期 | `electron/main/index.mainWindowPetStartup.test.ts` 看门狗、隐藏取消、窗口输入观察契约；最新定向 5 文件 / 61 测试通过；`npm run build` 通过 | r8 隔离 profile 真实首页收束后已有小咪显示日志；r9 用正确 `BILIMI_TEST_USER_DATA` 重新启动，主窗口和 320×380 小咪原生窗口均被检出。未做 B 站写入 | 代码、定向测试和隔离启动覆盖已完成；全量测试 4274 passed / 2 failed 为基线无关失败，按门禁不提交；完整人工操作手感仍待验收 |
| I006 | `electron/main/startupInputScheduler.ts` 的任务级安静窗口与输入类别；`electron/main/floatingSealIdleTask.ts` 透传；`electron/main/index.ts` 的自动唤醒设置 `minimumQuietWindowMs: 600`、`minimumDelayMs: 600`，实际 `floating-seal:create` 再设置 `minimumQuietWindowMs: 600`；鼠标恢复轮询诊断关闭但调度语义不变 | RED：自动唤醒和实际创建的 600ms 契约先失败；GREEN：定向 5 文件 / 61 测试通过。`startupInputScheduler.test.ts` 验证普通长安静窗口与连续 pointermove 穿过 600ms 的任务级行为 | r8 正确隔离 profile 已加载首页；连续移动日志发生在首页收束前，随后首页收束到小咪显示约 1103ms；r9 隔离 profile 也启动了主窗口与 320×380 小咪原生窗口。Windows 自动化接口不支持无按键 pointermove 注入，不能把点击/拖动伪作该验收 | 修正先前未验证的“取消 600ms 保护”改动，并堵住 auto-wake 与实际创建之间的输入窗口：r8 时间线显示 600ms 并未阻止小咪显示，且保护可防止刚停止输入就创建。完整人工连续移动手感仍待用户/可用硬件验证 |
| I007 | `startupInputScheduler.ts` 区分 `pointer-move` / `foreground`；`main.tsx`、preload、`index.ts` 仅传递输入类别、不传输入内容；自动唤醒及首次创建都标记 `ignorePointerMove` 并各自保留 600ms 真实交互门槛，后续原生阶段不标记；`isPointerMoveInput()` 以大小写无关的 `buttondown` 识别 guest WebView 拖动为真实交互 | RED：连续移动下跨过 600ms 仍可首次创建、真实交互后继续让路、拖动修饰符分类和两段 600ms 创建契约；GREEN：定向 5 文件 / 61 测试通过 | r8 隔离 profile 日志：`input:pointer-move +32778ms`，`home-webview:load-settled +34123ms`，`pet-window:create +34905ms`，`pet-window:shown +35226ms`；首页收束后约 1103ms 已显示小咪，并且主窗口随后滚动成功。r9 也检出独立 320×380 小咪窗口 | 已实装并有隔离日志/窗口证据证明移动不是无限 gate；Windows 自动化无法生成纯 pointermove，因此不能用其取代人工流畅度、拖动/缩放/最小化/恢复/关闭的完整验收 |
