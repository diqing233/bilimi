# 启动 B 站优先、鼠标响应与安装完成页关闭实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主窗口/B 站首页优先保持流畅，展开全局提示时按完整三行顺序呈现，并修复 Windows NSIS 完成页只保留最小化与关闭且 `×` 可用，同时保护既有业务。

**Architecture:** 启动流程继续使用主窗口交互、B 站首页收束和小咪后台 gate；小咪 renderer 就绪后先显示并恢复输入语义，再把白条/DWM/PowerShell 修补作为独立可取消后台任务，避免显示前阻塞鼠标。全局提示把两行截断测量与展开续文分离，展开内容以无标题续文插在后台任务前。NSIS 完成页仅设置系统菜单和最小化样式，关闭沿用 abort/quit 通道，不改变 Finish/运行复选框。

**Tech Stack:** Electron 主进程/renderer、React、TypeScript、Vitest、NSIS/electron-builder。

---

### Task 1: 文档与账本同步

**Files:**
- Modify: `docs/项目功能项目书.md`（1.1 启动/全局反馈/安装完成页条款）
- Modify: `docs/requirement-ledgers/2026-09-01-startup-bilibili-installer-responsiveness.md`

- [x] 追加 R006-R009 原文、I002/I003/I004 索引和替代关系。
- [x] 明确原生修补不得在小咪显示前 awaited，明确提示“前两行→无标题第三行续文→后台任务→最近提示”，安装页仅最小化/关闭。
- [x] 自检项目书、账本、计划的范围与保护边界一致。

### Task 2: 全局提示续文（I004）RED → GREEN

**Files:**
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.test.ts`
- Modify: `src/renderer/src/styles.test.ts`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Modify: `src/renderer/src/styles.css`
- Test helper: `src/renderer/src/features/assistant/feedbackContinuation.ts`（仅在测试证明需要时）

- [x] **RED:** 修改源码契约测试，要求展开菜单在“后台任务”前包含无标题续文节点，短提示不渲染空续文，并运行对应 Vitest 确认失败。
- [x] **GREEN:** 展开态渲染完整 `displayedGlobalFeedbackMessage` 的前两行和剩余续文；续文结束后才渲染后台任务/最近提示；不增加“当前提示”标题或重复提示。
- [x] 调整布局测量为两行前缀/后缀，保持收起态两行 clamp、展开点击立即响应；续文计算仅在布局 effect/空闲帧执行。
- [x] 运行 `FloatingAssistantApp.test.ts` 与 `styles.test.ts`，确认原有状态灯、历史和任务文案未变。

### Task 3: 启动小咪非阻塞（I002）RED → GREEN

**Files:**
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`（仅在测试证明需要时）
- Modify: `electron/main/floatingSealCaptionStrip.ts` / `electron/main/floatingSealWhiteStripFix.ts`（仅在非阻塞实现需要时）

- [x] **RED:** 增加断言，要求小咪 `showWhenReady`/鼠标恢复初始化不等待 PowerShell caption 修补或白条重绘 Promise；原生修补必须在显示后独立调度且可取消。运行测试确认旧实现失败。
- [x] **GREEN:** renderer `did-finish-load` 后先初始化隐藏透明/点击穿透窗口、调用 `showInactive()` 并记录 `pet-window:shown`；之后 `void scheduleFloatingSealNativePolish`，每个白条/PowerShell 阶段让出事件循环，失败不回滚显示。
- [x] 保留首页加载 settled/failed gate、可取消 idle 任务、显式唤醒、关闭清理和“可见后才轮询鼠标”语义；不显示忙碌光标/遮罩。
- [x] 运行启动相关 Vitest，并用 `BILIMI_STARTUP_DIAGNOSTICS=1 npm run dev` 摘要记录阶段顺序与耗时。

### Task 4: NSIS 完成页仅最小化与关闭（I003）RED → GREEN

**Files:**
- Modify: `electron/installer/installer.finishPage.test.ts`
- Modify: `electron/installer/installer.nsh`

- [x] **RED:** 将测试改为要求 `SC_MINIMIZE`/`WS_MINIMIZEBOX`/`SC_CLOSE`，并断言不包含 `SC_MAXIMIZE`、`WS_MAXIMIZEBOX`、`WS_THICKFRAME`；运行测试确认当前三按钮实现失败。
- [x] **GREEN:** 删除最大化/可调整大小样式与菜单启用；保留最小化和关闭，继续隐藏 Back/Cancel，保留 Finish/运行复选框和关闭 abort/quit 路径。
- [x] 清理 `StdUtils.TimerCreate`、计时器变量及 `$TEMP\\bilimi-finish-timer.log` 诊断写入；保留必要的句柄/菜单代码，不影响卸载页。
- [x] 运行安装器源码回归测试；若本机有 makensis，再做脚本编译检查。

### Task 5: 全量验证、Electron 验收、提交与打包

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-01-startup-bilibili-installer-responsiveness.md`
- Create: `.codex-artifacts/startup-*.png`, `.codex-artifacts/installer-finish-page.png`, 摘要日志（不提交无关临时文件）

- [x] 运行相关 Vitest、`npm test`、`npm run build`、`git diff --check`；任一失败停止提交。
- [ ] 开发版真实验收主窗口首帧、B 站首页优先、小咪出现前后鼠标移动/点击/滚动/最小化/恢复/关闭；保存截图和诊断摘要。代码/日志不能替代人工流畅性记录。
- [ ] 工作树只保留本主题文件，更新 I002/I003/I004 的代码位置、测试、界面验收和未验证条件。
- [ ] 在提交前逐条回读账本原文和索引，创建本轮唯一提交。
- [ ] 提交后执行 `npm run dist:win`，安装生成包，重复关键路径；完成页实际验证最小化、`×`、Finish、运行复选框，并保存安装截图。禁止执行 `npm run dist`、发布、推送、合并。
