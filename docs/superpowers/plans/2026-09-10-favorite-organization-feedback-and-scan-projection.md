# 收藏整理反馈与精确删除投影修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户讨论顺序改善确认同步等待、将远端检测详情改为独立只读弹窗，并恢复 Bilimi 扫描选择，同时只按已删除的精确远端 ID 阻断额外镜像/恢复投影。

**Architecture:** 将“扫描来源是否可选择”与“工作夹成员是否受保护”解耦：扫描始终由当次 B站目录决定，bound 仅决定保护成员读取；已确认删除的 exact ID 在扫描读取、镜像写入和恢复候选三个边界被拒绝。检测详情只复用现有弹窗数据与本地选择状态，绝不调用备册命令。确认性能仅在本地已知存在备册/容量/未分类风险时读取 renderer 预检；没有已知风险则直接由冻结端执行唯一的权威实时预检，若它发现新缺口再回到原确认弹窗。

**Tech Stack:** Electron 主进程、React、TypeScript、Vitest。

---

## 文件边界

- `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`：右侧远端检测提示与只读详情弹窗。
- 对应 renderer 测试：验证详情入口、全选与不触发备册。
- `electron/main/oldFavoriteWorkspaceScanService.ts`：目录扫描来源和已删除精确 ID 的页读取过滤。
- `electron/main/oldFavoriteWorkspaceCoordinator.ts`：扫描镜像、恢复候选和刷新投影。
- `electron/main/oldFavoriteWorkspaceScanService.test.ts`、`electron/main/oldFavoriteWorkspaceCoordinator.test.ts`、`src/shared/oldFavoriteWorkspace.test.ts`：扫描、镜像、恢复、显式禁扫回归。
- `docs/requirement-ledgers/2026-09-10-favorite-organization-feedback-and-scan-projection.md`：逐项原文、代码位置和验证证据。

### Task 1: 保留权威冻结预检，省去无已知风险时的前置读取

**Files:**

- Modify: `src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.tsx`
- Test: 与该组件相邻的测试文件
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`（仅当现有预检 API 需要可识别的缓存键）

- [x] **Step 1: 写失败测试**：无已知备册、已投影分册容量或未分类风险的确认不先调用 renderer 预检，直接走冻结；冻结端若报告新的备册缺口，界面重新读取预检并回到确认弹窗。
- [x] **Step 2: 运行 RED**：旧实现会在每次确认前无条件读取预检，测试失败于预检调用次数。
- [x] **Step 3: 最小实现**：仅在已知缺口、已投影 physical-shard 容量风险或未分类项时读预检；其余情况让冻结端执行实时权威预检，捕捉 `backup-preflight-required` 后展示原确认流程。保留现有显式备册/分册确认动作的各次实时读取。
- [x] **Step 4: 运行 GREEN**：`ControlledFavoriteLedgerPanel.test.tsx` 167/167 通过；冻结方法仍调用新的主进程预检。

### Task 2: 检测详情弹窗和并存提示

**Files:**

- Modify: `src/renderer/src/features/assistant/FavoriteLedgerOverview.tsx`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`（或现有相邻测试文件）

- [x] **Step 1: 写失败测试**：存在多个疑似/改名项时，“查看详情”打开弹窗、不展开内嵌按钮；弹窗可全选/取消全选；未绑定提示出现时详情入口仍存在；点击详情不调用备册 IPC。
- [x] **Step 2: 运行 RED**：旧展开式 UI 不满足独立弹窗和全选断言。
- [x] **Step 3: 最小实现**：统一检测详情弹窗状态和选择集合；提示区仅显示摘要和入口；将改名/疑似列表作为独立段落呈现；保留原备册按钮及其弹窗/命令完全不动。
- [x] **Step 4: 运行 GREEN**：`FavoriteLedgerOverview.test.tsx` 154/154 通过。

### Task 3: 恢复目录扫描选择并用 tombstone 精确阻断投影

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceScanService.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceScanService.test.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Modify: `src/shared/oldFavoriteWorkspace.test.ts`（如投影 helper 测试覆盖）

- [x] **Step 1: 写失败测试**：bound/未绑定/未备册的 Bilimi 当前目录夹与普通夹都默认 `scanEligible: true`、会读取源页且可以选择；bound 夹仍读取 managed members；`confirmedDeletedRemoteFolderIds` 中的 exact ID 不读源页、不写 `bilibili:<id>` 镜像、不进入恢复；同名新 ID 保持可选；显式 false 经 `recordScanInventory`、刷新及重启仍为 false。
- [x] **Step 2: 运行 RED**：`dc971048` 的名称/卡片状态禁选使测试失败。
- [x] **Step 3: 最小实现**：移除 `isBilimiCandidate` 对 scanEligible 的全局否决和对目录页读取的跳过；仅将 confirmed-deleted ID 构造成扫描服务的抑制集合；协调器在镜像与候选恢复前使用同一 exact-ID 集合过滤；关系刷新只保留原 scanEligible 或 explicit false，不重算为名称禁选。
- [x] **Step 4: 运行 GREEN**：扫描服务、协调器和 shared 相关套件 454/454 通过。

### Task 4: 开发版验收、账本和提交

**Files:**

- Modify: `docs/requirement-ledgers/2026-09-10-favorite-organization-feedback-and-scan-projection.md`

- [ ] **Step 1:** 开发版只读 UI 验收被本机自动化服务 `unsupported Codex auth method: apikey` 阻断；未绕过认证、未做 UI 操作，更未执行 B站写入。待人工只读验收。
- [x] **Step 2:** 已按 R001–R009 回读并在需求账本记录代码位置、自动化结果和 UI 阻塞。
- [x] **Step 3:** `npm run build`、`git diff --check`、`git status --short`、`git diff --stat` 已在提交前运行；仅含本轮文件。
- [ ] **Step 4:** 待完成最终差异复核后，本地提交；不 push、merge 或修改 B站数据。

## 自检

- R001 对应 Task 1；R002–R004 对应 Task 2；R005 对应 Task 2 的并存断言；R006–R009 对应 Task 3。
- 不新增 folder ID 的名称归属推断，不执行 B站写入，不更改备册流程。
- 因 R001 的性能修复依赖确认面板实际调用图，实施前必须先完整读取组件和测试，不能凭调用次数假设缓存位置。
