# 同步响应性与重复暂停/继续 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B 站同步执行区先于多批“已汇总”显示，长同步持续让出 Electron 事件循环，并让暂停/继续可以重复循环且不遗留禁用的“正在暂停…”。

**Architecture:** 主进程工作区快照是同步状态的唯一真相；渲染器只保存会随快照终态复位的“暂停请求尚未收束”临时态。同步服务继续串行执行、逐项 checkpoint 和投影，但在每项收束后显式让出主事件循环，再读取下一项状态。布局仅重排执行态内的两个投影，不触及计划、汇总或远端写入数据模型。

**Tech Stack:** TypeScript、React、Electron、Vitest。

---

## 需求对账

### 已确认（按原文顺序）

1. `R001`：执行态同步过程在“已汇总 N/M 批”前显示。
2. `R001`：长同步不能令鼠标和真实操作卡顿；项目书要有明确流畅性与 Electron 验收规则。
3. `R001`：暂停/继续可重复循环，继续后不保留禁用的`正在暂停…`。
4. `R003`：先更新项目书，再参照项目书和账本修改。

### 待用户决定

- 无。

### 被明确替代

- 无。

### 明确不做

- `R002`：不使用可视化辅助。
- 不改变 B 站远端请求内容、每项顺序、checkpoint 数据结构、同步计划、DeepSeek、扫描或收藏库保存语义。

## 文件职责与允许修改范围

- `docs/项目功能项目书.md`：同步位置、暂停状态机和流畅性最终产品契约。
- `docs/requirement-ledgers/2026-08-18-sync-responsiveness-pause-cycle.md`：原文、逐项证据和验收状态。
- `docs/superpowers/plans/2026-08-18-sync-responsiveness-pause-cycle.md`：本轮实施步骤。
- `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`：执行态布局和临时暂停请求态复位。
- `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`：布局顺序与两轮暂停/继续 UI 状态回归。
- `electron/main/favoriteRepositorySyncService.ts`：每项同步收束后的事件循环让步。
- `electron/main/favoriteRepositorySyncService.test.ts`：让步发生在一项结果已持久化/投影后、下一远端写入前的服务回归。

### Task 1: 写执行态布局与暂停状态红灯

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

- [x] **Step 1: 新增多批执行态的 DOM 顺序用例**

渲染`status: 'executing'`、`hasMultipleSegments: true`和有`overview`的快照，取得`正在同步到 B 站`进度块和`已汇总 1/2 批`状态节点，断言前者在文档顺序上位于后者之前。

```ts
expect(syncProgress.compareDocumentPosition(wholeRunSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
```

- [x] **Step 2: 新增一次完整暂停/继续状态转换用例**

从`executing`渲染，点击`暂停同步`并验证`正在暂停…`禁用；重渲染为`frozen`和`syncPaused: true`，验证`继续同步`可点击；点击继续并重渲染为新的`executing`快照，验证可点击`暂停同步`且没有`正在暂停…`。重复该循环一次，证明临时状态不会粘滞。

- [x] **Step 3: 运行红灯**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: 顺序断言失败，且继续后的按钮仍为禁用`正在暂停…`；其他现有测试继续通过。

