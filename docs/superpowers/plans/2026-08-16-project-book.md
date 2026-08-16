# 全项目功能项目书 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于历史确认设计、历史正常版本和已验证用户流程，创建一份从批阅到设置的单文件全项目功能项目书，并明确当前无法证实或与代码不一致的行为。

**Architecture:** 产品书只有 `docs/项目功能项目书.md` 一个日常维护入口，按用户能看到的页面和按钮组织；每项写明目的、可见/不可用条件、操作结果、持久化与 B 站副作用、失败表现、不可影响的流程和证据。需求账本保留用户完整原文，实施计划只用于本轮审计，不成为日常产品规范。

**Tech Stack:** Git 历史、Markdown、TypeScript/React/Electron 源码与 Vitest 测试作为只读证据。

---

### Task 1: 固定本轮范围、基线与文档来源

**Files:**
- Create: `docs/requirement-ledgers/2026-08-16-project-book.md`
- Modify: `docs/requirement-ledgers/2026-08-16-project-book.md`
- Create: `docs/superpowers/plans/2026-08-16-project-book.md`

- [x] **Step 1: 重新读取完整原文账本与索引。**

  Run: `Get-Content -Raw docs/requirement-ledgers/2026-08-16-project-book.md`

  Expected: R001-R007 原文完整存在；索引将项目书、设计基准、单文件边界和实施授权分别对应到原文编号。

- [x] **Step 2: 记录隔离工作树基线和全量测试事实。**

  Run: `git status --short --branch; git log -1 --oneline; npm test`

  Expected: 分支为 `codex/project-book`，基线为 `8baa0c11`；全量测试的 7 项既有失败作为项目书审计证据记录，不纳入本轮代码修复。

- [x] **Step 3: 建立可追溯的证据池。**

  Run: `rg --files docs/superpowers/specs docs/requirement-ledgers src/renderer/src electron/main | Sort-Object`

  Expected: 能按“批阅、整理收藏、收藏库/处理记录、DeepSeek、笔记/转写、设置、窗口与宠物”定位历史设计、用户账本、UI 组件、主进程命令和测试。

### Task 2: 盘点用户可见的页面、入口和按钮

**Files:**
- Modify: `docs/项目功能项目书.md`
- Read: `src/renderer/src/App.tsx`
- Read: `src/renderer/src/features/assistant/AssistantSidebar.tsx`
- Read: `src/renderer/src/features/assistant/FloatingAssistantApp.tsx`
- Read: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx`
- Read: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Read: `src/renderer/src/features/notes/VideoNotesPanel.tsx`

- [x] **Step 1: 从真实渲染入口提取页面章节。**

  Run: `rg -n "aria-label=|<h[1-6]|button|role=\"tab\"|Settings|批阅|整理收藏|收藏库|笔记" src/renderer/src/App.tsx src/renderer/src/features -g '*.tsx'`

  Expected: 项目书章节与实际用户界面对应，至少覆盖应用窗口/网页标签、助手与批阅、整理收藏、收藏库、笔记与档案、设置、悬浮宠物。

- [x] **Step 2: 为每个页面写“功能清单”，不臆造行为。**

  Content: 每项暂只列页面、按钮或控件名称、目的、证据路径和核验状态；无法由代码或历史资料确认的内容标为“待核对”。

- [x] **Step 3: 检查页面清单没有以技术模块取代用户入口。**

  Run: `rg -n "^## |^### " docs/项目功能项目书.md`

  Expected: 标题均可由用户在页面上定位，不以内部服务或 TypeScript 类型作为章节名。

### Task 3: 从历史证据还原每项行为与边界

**Files:**
- Modify: `docs/项目功能项目书.md`
- Read: `docs/superpowers/specs/*.md`
- Read: `docs/requirement-ledgers/*.md`
- Read: `docs/old-favorites-acceptance.md`
- Read: `README.md`
- Read: `git log --all --oneline -- <relevant path>`

- [x] **Step 1: 批阅与 B 站写入。**

  Content: 写明批阅入口、操作按钮、收藏夹可用性、备册/绑定前提、DeepSeek 二判、B 站成功/失败/待核对以及收藏库记录边界。

- [x] **Step 2: 整理收藏全流程。**

  Content: 写明开始、关闭、草稿重开、确认结束、增量扫描、批次、标签补取、采用当前标签、推荐收藏夹、归档预览、保存、同步、暂停/恢复和失败状态；每个远端副作用单独说明。

- [x] **Step 3: 收藏库、详情、历史、笔记、档案与转写。**

  Content: 写明列表/筛选/详情、处理记录、批量操作、回到视频、笔记保存、转写、摘要、导出与失败边界。

- [x] **Step 4: 设置、数据、窗口、网页标签和悬浮宠物。**

  Content: 写明设置项的保存范围、账号和本地数据边界、迁移/清理确认、网页标签行为、窗口控制与宠物交互；敏感或无法从历史证据确定的行为标为待核对。

- [x] **Step 5: 为每个重要操作补齐固定字段。**

  Content: `作用`、`何时显示/可点`、`点击后结果`、`不同情况下`、`不会影响`、`数据与 B 站副作用`、`失败时`、`设计依据与当前核验状态`。没有证据的字段明确写“待核对”，不填充推测。

### Task 4: 记录当前不一致与受保护流程

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-16-project-book.md`

- [x] **Step 1: 单独列出“当前待核对/不一致”，不改写成设计。**

  Content: 记录基线全量测试的 7 项失败：两项样式断言、三项整理收藏确认页断言、两项删除状态投影断言；附测试路径与事实描述，不推断根因。

- [x] **Step 2: 列出下一次改动前必须回读的受保护流程。**

  Content: 至少包括关闭后重开草稿、确认结束后的增量扫描、多批次标签与总览、推荐勾选/删除、收藏库/同步边界、DeepSeek 整理、数据清理与设置保存。

- [x] **Step 3: 更新账本索引的逐项证据。**

  Content: 为 R001-R006 写入项目书实际路径、资料审计范围、Markdown 验证结果、全量测试基线失败和无 Electron 实机操作的条件；R007 写入隔离工作树与本地提交受基线失败阻止的事实。

### Task 5: 验证、交付与提交门槛

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-16-project-book.md`

- [x] **Step 1: 执行结构和敏感信息检查。**

  Run: `rg -n "TODO|TBD|待补|待定" docs/项目功能项目书.md; rg -n "AKIA|sk-[A-Za-z0-9]|Bearer [A-Za-z0-9]" docs/项目功能项目书.md`

  Expected: 只允许明确的“待核对”状态；不得留下占位符、凭据或用户数据。

- [x] **Step 2: 执行 Markdown 与工作树检查。**

  Run: `git diff --check; git diff --stat; git status --short`

  Expected: 只有项目书、项目书账本和本轮计划改动；无空白错误。

- [x] **Step 3: 对 R001-R007 逐项回读并记录结果。**

  Content: 确认项目书是一份单文件、覆盖全项目页面/按钮、以历史与验证流程为依据、没有改动业务代码或远端数据；基线测试失败使本轮不创建本地提交。

- [x] **Step 4: 不提交。**

  Reason: 用户选择在 7 项既有基线测试失败的前提下继续文档审计；项目规则禁止在测试失败时提交。保留隔离 worktree 和文档改动，交付明确的待修复基线列表。
