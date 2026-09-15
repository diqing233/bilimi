# 收藏夹远端核验、下载估算与 GPU 提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同账号跨设备时的收藏夹状态核验低频且可信，同时稳定模型下载估算文本并修正 GPU 检测提示。

**Architecture:** 收藏夹目录读取分为“登录/用户刷新/备册预检”的明确入口和只读取本地快照的普通状态入口；目录一次异常性地丢失全部正式绑定时作为不可确认观察，不改写正式绑定。下载速度使用主进程时间窗口的平滑值；GPU 提示以“候选模型是否已经是当前模型”为显示前提。

**Tech Stack:** Electron、React、TypeScript、Vitest。

---

### Task 1: 为远端目录不可信观察建立回归测试

**Files:**
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/shared/types.ts`

- [x] **Step 1: 写失败测试**

为已正式绑定两个远端 ID、但目录返回空列表的场景断言：状态为不可确认、没有 `unboundLedgerIds`、返回的规则仍保留正式绑定。为普通 snapshot 重复读取断言不触发额外目录脚本。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx`

Expected: 新增断言因当前把空目录视作 `verified: true` 而失败。

- [x] **Step 3: 实现最小远端观察状态**

在 `FavoriteLedgerStatus` 增加只读 `remoteDirectoryState?: 'verified' | 'uncertain'`。目录脚本在本地存在一个或多个正式远端绑定、但当前目录缺失全部这些 ID 时返回 `uncertain`，并返回原绑定规则、空缺失/未绑定清单与明确消息；仍允许“目录中还存在其他正式绑定、只缺少部分 ID”的普通已验证未绑定结果。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/App.test.tsx`

Expected: PASS。

### Task 2: 限定收藏夹目录请求的入口与频率

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/App.test.tsx`
- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Modify: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`

- [x] **Step 1: 写失败测试**

断言：账号首次识别后只安排一次合并目录发现；普通 assistant snapshot 仅返回已有状态；用户收藏页刷新仍能安排一次发现；备册完成不再自动启动通用目录发现；不可确认状态显示“B站收藏夹目录暂无法确认”且不允许直接执行 B 站备册写入。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: FAIL，因为 snapshot 当前仍可能直接读取远端，备册异常结果仍会触发后置发现。

- [x] **Step 3: 实现按账号单飞和受限入口**

在 `App.tsx` 中维护单个按账号的目录读取 promise；登录/账号切换后安排一次发现，收藏页用户刷新以及已确认人工变动在页面稳定后请求一次，所有同账号请求合并。`snapshot` 不再直接请求目录。备册前置核验使用同一 promise；若是 `uncertain`，停止 B 站写入并显示可重试的不可确认信息。备册结束只发布该事务已有的可信结果或缓存结果，不启动泛化的 `readRemoteFavoriteDiscovery`。

- [x] **Step 4: 连接不可确认 UI 状态**

将目录不可确认状态由 `App.tsx` 经 assistant snapshot 传入掌库；已绑定卡片和汇总显示“B站收藏夹目录暂无法确认”，不伪装为“已备册”或“未绑定”，保留用户在 B 站页刷新后重新核验的路径。

- [x] **Step 5: 运行测试确认通过**

Run: `npm test -- src/renderer/src/App.test.tsx src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

Expected: PASS。

### Task 3: 稳定下载速度和预计剩余时间

**Files:**
- Modify: `electron/main/transcriptionModelIpc.test.ts`
- Modify: `electron/main/transcriptionModelIpc.ts`

- [x] **Step 1: 写失败测试**

模拟短间隔、突发字节的多个下载进度回调；断言 received bytes/percentage 每次仍发布，而 `bytesPerSecond` 与 `etaSeconds` 只按最小展示间隔重算，随后用较长窗口的累计字节更新。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- electron/main/transcriptionModelIpc.test.ts`

Expected: FAIL，因为当前每个回调重新计算并发布瞬时速度和 ETA。

- [x] **Step 3: 实现稳定估算发布**

在 IPC 下载会话保存上次估算采样时间、字节数和已稳定的速率；每个回调继续发布最新字节/百分比，只有达到约 750ms 的估算窗口才更新速率和 ETA，并对新窗口速率做平滑。下载阶段变更、取消、失败与来源字段保持现有语义。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- electron/main/transcriptionModelIpc.test.ts`

Expected: PASS。

### Task 4: 使 GPU 提示服从当前模型状态

**Files:**
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`
- Modify: `src/renderer/src/features/assistant/TranscriptionModelSettings.tsx`

- [x] **Step 1: 写失败测试**

对已安装但未设为当前的 faster-whisper 候选模型断言显示“设为当前模型后检测 GPU”，且没有“重新检测 GPU”；对当前 faster-whisper 模型保留“正在检测 NVIDIA GPU…”和重检按钮。

- [x] **Step 2: 运行失败测试**

Run: `npm test -- src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

Expected: FAIL，因为当前候选模型直接渲染 GPU 检测状态。

- [x] **Step 3: 实现最小渲染条件**

仅当 `candidate === selectedModelId` 时展示真实 GPU probe 结果及重检按钮；未当前的 installed faster-whisper 模型显示“设为当前模型后检测 GPU”。不改变设置当前模型后的 IPC 调用与检测时机。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- src/renderer/src/features/assistant/TranscriptionModelSettings.test.tsx`

Expected: PASS。

### Task 5: 完整回归、真实形态检查与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-09-15-backup-status-flicker.md`

- [x] **Step 1: 逐项回填账本索引**

按 `R001–R007` 逐项记录代码位置、自动化测试、开发版界面验收以及尚无法在离线环境验证的跨设备 B 站实际响应。

- [x] **Step 2: 运行完整验证**

Run: `npm test && npm run build && npm run dev && npm run preview`

Expected: 所有测试和构建退出码为 0；开发版/预览版可启动。

实际：`npm test` 于 2026-09-15 完成，260 个测试文件、4720 项测试通过；`npm run build` 成功；已运行的 `npm run dev` 进程存活；`npm run preview` 成功构建并启动 Electron。构建只出现既有的动态/静态导入分包警告。当前自动化环境无法取得可交互 Electron 窗口，因此鼠标、滚动、下载视觉稳定性及双设备 B 站流程仍待实机验收。

- [x] **Step 3: 检查工作树并提交**

Run: `git diff --check && git status --short && git diff --stat`

Expected: 仅本计划列出的文件和需求账本发生变更；随后创建一条本地提交。

实际：`git diff --check` 无错误；工作树仅含本计划的 15 个实现/测试文件及本需求账本、实施计划；随后在本地 `main` 创建单一提交，不推送。
