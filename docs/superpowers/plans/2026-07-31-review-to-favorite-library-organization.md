# 批阅入库与所选视频整理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复批阅结果进入收藏库的数据断链，并让收藏库选中视频复用现有归档预览完成独立整理，同时保持页面交互、DeepSeek、同步和现有草稿不回归。

**Architecture:** 批阅成功后由渲染器提交经过主进程校验的最小收藏库命令集合：视频元数据、来源/远端观察、位置和事件；仓库 revision 通过现有订阅刷新收藏库。资料补全采用非破坏合并，识别数字 AID 占位标题。所选整理创建独立 scope 的归档草稿，复用现有预览分类/DeepSeek/撤销/保存组件，不启动全库扫描。

**Tech Stack:** React 19, TypeScript, Electron IPC, Vitest, Testing Library, Bilibili session/page bridge.

---

### Task 1: 修复占位视频资料合并并建立回归测试

**Files:**
- Modify: `src/shared/favoriteRepository.ts`
- Test: `src/shared/favoriteRepository.test.ts`

- [ ] **Step 1: 写红灯测试**：覆盖 `Video 123`、`Video + ID` 作为稀疏扫描输入时不能覆盖已有完整标题、UP、简介、封面和标签；完整输入仍可补充旧记录；空标签不能清除已确认标签。
- [ ] **Step 2: 运行 RED**：`node_modules\.bin\vitest.cmd run src/shared/favoriteRepository.test.ts -t "placeholder|sparse|metadata"`。预期数字 AID 占位标题测试失败。
- [ ] **Step 3: 最小实现**：集中更新占位识别与 stale 判断，继续使用现有 `mergeFavoriteRepositoryVideo`，不改变命令校验或快照格式。
- [ ] **Step 4: 运行 GREEN**：重跑 Step 2，并检查 `git diff --check`。

### Task 2: 批阅成功后写入收藏库

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/global.d.ts`
- Test: 当前批阅动作测试文件
- Test: `electron/main/favoriteRepositoryIpc.test.ts`（仅在命令边界需要补测试时）

- [ ] **Step 1: 写红灯测试**：模拟收藏 API 确认成功，断言提交 `upsert-video`、来源/远端观察、`set-favorite-position` 和收藏事件；失败或仅页面点击时不伪造已同步；提交使用冻结 AID、简介和页面标签。
- [ ] **Step 2: 运行 RED**：`node_modules\.bin\vitest.cmd run src/renderer/src/features/actions/actionExecutor.test.ts`，确认收藏库命令断言失败。
- [ ] **Step 3: 提取窄桥接函数**：只规范化 AID、保留非空元数据、映射 bilimi 目标到 `bilimi-logical:*`、提交远端观察和 `record-favorite-event`，不把整份 preferences 或 DOM 传给仓库。
- [ ] **Step 4: 接入成功路径**：只在结果可靠确认时调用；普通点赞/投币不写收藏关系。入库失败不回滚已成功的 B 站动作，改为待核对并记录诊断。
- [ ] **Step 5: 运行 GREEN**：重跑 focused tests 及 `electron/main/favoriteRepositoryIpc.test.ts`。

### Task 3: 让 DeepSeek 二审与页面生命周期解耦

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/features/actions/actionExecutor.ts`（只在确认需要调整兜底顺序时）
- Modify: `src/renderer/src/features/actions/pageAutomation.ts` / `favoriteApiAutomation.ts`（只修复会滚动 body 或扰动播放器的收藏兜底）
- Test: `src/renderer/src/features/actions/actionExecutor.test.ts`

- [ ] **Step 1: 写生命周期红灯测试**：二审 promise 未完成时切换/关闭当前视频，断言仍以冻结 AID 完成本地分类更新，不调用新页面 DOM；API 收藏成功时不走视觉滚动兜底。
- [ ] **Step 2: 运行 RED**：运行相关 focused tests，记录当前依赖 active tab 或视觉兜底的失败。
- [ ] **Step 3: 最小实现**：冻结上下文、账号、AID、原始目标和二审 token；结果通过收藏库命令/既有同步队列更新。API-assisted 成功后阻止滚动整个页面的兜底；只有明确页面点击模式允许有限兜底。
- [ ] **Step 4: 运行 GREEN**：确认 `赏/赐/藏`、弹幕直提交流程和页面收藏 fallback 测试不回归。

### Task 4: 详情刷新、简介标签显示与标签分段补全

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryDetail.tsx`
- Modify: `electron/main/favoriteLibraryCommands.ts`
- Modify: `electron/main/index.ts`（若需要拆出只读详情/标签补全函数）
- Test: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Test: `electron/main/favoriteLibraryCommands.test.ts`

- [ ] **Step 1: 写红灯测试**：刷新后的标题/简介/标签退出重进仍存在；空标签不会覆盖已有标签；详情显示“简介：”；数字 AID 占位记录触发补全；失败显示可重试状态。
- [ ] **Step 2: 运行 RED**：`node_modules\.bin\vitest.cmd run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx electron/main/favoriteLibraryCommands.test.ts`。
- [ ] **Step 3: 复用刷新持久化服务**：保持主进程串行、小批次提交；标签补全是缺失资料的可选阶段，基本详情接口返回空数组时不清除仓库标签；完成后通过 revision 订阅刷新页面。
- [ ] **Step 4: 运行 GREEN**：重跑 Step 2，并核对分页缓存失效测试。

### Task 5: 收藏库所选视频独立整理入口

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryToolbar.tsx`
- Modify: 现有归档预览入口及相关 IPC/preload/global 类型
- Test: 收藏库 UI、归档预览和草稿隔离测试

- [ ] **Step 1: 写红灯测试**：覆盖选中入口、保护覆盖、只传选中 AID、全库草稿不变、用户收藏夹追加/bilimi 替换、缺失资料先补全再进入预览。
- [ ] **Step 2: 运行 RED**：运行收藏库和归档预览 focused tests，确认当前没有入口/独立 scope。
- [ ] **Step 3: 创建独立 scope 适配器**：把选中视频和当前归属转换为现有归档预览数据模型；不复制 DeepSeek、推荐收藏夹、撤销/恢复或保存实现；独立草稿 ID 不覆盖全库 workspace。
- [ ] **Step 4: 接入保存语义**：仅替换 bilimi 逻辑归属，追加用户收藏夹关系；先提交本地 revision，再沿现有同步队列执行远端差异；取消不改变正式仓库。
- [ ] **Step 5: 运行 GREEN**：确认推荐收藏夹、DeepSeek 整理、撤销恢复和全库草稿回归。

### Task 6: 分层验证和真实 Electron 验收

**Files:** Verify only files changed by Tasks 1–5.

- [ ] **Step 1: 运行相关测试集**：`node_modules\.bin\vitest.cmd run src/shared/favoriteRepository.test.ts electron/main/favoriteLibraryCommands.test.ts electron/main/favoriteRepositoryIpc.test.ts src/renderer/src/features/actions/actionExecutor.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`。
- [ ] **Step 2: 类型与差异检查**：`node_modules\.bin\tsc.cmd --noEmit`; `git diff --check`; `git status --short`。记录脏树既有类型失败，不归因于本次改动。
- [ ] **Step 3: 真实 Electron 验收**：验证批阅收藏、关闭/切换视频、二审后台完成、数量/来源时间、刷新重进、标签/简介持久化、所选整理、推荐收藏夹、撤销恢复和鼠标/窗口控制；不以 jsdom 或任务总耗时宣称不卡顿。
- [ ] **Step 4: 只提交本主题文件**：检查 staged 列表，不包含用户已有四个脏文件；不打包、不 push。
