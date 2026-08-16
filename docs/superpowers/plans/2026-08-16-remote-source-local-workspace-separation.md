# Remote Source / Local Workspace Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将《项目功能项目书》中的扫描概览与收藏库统一为“B 站远端收藏夹主展示 + bilimi 本地工作区投影”，并补全显式绑定和新增标签再次采用的行为契约。

**Architecture:** B 站收藏夹是远端用户来源，名称不产生 bilimi 身份；bilimi 工作区是本地规则、草稿、入库归属和关系状态。已知关系的两端通过真实规则 ID 与远端 folder ID 链接，扫描资格独立于展示位置；标签采用记录每批已采用版本，只让新增/变化标签重新触发系统重算。

**Tech Stack:** Markdown、Git、PowerShell、ripgrep。

---

## 范围与修改边界

- 工作树：`C:\Users\diqing\bilimi\.worktrees\project-book`，分支 `codex/project-book`，基线 `fcc44e97`。
- 修改：`docs/项目功能项目书.md`、`docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md`、本计划文件。
- 不修改：`src/`、`electron/`、测试、Electron 应用数据、B 站数据和根目录无关账本。
- 设计依据：本账本 R001–R004，已有项目书 4.1、4.4、4.6、5.2、5.3、6.1、8.2、10 节。

### Task 1: 固化原文、索引和实施范围

**Files:**
- Create: `docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md`
- Create: `docs/superpowers/plans/2026-08-16-remote-source-local-workspace-separation.md`

- [x] **Step 1: 写入完整原文及截图上下文**

按 R001–R004 顺序保留全部用户原文、截图绝对路径和两处圈定文字；原文区之后列出已确认、待决定、替代和明确不做。

- [x] **Step 2: 建立四项可审计索引**

I-01 至 I-04 分别覆盖远端/本地分层、未绑定与候选夹、可恢复标签采用以及本轮 Git 范围。每项写明显示条件、交互、持久化/B 站边界和验收证据。

- [x] **Step 3: 从头复读账本**

Run: `Get-Content -Raw docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md`

Expected: R001–R004 完整位于索引前；仅 R001 截图中的自动/疑似绑定设计被明确替代。

### Task 2: 更新掌库和扫描概览分层契约

**Files:**
- Modify: `docs/项目功能项目书.md:133-149, 201-207, 225-244`

- [x] **Step 1: 在第 4.1 与第 4.6 固定“远端用户夹 / 本地工作区”定义**

将 B 站收藏夹定义为远端用户来源；将 bilimi 工作区定义为本地规则、草稿和入库归属。明确已绑定/待对账关系是链接，不改变远端夹主展示位置；名称、数量、前缀和远端 ID 暂缺均不能决定身份。

- [x] **Step 2: 重写第 5.2 的区域、徽标和扫描资格**

用户收藏夹区域列出所有远端夹；本地工作区列出草稿、未备册、已整理数据和关系状态。对已知绑定/待对账关系，远端行显示关系徽标，本地区显示关联卡片；普通无关系远端夹可勾选，已知同步目标和待关系确认项默认不可勾选。确认绑定与同步必须分开。

- [x] **Step 3: 保留现有实现偏差为待修复事实**

说明当前扫描器的单布尔模型不足以表达“远端展示位置、关系状态、扫描资格”三种独立维度；本轮不改实现或声称问题已修复。

### Task 3: 更新标签恢复、收藏库和跨页保护

**Files:**
- Modify: `docs/项目功能项目书.md:246-259, 326-393, 429-437, 458-474`

- [x] **Step 1: 收紧第 5.3 的重复采用条件**

写明 `继续补取标签` 只恢复当前批读取；仅标签索引出现尚未采用的新条目或变化后，`采用当前标签`才再次出现。无变化保留 accepted，人工分类和推荐不被覆盖。

- [x] **Step 2: 对齐第 6.1–6.6 收藏库投影**

左侧远端用户夹显示所有 B 站实体；bilimi 本地工作区显示本地归属和关系状态。已知关系以链接而非第二份远端实体呈现；列表、详情、复制/移动/同步、批量操作均按同一身份/扫描资格边界说明。

- [x] **Step 3: 对齐设置恢复和受保护回归清单**

在第 8.2 与第 10 节要求账号恢复不混淆远端夹和本地工作区，回归时覆盖普通远端夹、名称相似夹、已绑定夹、待对账夹、未备册本地夹和新增标签再次采用。

### Task 4: 文档验证与本地提交

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md`
- Modify: `docs/superpowers/plans/2026-08-16-remote-source-local-workspace-separation.md`

- [x] **Step 1: 回写逐项实施证据**

在 I-01 至 I-03 记录精确项目书章节、未改业务代码和仍待 Electron 验收；I-04 记录范围和提交前检查。

- [x] **Step 2: 运行文档和安全检查**

Run: `git diff --check`

Expected: 无格式错误。

Run: `rg -n "用户收藏夹（B 站）|bilimi 工作区|确认绑定|同步到 B 站|新增|变化标签|采用当前标签" docs/项目功能项目书.md`

Expected: 每个关键行为至少有一次精确命中。

Run: `rg -n -i "(api[_-]?key|secret|token|password)\\s*[:=]\\s*[^` ]+" docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md docs/superpowers/plans/2026-08-16-remote-source-local-workspace-separation.md`

Expected: 无输出。

- [x] **Step 3: 检查范围并创建本地提交**

Run: `git status --short && git diff --stat && git diff --check`

Expected: 只有三份允许 Markdown；没有格式错误。

Run: `git add docs/项目功能项目书.md docs/requirement-ledgers/2026-08-16-remote-source-local-workspace-separation.md docs/superpowers/plans/2026-08-16-remote-source-local-workspace-separation.md && git commit -m "docs: separate remote favorites from local workspace"`

Expected: 在 `codex/project-book` 创建一条本地提交；不 merge、不 push。
