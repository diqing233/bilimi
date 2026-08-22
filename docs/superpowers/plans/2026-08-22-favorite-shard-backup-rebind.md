# Favorite Shard Backup Rebind Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除后缺少正式分册记录的已勾选规则，能在右侧备册中识别现存 bilimi 分册、要求确认并登记正式绑定。

**Architecture:** 正式 `physicalShards` 仍是唯一已备册事实；没有它时，规则的已观察远端分册只能作为`unbound`候选线索传给备册脚本，绝不获得写权限。脚本读到当前目录候选后返回确认数据；用户确认的精确 ID才进入现有正式登记路径。

**Tech Stack:** Electron、React、TypeScript、Vitest。

---

### Task 1: 文档规则与可审计需求

**Files:**

- Create: `docs/requirement-ledgers/2026-08-22-favorite-shard-backup-rebind.md`
- Create: `docs/superpowers/plans/2026-08-22-favorite-shard-backup-rebind.md`
- Modify: `docs/项目功能项目书.md` §4.4

- [x] **Step 1: 记录原文和不改边界**

  原文、`physicalShards`缺失、现存`bilimi·游戏专区·2`、候选确认、正式绑定和禁止自动认领/真实 B 站副作用均写入账本。

- [x] **Step 2: 明确项目书状态机**

  无正式分册但目录存在候选时必须走`确认绑定`；没有候选才允许沿用直接创建与创建前二次读取。

### Task 2: RED — 候选必须穿过正式绑定投影

**Files:**

- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 添加失败回归**

  用无 `physicalShards` 的仓库、`game`遗留 ID `4115311554`和 `bindingState: 'unbound'` 模拟右侧批量备册；模拟脚本返回同一真实 ID候选。断言运行时返回`unboundCandidates`，不调用正式绑定登记。

- [x] **Step 2: 验证 RED**

  运行：`npx vitest run src/renderer/src/App.test.tsx -t "returns an observed shard as an explicit rebind candidate when no formal shard exists"`

  实际：失败，因为当前投影遗漏移除 `bilibiliFolderIds`，将历史 `4115311554` 泄漏进备册脚本载荷。

### Task 3: GREEN — 保留未绑定候选而非旧绑定

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Test: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 最小修复投影**

  对没有正式分册的规则，移除全部旧远端绑定字段（包括 `bilibiliFolderIds`）后再进入备册脚本；候选必须由当前 B 站目录按规范化名称重新发现，绝不改为`bound`或直接登记。旧 ID仅保留为本地历史诊断线索。

- [x] **Step 2: 验证 GREEN**

  重新运行 Task 2 命令，预期通过；再运行完整 `App.test.tsx`。

### Task 4: 备册与界面回归

**Files:**

- Test: `src/renderer/src/features/favorites/favoriteLedgerApi.test.ts`
- Test: `src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx`
- Modify: `docs/requirement-ledgers/2026-08-22-favorite-shard-backup-rebind.md`

- [x] **Step 1: 运行现有候选确认、分册顺序、直创直绑和创建前二次检查回归**

  运行：`npx vitest run src/renderer/src/App.test.tsx src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/assistant/FavoriteLedgerOverview.test.tsx src/renderer/src/features/assistant/ControlledFavoriteLedgerPanel.test.tsx`

- [x] **Step 2: 只读 Electron 验收**

  点击备册但不点击`确认绑定`；确认候选弹窗显示实际`bilimi·游戏专区·2`、ID `4115311554`和 2 个视频。截图：`.codex-artifacts/2026-08-22-favorite-shard-rebind-candidate-with-id.png`。

- [x] **Step 3: 记录证据并验证提交范围**

  已更新账本的代码位置、自动化测试、截图与真实 B 站副作用缺口；`git diff --check`无空白错误，`npm test`为 237 文件、3999/3999 通过，`npm run build`通过。仅暂存并提交本轮文档、`App.tsx`与对应测试；项目书以最小补丁只暂存 §4.4 的备册状态机行。
