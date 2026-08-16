# Organizing Scan Button Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“整理收藏 / 扫描概览”的已确认按钮、状态、批次设置、分区与跨区域同步规则完整写入唯一项目功能项目书，并留下可审计的原文账本。

**Architecture:** 本轮只修改 Git 跟踪的 Markdown 文档：账本保存不可改写的用户原话及逐项验收索引，项目书作为日常维护的唯一产品行为入口，计划保存文档变更的执行与验证方法。根据历史已确认设计和已定位的现有问题，项目书标明产品规则及与设计不一致待修复的行为，而不触碰 Electron 业务实现或 B 站数据。

**Tech Stack:** Markdown、Git、PowerShell、ripgrep。

---

## 范围与修改边界

- 工作树：`C:\Users\diqing\bilimi\.worktrees\project-book`，分支 `codex/project-book`。
- 修改：`docs/项目功能项目书.md`、`docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md`、本计划文件。
- 不修改：任何 `src/`、`electron/`、测试、Electron 应用数据、B 站数据，以及根目录未跟踪的 `docs/requirement-ledgers/2026-08-16-overview-recommendation-projection.md`。
- 修改前证据：`git status --short --branch` 仅输出 `## codex/project-book`；HEAD 为 `fcf5b9da fix: preserve initial favorite folder menu`；`git diff --check` 无输出。

### Task 1: 建立不可改写的需求账本

**Files:**
- Create: `docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md`

- [x] **Step 1: 按时间顺序写入本轮完整用户原话**

将 R001、R002、R003 原文写入“原文区（不可改写）”，其中 R001 保留“继续扫描 继续补取标签”“多批和单批”“采用标签消失之后怎么恢复”等精确措辞，R002 保留“用户收藏夹和工作夹做好分类”“之前对话新出现的bug”，R003 保留“开始”。

- [x] **Step 2: 建立确认清单和逐项索引**

在原文区之后，分别列出已确认、待用户决定、被后续明确替代和明确不做；逐项索引须覆盖扫描控制、标签循环、批次设置、来源分区、ready 批总览和推荐取消同步，并在每行给出原文编号、目标位置、显示/隐藏、状态变化、持久化/B 站边界、依赖、状态和验收证据。

- [x] **Step 3: 从头复读账本并核对索引未替代原文**

Run: `Get-Content -Raw docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md`

Expected: 原文区完整出现 R001–R003，索引表位于原文之后，所有已确认项都有 R 编号和验收方式；待用户决定为“无”。

### Task 2: 补全唯一项目功能项目书的第 5 节

**Files:**
- Modify: `docs/项目功能项目书.md:186-250`

- [x] **Step 1: 用扫描生命周期和身份分区替换高层扫描概览表**

将第 5.2 拆成“扫描概览分区、来源选择与扫描生命周期”：明示普通用户来源、已绑定工作夹、待重新备册/绑定工作夹的分类和来源选择禁令；逐项规定暂停、继续、从头重扫、直连继续/重扫、412 检测继续、冷却禁用、镜像重建重扫和结束整理。

- [x] **Step 2: 把标签补取和采用写成可逆状态机**

将第 5.3 写成按钮级状态表：运行、暂停、失败重补、可采用、已采用；明确 `采用当前标签 → 继续补取标签 → 新结果 → 再次采用` 循环，及重算范围、保留人工分类/已勾选推荐、无 B 站写入和失败保留状态。

- [x] **Step 3: 新增批次设置与本轮总览章节**

新增第 5.4“单批/多批、本轮总览与设置联动”：列出 500、1000、2000（推荐）、500–5000 自定义、无限制（实验），规定只影响下一轮；当前草稿不切分；单批隐藏选择器；多批切换不暂停补取；任一 ready/saved 批立刻进入部分汇总，未就绪批标记而不能遮挡。

- [x] **Step 4: 新增推荐取消与上方投影章节并后移后续编号**

新增第 5.5“推荐取消、上方收藏夹投影与归档预览”：规定真实 ID 和持久化结果先于 UI 投影，区分未备册本地规则的删除与已有远端实体仅取消本轮勾选，写明失败状态和幽灵卡片禁令；将原有推荐、归档预览、DeepSeek、执行章节顺次后移并修正交叉引用。

- [x] **Step 5: 在设置章节补上“整理收藏批次”行**

在第 8.1 增加设置行，引用 5.4，明确持久化范围与“只影响下一轮，当前草稿不切分、不重算”的边界。

### Task 3: 记录证据并验证文档

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md`
- Modify: `docs/superpowers/plans/2026-08-16-organizing-scan-button-contracts.md`

- [x] **Step 1: 将索引状态更新为文档已实施，并记录精确文档位置**

在账本逐项更新 I-01 至 I-06 的项目书章节、仅文档改动事实、文本检查结果和“真实 Electron 验收待未来代码任务完成”的边界；I-07 记录本轮 Git 验证与提交结果。

- [x] **Step 2: 运行 Markdown 和安全检查**

Run: `git diff --check`

Expected: 无输出。

Run: `rg -n "^### 5\\.(2|3|4|5)|继续扫描|继续补取标签|采用当前标签|整理收藏批次|待重新备册/绑定|幽灵卡片" docs/项目功能项目书.md`

Expected: 每个标题和关键规则均至少命中一次。

Run: `rg -n -i "(api[_-]?key|secret|token|password)\\s*[:=]\\s*[^` ]+" docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md docs/superpowers/plans/2026-08-16-organizing-scan-button-contracts.md`

Expected: 无输出；文档不含凭据值。

- [x] **Step 3: 检查差异范围与提交**

Run: `git status --short && git diff --stat && git diff --check`

Expected: 只有三个允许的 Markdown 文件；无格式错误。

Run: `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-organizing-scan-button-contracts.md docs/superpowers/plans/2026-08-16-organizing-scan-button-contracts.md && git commit -m "docs: specify organizing scan contracts"`

Expected: 在 `codex/project-book` 产生一条本地提交；不 merge、不 push、不改根目录工作树。

## 自检结果（计划形成时）

- 需求覆盖：Task 2 的步骤 1 覆盖 I-01/I-04，步骤 2 覆盖 I-02，步骤 3 与 5 覆盖 I-03/I-05，步骤 4 覆盖 I-06；Task 1 和 Task 3 覆盖 R003 的审计与授权边界。
- 占位符检查：本计划没有 `TODO`、`TBD`、“稍后实现”或“类似 Task N”占位文字；所有文档变更和验证命令均给出精确文件路径或命令。
- 一致性检查：项目书的第 5.2 至 5.5 为本轮新增/替换范围；设置行交叉引用第 5.4；不在本轮假称任何 Electron 或 B 站真实流程已经验收。
