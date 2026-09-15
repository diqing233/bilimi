# 同步反馈中文化与恢复进度实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任何 bilimi 自己呈现的用户反馈都不泄露英文技术异常；恢复已在执行的收藏同步时立即呈现现有真实进度。

**Architecture:** 在渲染端增加一个仅负责“用户可见异常”的格式化器：保留现有中文业务提示，识别 IPC 包装、B 站目录、网络及已知运行时错误并映射为可执行中文；未知英文底层错误只显示调用方提供的中文兜底。各 UI 反馈出口复用它，不改 IPC、工作区持久化和 B 站操作。恢复草稿后依照刚读取到的权威 workspace snapshot 选择向导页面，继续使用既有活动工作区快照刷新及 `executionProgress`。

**Tech Stack:** TypeScript、React 19、Vitest、Testing Library、Electron IPC。

---

## 范围与原文核对

### 已确认（按原文顺序）

1. **R001 / I001**：断网同步的确认执行提示不得展示 `Error invoking remote method`、英文异常或内部方法名；审计并消除 bilimi 自行渲染的英文错误、Toast、空态、加载态与按钮/弹窗提示。
2. **R001 / I002**：停止后选择“恢复草稿”，如果权威快照已是 `executing`，立即打开确认执行步骤并显示“正在同步到 B 站”和已有进度条。

### 待用户决定

无。

### 被后续替代 / 明确不做

无。R001 明确不翻译 B 站网页正文、源代码/日志/IPC 标识、测试断言，以及模型、品牌、API 专名本身；不添加轮询、写入或同步。

## 文件边界

- Create: `src/renderer/src/features/assistant/userVisibleErrorMessage.ts`、`src/renderer/src/features/assistant/userVisibleErrorMessage.test.ts`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`、`src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`
- Modify: 已确认包含 raw `error.message` 的渲染端用户反馈出口（重点：`useOldFavoriteWorkspace.ts`、`FavoriteLedgerOverview.tsx`、`FloatingAssistantApp.tsx`、`PalaceMaidPetApp.tsx`、`TranscriptionModelSettings.tsx`、`LocalDataSettings.tsx`、`BiliWebview.tsx`、`VideoNotesPanel.tsx`、`VideoNoteArchivePanel.tsx`、`App.tsx`、`favoriteLedgerApi.ts`）；只替换用户可见文本，不改协议、日志或业务逻辑。
- Modify: `docs/requirement-ledgers/2026-09-15-sync-feedback-chinese-and-resume-progress.md`，逐项追加实际代码和验证证据。

### Task 1: 用户可见异常格式化器（R001 / I001）

**Files:**

- Create: `src/renderer/src/features/assistant/userVisibleErrorMessage.ts`
- Test: `src/renderer/src/features/assistant/userVisibleErrorMessage.test.ts`

- [ ] **Step 1: 写入失败测试。** 覆盖 IPC 包装的 `Favorite repository remote folder inventory is unavailable.` 映射为“无法读取 B 站收藏夹列表，请检查网络并保持已登录的 B 站页面打开后重试。”；网络、HTML 响应和未知英文异常回退为调用方中文文案；已有中文业务异常原样保留。
- [ ] **Step 2: 运行定向测试并确认 RED。**

  Run: `npm test -- src/renderer/src/features/assistant/userVisibleErrorMessage.test.ts`

  Expected: FAIL，因为格式化器尚不存在。

- [ ] **Step 3: 实现最小格式化器。** 剥离 Electron IPC 前缀，按稳定错误标识映射可操作中文；如果消息为中文则保留；若消息仍有拉丁文字/不可读技术内容则一律返回调用域 fallback，绝不回显原文。
- [x] **Step 4: 重跑定向测试并确认 GREEN。**

  Run: `npm test -- src/renderer/src/features/assistant/userVisibleErrorMessage.test.ts`

  Expected: PASS。

### Task 2: 修复确认同步与恢复导航（R001 / I001、I002）

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 1: 写入两个失败测试。**
  1. 在预检 IPC 拒绝 `Error invoking remote method 'old-favorite-workspace-v1:bilibili execution preflight': Error: Favorite repository remote folder inventory is unavailable.` 时，确认卡片只显示目标中文提示，且不含 `Error invoking remote method`。
  2. 恢复草稿命令成功、紧接的强制 refresh 返回 `executing` 且有 1/3 执行进度时，向导的“确认执行”是当前步骤并存在名为“正在同步到 B 站”的进度条。
- [ ] **Step 2: 运行定向测试并确认 RED。**

  Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: 新增断言失败：前者泄露 IPC 文本，后者停在扫描概览。

- [x] **Step 3: 最小实现。** 所有本组件 confirmation/scan 异常出口使用格式化器及相应中文 fallback；恢复决定后以真实 snapshot 映射 `scanning/previewing → scan`、`frozen/executing/reconciling/completed → confirm`。不得调用任何新的同步、远端读取或定时器。

  实施澄清：R001 只要求已经执行时进入确认执行并展示真实进度。`previewing → scan` 保留旧版“恢复草稿”落在扫描概览的行为，避免在本轮改变可编辑草稿的入口；只有远端执行及其后续状态需要绕开扫描概览。
- [x] **Step 4: 重跑组件测试并确认 GREEN。**

  Run: `npm test -- src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

  Expected: PASS。

