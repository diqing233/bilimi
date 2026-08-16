# Managed Library Full Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将唯一项目功能项目书中的掌库与收藏库补全为身份、状态、按钮、数量、数据边界和跨页面联动都可逐项验收的维护基准。

**Architecture:** 重写现有项目书的第 4、5.2、6 节，并在第 2、8、10 节补必要的交叉引用；所有页面从同一“本地身份 + 生命周期状态 + 有类型的数量口径”读取行为规则。原文账本保存用户文字和逐项证据，计划保存本次文档实施步骤；两者不是额外产品书。

**Tech Stack:** Markdown、Git、PowerShell、ripgrep、Vitest（回归验证）。

---

## 范围与修改边界

- 工作树：`C:\Users\diqing\bilimi\.worktrees\project-book`，分支 `codex/project-book`，基线 `8461756c`。
- 修改：`docs/项目功能项目书.md`、`docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md`、本计划文件。
- 不修改：`src/`、`electron/`、测试、Electron 应用数据、B 站数据和根目录未跟踪的其他主题账本。
- 设计依据：本账本 R001–R003、项目书既有第 4/5/6/8/10 节、`favoriteRepository*` 和 `OldFavorite*` 实现/测试的只读证据。

### Task 1: 建立原文账本与状态基线

**Files:**
- Create: `docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md`

- [x] **Step 1: 写入完整原文和截图上下文**

将 R001 `数量不为0呢，收藏夹未备册呢`、截图绝对路径与指向的旧第 5.2 行、R002 `你先把整个掌库按照这样详写，都太简略了，要考虑到各种细节情况`、R003 `开始` 按顺序写入原文区。

- [x] **Step 2: 写入确认清单和九项索引**

确认清单与 I-01 至 I-09 必须覆盖数量语义、未备册生命周期、规则页、规则分类、扫描联动、三栏窗口、详情与操作、跨页面边界、提交范围；每行写明原文编号、位置、显示/隐藏、状态、持久化/B 站、副作用边界、依赖、状态和验收证据。

- [x] **Step 3: 从头复读账本**

Run: `Get-Content -Raw docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md`

Expected: R001–R003 完整位于索引之前；已确认项与待决定项分开，待决定项为“无”。

### Task 2: 重写掌库规则页规范（项目书第 4 节）

**Files:**
- Modify: `docs/项目功能项目书.md:110-168`

- [x] **Step 1: 建立身份、数量与权威来源总表**

在第 4.1 写清普通 B 站来源、未保存草稿、已保存未备册、备册中、已绑定、待重新备册/绑定/对账及删除/失败状态；分别定义远端成员数、本地已分配数、本轮计划数和未知 `—`，规定数量 0/非 0 不改变身份。

- [x] **Step 2: 规定规则列表、详情编辑器和每个按钮**

为参与勾选、名称/详情、新建、保存、取消编辑、备册、重试、对账、删除模式、全选/取消全选、单项/批量删除和失败重试分别写显示条件、命令结果、持久化和不影响的对象。

- [x] **Step 3: 规定分类规则和重算边界**

逐项描述关键词、专属 UP、标签、DeepSeek、默认规则、空规则、同名、优先级、人工覆盖、标签未就绪和 AI 失败，写明系统重算和人工结果的优先级。

- [x] **Step 4: 写出备册/绑定状态机与删除矩阵**

把状态迁移、在途命令、容量、登录、远端未知、局部成功、取消、对账、未备册本地删除、已备册仅取消推荐和真实远端删除分开；明确何时可以写 B 站。

### Task 3: 细化扫描概览和收藏库（项目书第 5、6 节）

**Files:**
- Modify: `docs/项目功能项目书.md:186-324`

- [x] **Step 1: 将第 5.2 与第 4 节身份模型绑定**

写明扫描概览的用户来源、已绑定工作夹、待重新备册/绑定/对账工作夹和已保存未备册工作夹四区；未备册无远端数、不可选来源但可到备册/本地分类路径；记录当前 `isBilimiWorkFolder` 单布尔模型与设计不一致待修复。

- [x] **Step 2: 重写第 6.1 的三栏导航、查询和窗口生命周期**

明确每个导航组、数量标签、折叠/菜单、搜索/排序/筛选、分页/虚拟化、选中、缓存、重开、账号切换、加载/空/失败状态与性能上限。

- [x] **Step 3: 重写第 6.2 的详情、来源、归属与审计记录**

明确视频元信息、多个来源、本地意图/远端事实、状态、刷新、打开来源、完整处理记录、档案/转写关联、未知和旧数据缺失的展示。

- [x] **Step 4: 重写第 6.3 及新增操作/同步子节**

分别写复制、移动、仅本地删除、取消 B 站收藏、同步、采用 B 站位置、批量动作、跳过原因、确认、在途/暂停/继续、部分成功、失败/对账与结束的操作契约。

### Task 4: 补齐跨页面边界、证据与验证

**Files:**
- Modify: `docs/项目功能项目书.md:48-71, 330-405`
- Modify: `docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md`
- Modify: `docs/superpowers/plans/2026-08-16-managed-library-full-contract.md`

- [x] **Step 1: 更新第 2、8、10 节的必要交叉引用**

只补充掌库与批阅、整理收藏、设置、账号隔离、本地清理和受保护回归的精确边界；不重写无关的浏览、札记、DeepSeek 或小咪规则。

- [x] **Step 2: 记录逐项文档实施证据**

在账本 I-01 至 I-08 标注精确项目书章节、未修改生产代码、文档检查结果、完整自动化结果和仍待 Electron 验收；I-09 记录提交前 Git 检查。

- [x] **Step 3: 运行文档、安全和完整回归检查**

Run: `git diff --check`

Expected: 无输出。

Run: `rg -n "未备册|远端成员数|本地已分配数|本轮计划数|待重新备册|对账|取消 B 站收藏|批量操作|账号隔离" docs/项目功能项目书.md`

Expected: 每项术语和对应契约至少命中一次。

Run: `rg -n -i "(api[_-]?key|secret|token|password)\\s*[:=]\\s*[^` ]+" docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md docs/superpowers/plans/2026-08-16-managed-library-full-contract.md`

Expected: 无输出；文档不含凭据值。

Run: `npm test`

Expected: Vitest 退出码 0，全部测试通过；现有测试警告若未造成失败，记录为既有警告而非本轮修复。

- [x] **Step 4: 检查范围并创建本地提交**

Run: `git status --short && git diff --stat && git diff --check`

Expected: 只有三份允许的 Markdown 文件，且无格式错误。

Run: `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-managed-library-full-contract.md docs/superpowers/plans/2026-08-16-managed-library-full-contract.md && git commit -m "docs: specify managed library contracts"`

Expected: 在 `codex/project-book` 创建一条本地提交；不 merge、不 push、不修改根目录工作树。

## 自检结果（计划形成时）

- 覆盖：Task 2 覆盖 I-01 至 I-04；Task 3 覆盖 I-05 至 I-07；Task 4 覆盖 I-08/I-09 和所有验证。R001 的数量/未备册规则同时在 4.1、4.4、5.2、6.1/6.2 形成可追溯闭环。
- 文档边界：只有一份项目功能项目书承载日常产品规则；账本和计划只记录原文、实施和验证，未创建第二份产品说明。
- 一致性：章节中的“远端成员数”“本地已分配数”“本轮计划数”“未知 `—`”是固定术语；任何未备册规则都无远端成员数且不能成为扫描来源或 B 站写入目标。
- 占位符：本计划不含 `TODO`、`TBD`、“稍后实现”或“类似 Task N”等占位文字。