### Task 2: 写同步事件循环让步红灯

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.test.ts`

- [x] **Step 1: 新增两项成功同步的可注入让步用例**

构造两个 append operation、`pacingMs: 0`和`yieldToEventLoop` spy。第二个 append 只有在首项已调用一次让步后才解析。执行完整计划，断言让步调用两次，第一次发生在首项成功 checkpoint/本地投影后、第二个远端 append 前。

```ts
const yieldToEventLoop = vi.fn().mockResolvedValue(undefined)
const service = new FavoriteRepositorySyncService({ repository, pageBridge, pacingMs: 0, yieldToEventLoop })
await expect(service.executeFrozenPlan('100', twoOperationPlan)).resolves.toMatchObject({ status: 'succeeded' })
expect(yieldToEventLoop).toHaveBeenCalledTimes(2)
```

- [x] **Step 2: 运行红灯**

Run: `npm test -- --run electron/main/favoriteRepositorySyncService.test.ts`

Expected: 新用例因构造选项不存在或让步调用为 0 失败；既有同步、失败、暂停与恢复用例继续通过。

### Task 3: 最小实现执行态投影与权威暂停复位

**Files:**
- Modify: `src/renderer/src/features/assistant/OldFavoriteConfirmationStep.tsx`

- [x] **Step 1: 将多批执行态的同步块和操作组移动到总览前**

保留标题/视图选择器与当前批摘要位置；将现有同步进度和两个执行态操作按钮直接置于它们之后，再渲染`OldFavoriteWholeRunOverview`。不改汇总组件本身。

- [x] **Step 2: 令`pauseRequested`跟随权威快照复位**

新增 effect：当工作区不再是`executing`，或`executionProgress.syncPaused === true`时调用`setPauseRequested(false)`。保留点击瞬间的禁用态；命令返回`false`或异常也立即复位。不要从渲染器推断已暂停或已继续。

- [x] **Step 3: 运行组件绿灯**

Run: `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`

Expected: 新布局和两次暂停/继续循环用例通过，既有确认执行、停止、失败、对账和本轮总览用例继续通过。

### Task 4: 最小实现主进程让步

**Files:**
- Modify: `electron/main/favoriteRepositorySyncService.ts`

- [x] **Step 1: 增加可注入`yieldToEventLoop`并提供生产默认值**

在服务 options 增加`yieldToEventLoop?: () => Promise<void>`；新增私有方法优先调用该依赖，默认以`setImmediate`包装 Promise。该方法只让出 macrotask，不改变`pacingMs`节流。

- [x] **Step 2: 每项远端结果收束后让步一次**

在成功路径完成结果 checkpoint 与`projectConfirmedOperation`后调用让步；在已记录失败/未知结果、准备停止或对账前也调用一次。让步后才进入下一轮或返回，保留当前请求完成后才识别暂停/结束的语义。

- [x] **Step 3: 运行服务绿灯**

Run: `npm test -- --run electron/main/favoriteRepositorySyncService.test.ts`

Expected: 新用例证明每项结果收束后让步；现有逐项 checkpoint、远端失败、暂停、结束、恢复和对账用例通过。

### Task 5: 集成验证、Electron 验收、对账与提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-18-sync-responsiveness-pause-cycle.md`
- Modify: `docs/superpowers/plans/2026-08-18-sync-responsiveness-pause-cycle.md`

- [x] **Step 1: 运行定向与全量验证**

Run each of:

- `npm test -- --run src/renderer/src/features/assistant/OldFavoriteConfirmationStep.test.tsx`
- `npm test -- --run electron/main/favoriteRepositorySyncService.test.ts`
- `npm test`
- `npm run build`
- `git diff --check`
- `git status --short`
- `git diff --stat`

Expected: 定向和全量测试、构建、差异空白检查均退出 0；若现有警告存在，记录其内容与是否导致失败。

- [ ] **Step 2: 在开发版做无真实 B 站副作用的真实交互验收**

启动开发版并使用本地模拟长计划。确认同步进度/按钮位于`已汇总`前；连续两轮执行暂停、等待已暂停、继续；同时验证鼠标移动、点击、滚动、窗口缩放、最小化、恢复和关闭有响应。截图或日志存入`.codex-artifacts/`。不得执行真实 B 站同步、修改真实账号或数据。2026-08-18：隔离 Electron 已启动，但“启动前权限检查”要求进入 Windows 网络权限流程，且项目无安全本地长同步模拟入口；为避免真实账号/B 站/权限副作用，本项保持未完成。

- [x] **Step 3: 写回账本证据并提交**

逐项更新 R001/R003 的代码位置、红绿命令输出、Electron 验收证据或无法安全验证的边界。只 stage 本计划列出的七个主题文件，创建一次本地提交：`fix: keep Bilibili sync responsive across pause cycles`。

## 自查

- R001 的布局、流畅性和暂停循环各有独立红绿测试与账本证据字段。
- `R002`只记录为不使用可视化辅助，不混入实现范围。
- 不改变远端 B 站请求或已保存的同步检查点语义；真实 Electron 性能验收仅使用安全的本地模拟计划。
