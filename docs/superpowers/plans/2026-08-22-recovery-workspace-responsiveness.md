# 收藏夹草稿恢复可响应性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在恢复决定指纹过期时仍提供恢复选择，并让已确认的本地规则变更不会在下次重启锁死可恢复的整理草稿。

**Architecture:** 保持协调器对未确认外部事实的严格恢复门禁；IPC 将“决定过期”转换为只读恢复摘要，DeepSeek 复用既有 `merge-latest` 恢复路径。用户明确保存规则后，协调器仅前移恢复基线的配置维度，不吸收视频、镜像、绑定或远端执行事实。

**Tech Stack:** TypeScript、Electron IPC、Vitest、现有收藏夹工作区持久化存储。

---

### Task 1: 固化项目书与需求审计

**Files:**

- Modify: `docs/项目功能项目书.md:204-292,375-385`
- Modify: `docs/requirement-ledgers/2026-08-22-recovery-decision-stale-regression.md`
- Create: `docs/superpowers/plans/2026-08-22-recovery-workspace-responsiveness.md`

- [x] **Step 1: 写入恢复状态与规则配置边界**

明确已保存规则的本地重算与配置指纹前移；保留远端事实的恢复摘要、三项选择和 B 站安全边界。

- [x] **Step 2: 记录实现与自动化验收证据**

仅在测试和只读界面验收已经发生后，逐项更新 I001–I004 的代码位置、证据和无法验证条件。

### Task 2: 让恢复入口在过期决定时仍返回摘要（R002）

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`

- [x] **Step 1: 写失败回归测试**

模拟 `prepareRecovery` 因“恢复决定过期”失败，而 `getRecoverySummary` 返回 `recover-draft`、`rescan`、`abandon`；断言 IPC 返回摘要且不开始扫描、DeepSeek 或远端执行。

- [x] **Step 2: 运行单测确认 RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`

Expected: 新测试因异常直接透出而失败。

- [x] **Step 3: 最小实现可识别的过期决定错误并在 IPC 回退摘要**

协调器导出窄化错误谓词；IPC 只对该明确可恢复错误读取摘要，其他损坏、账号和未知结果错误仍透出。

- [x] **Step 4: 运行单测确认 GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts`

Expected: 所有测试通过。

### Task 3: 让 DeepSeek 与规则编辑恢复同一草稿（R001、R003、R004）

**Files:**

- Modify: `electron/main/oldFavoriteWorkspaceCoordinator.ts`
- Modify: `electron/main/oldFavoriteWorkspaceDeepSeekService.ts`
- Test: `electron/main/oldFavoriteWorkspaceCoordinator.test.ts`
- Test: `electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

- [x] **Step 1: 写失败测试**

覆盖两条真实重启路径：首次 `getSnapshot()` 因过期决定抛错时，DeepSeek 必须先读摘要、选择 `merge-latest`、重新读快照、再允许模型请求；明确保存规则并重分类后重启，系统分类可重建且人工/DeepSeek 分类保持，外部视频/镜像/绑定变化仍不被基线前移。

- [x] **Step 2: 运行定向测试确认 RED**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: 新测试分别暴露异常直出和旧配置指纹。

- [x] **Step 3: 实现最小恢复与配置基线前移**

DeepSeek 对明确的过期错误复用恢复摘要和 `merge-latest`，模型请求只能发生在成功重新读取 `previewing` 快照后。`reclassifyForFavoriteConfiguration` 成功后仅更新恢复基线的配置指纹与决定指纹；不得更新视频、镜像、绑定维度或发起 B 站操作。

- [x] **Step 4: 运行定向测试确认 GREEN**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts`

Expected: 所有测试通过。

### Task 4: 端到端回归与证据（R001–R004）

**Files:**

- Modify: `docs/requirement-ledgers/2026-08-22-recovery-decision-stale-regression.md`
- Create: `.codex-artifacts/2026-08-22-recovery-*.png`

- [x] **Step 1: 运行相关自动化回归**

Run: `npm test -- electron/main/oldFavoriteWorkspaceCoordinator.test.ts electron/main/oldFavoriteWorkspaceDeepSeekService.test.ts electron/main/oldFavoriteWorkspaceCoordinatorIpc.test.ts src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [ ] **Step 2: Electron 只读验收（需在新的开发版主进程中完成；未执行）**

启动开发版，仅观察恢复弹窗的三项选择、恢复后的预览草稿控件和 DeepSeek 卡片；不得点击扫描、DeepSeek、创建/绑定/删除或任何 B 站写入按钮。保存截图到 `.codex-artifacts/`。

- [ ] **Step 3: 最终检查与本地提交（检查完成；因界面验收缺口未提交）**

Run: `npm test`, `npm run build`, `git diff --check`, `git diff --stat`, `git status --short`

仅暂存本计划、项目书、本轮账本、恢复修复及其测试；不得暂存两份无关未跟踪账本。测试或界面证据缺失时，不提交为本轮全部完成。
