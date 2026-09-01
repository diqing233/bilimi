# 启动 B 站优先、鼠标响应与安装完成页关闭实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主窗口/B 站首页优先保持流畅，并修复 Windows NSIS 完成页标题栏 `×` 无响应，同时保护既有功能。

**Architecture:** 启动流程采用显式阶段 gate：主窗口交互先行，B 站首页首次加载独立收束后才释放小咪后台创建；小咪 renderer、原生修补和鼠标恢复继续分段、可取消、隐藏透明。NSIS 完成页在 SHOW 回调中同时启用内部 Cancel/Abort 通道和系统菜单 `SC_CLOSE`，不改变其它页面。

**Tech Stack:** Electron 主进程/renderer、React、TypeScript、Vitest、NSIS/electron-builder。

---

### Task 1: 更新项目书与本轮账本

**Files:**
- Modify: `docs/项目功能项目书.md`（第 1.1 节、首页 WebView 延后挂载、Windows 安装向导完成页条款）
- Create: `docs/requirement-ledgers/2026-09-01-startup-bilibili-installer-responsiveness.md`

- [x] **Step 1: 记录本轮用户原文和索引**

  已逐字记录 R001-R005，索引 I002/I003 写明显示条件、状态、持久化、B 站边界和验收证据要求。

- [x] **Step 2: 更新启动顺序规范**

  明确“主窗口 shell/交互 → B 站首页首次加载或失败收束 → 小咪隐藏预热 → renderer/native polish → showInactive → 鼠标恢复轮询”，并说明网络失败不阻塞主窗口、所有阶段可取消、禁止忙碌光标/整窗遮罩。

- [x] **Step 3: 自检项目书与账本一致性**

  仅涉及 I002/I003，保留现有网页 URL/Cookie/代理、标签、收藏夹、DeepSeek、转写、删除确认和视频同步边界。

### Task 2: I002 启动阶段回归测试（先红）

**Files:**
- Modify: `electron/main/index.mainWindowPetStartup.test.ts`
- Create/Modify: 启动 gate/idle 调度测试文件（沿用现有测试结构）

- [x] **Step 1: 增加 B 站加载 settled 后才 wake 的失败测试**

  断言首页 guest 的首次挂载/刷新信号独立于 `main-window:interactive-ready`，只有 `dom-ready`、`did-stop-loading` 或 `did-fail-load` 收束后才调用小咪 wake；网络未完成时主窗口仍可操作。

- [x] **Step 2: 增加取消和响应保护测试**

  断言关闭/取消会停止未执行的小咪任务；鼠标恢复轮询只在小咪可见后启动；空闲任务不会以 `setTimeout(0)` 立即抢占交互阶段。

- [x] **Step 3: 运行测试确认按预期失败**

  运行 `npx vitest run electron/main/index.mainWindowPetStartup.test.ts`，确认新断言因当前实现顺序/调度器不满足而失败，失败原因必须指向行为而非测试语法。

### Task 3: I002 最小实现与验证

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/floatingSealIdleTask.ts`
- Modify: 必要的小咪调度/原生修补模块及其测试

- [x] **Step 1: 拆分首页加载与交互通知**

  主窗口交互通知只释放“可后台调度”资格；首页 B 站 guest 在独立后续任务中优先挂载/刷新，并向主进程发送可取消的首次加载 settled/failed 信号。

- [x] **Step 2: 实现可取消的后台 gate**

  将小咪自动 wake 放到 B 站首次加载阶段收束之后的低优先级任务；阶段之间让出事件循环，超出响应预算或应用关闭时延后/取消，不阻塞主窗口。保留显式唤醒路径。

- [x] **Step 3: 保持小咪显示与鼠标语义**

  维持隐藏、透明、点击穿透、renderer ready、白条/DWM/标题栏修补、`showInactive()` 顺序；鼠标恢复轮询仍只在可见后启动，不加入忙碌光标或遮罩。

- [x] **Step 4: 运行 I002 测试并复核日志**

  运行相关 Vitest；使用 `BILIMI_STARTUP_DIAGNOSTICS=1 npm run dev` 检查事件顺序和阶段耗时，确认主窗口交互不等待 B 站网络或小咪。

### Task 4: I003 完成页关闭回归测试与实现

**Files:**
- Modify: `electron/installer/installer.finishPage.test.ts`
- Modify: `electron/installer/installer.nsh`

- [x] **Step 1: 增加失败断言**

  断言 `bilimiFinishPageShow` 显式包含 `EnableWindow $mui.Button.Cancel 1`、`SC_CLOSE` 菜单启用和 Back/Cancel 隐藏；断言不改变其它页面。

- [x] **Step 2: 运行测试确认失败**

  运行 `npx vitest run electron/installer/installer.finishPage.test.ts`，在补实现前确认缺少内部 Cancel 启用断言。

- [x] **Step 3: 最小修复**

  在 `bilimiFinishPageShow` 中重新启用 `$mui.Button.Cancel`，再启用系统菜单 `SC_CLOSE`；保持 Finish 和运行复选框原行为。

- [x] **Step 4: 运行 NSIS 源码回归测试**

  确认测试通过且 Back/Cancel 仍隐藏。

### Task 5: 全量验证、真实验收、提交与打包

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-01-startup-bilibili-installer-responsiveness.md`（填写验收证据）
- Create: `.codex-artifacts/` 下的启动/安装验收截图与摘要日志

- [x] **Step 1: 运行测试与构建**

  依次运行相关 Vitest、`npm test`、`npm run build`、`git diff --check`，任何失败都停止提交并报告。

- [x] **Step 2: 开发版真实验收（部分；安装版待打包）**

  启动开发版，验证首帧后鼠标移动/点击/滚动/最小化/恢复/关闭；确认 B 站首页优先加载，小咪后台出现且不阻塞；保存截图和诊断摘要。

- [x] **Step 3: 提交前账本逐项回读（I003 安装版证据待补）**

  为 I002/I003 分别填写代码位置、自动化测试、真实界面/安装验收和未验证条件；确认未混入其它主题。

- [x] **Step 4: 创建本轮唯一提交**

  仅提交项目书、账本、计划、I002/I003 代码与测试及验收证据，提交信息使用 `fix: prioritize bilibili startup and enable installer close`。

- [ ] **Step 5: 构建 Windows 安装包**

  在工作树干净且提交成功后运行 `npm run dist:win`；安装生成的 NSIS 包，实际验证完成页最小化、最大化、`×`、Finish 与运行复选框，并记录结果。