### Task 3: 全局渲染端反馈出口审计与中文化（R001 / I001）

**Files:**

- Modify: 本计划“文件边界”中列出的各反馈组件。
- Test: 各组件既有 Vitest 测试；需要时添加 formatter 调用的回归断言。

- [ ] **Step 1: 用静态搜索列出非测试源码的用户输出。** 搜索 `error.message`、`String(error)`、`errorDescription` 和英文 fallback；排除日志、IPC 通道、网页自动化脚本及显示在 B 站网页中的文本。
- [ ] **Step 2: 逐个替换实际用户出口。** 传递与当前操作一致的中文 fallback，保留原有中文错误及数据状态；对 Electron `did-fail-load` 的英文描述，显示中文网络/页面加载说明和错误码而非 Chromium 英文原因。
- [x] **Step 3: 对每个被触及组件运行其现有定向测试。**

  Run: `npm test -- <对应测试文件>`

  Expected: PASS；如发现英文直接渲染，补充 formatter 回归用例后再修复。

- [x] **Step 4: 静态复核。**

  Run: `rg -n --glob '*.{ts,tsx}' --glob '!*.test.*' --glob '!*.spec.*' '(error\\.message|String\\(error\\)|errorDescription)' src/renderer/src`

  Expected: 每个剩余命中都不是用户文本，或已在格式化器/只作内部错误分类使用。

### Task 4: 全量验证、账本证据与提交（R001 / I001、I002）

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-15-sync-feedback-chinese-and-resume-progress.md`

- [x] **Step 1: 回读账本原文区与索引，逐项记录实际代码位置、测试输出及真实 Electron 待验收条件。**
- [x] **Step 2: 静态和自动化验证。**

  Run: `git diff --check; npm test; npm run build`

  Expected: 退出码 0。

- [x] **Step 3: 运行开发版和预览版关键路径。** 开发版与预览版均已启动 Electron。断网预检与正在执行恢复快照由组件测试模拟验证；桌面自动化通道在本机返回认证错误，未对真实 B 站账户执行写入或同步，真实界面验收保留为待验证条件。
- [ ] **Step 4: 最终工作树检查与本地提交。**

  Run: `git status --short; git diff --stat; git diff --check`

  Expected: 只包含本轮代码、测试、账本和计划。随后在本地 `main` 创建一次本轮提交；不 push、不打包。

## 风险与回归保护

- 格式化仅改变用户文本，保持现有业务状态、请求时序、持久化和 B 站远端副作用不变。
- 恢复导航只读取已得到的 snapshot，不发起额外 refresh；活动状态的既有 4 秒快照更新继续负责更新进度。
- 受保护回归：备册、扫描、暂停/恢复、确认同步、DeepSeek、转写、札记、收藏库删除和 B 站加载错误。
