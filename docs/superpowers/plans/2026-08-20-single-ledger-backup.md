# 单个备册与绑定确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 让收藏库左侧“备册当前收藏夹”只处理当前逻辑工作夹，并在没有真实正式绑定时先确认绑定；让逻辑状态严格由 physical shard 事实推导，避免旧状态让所有工作夹显示已备册。

**Architecture:** 共享仓库在移除物理分册后立即重算受影响逻辑工作夹状态；主进程投影只信任真实 formal physical shard，并尊重用户解除标记；页面继续复用现有单目标 IPC 和绑定候选弹窗，右侧全量备册路径不变。

**Tech Stack:** TypeScript、React、Vitest、Testing Library、Electron IPC、共享收藏仓库。

---

### Task 1: 固化项目规则、账本与实施边界

**Files:**
- Modify: `docs/项目功能项目书.md`
- Modify: `docs/requirement-ledgers/2026-08-20-favorite-library-binding-status-divergence.md`
- Create: `docs/superpowers/plans/2026-08-20-single-ledger-backup.md`

- [x] **Step 1: 写入最终设计规则**

已在项目书 4.1、4.4 与 4.5 增加：已备册必须有正式 physical shard；单个入口只传当前 logical ID；无正式绑定先确认；取消不写入；右侧一键备册保持全量。

- [x] **Step 2: 回读账本并建立范围**

覆盖 `R001`、`R002`、`R003`、`R004`、`R005`；本轮代码只允许修改共享状态推导、状态核验投影、单个备册确认触发及回归测试，不修改右侧全量备册、视频同步、DeepSeek、转写。

### Task 2: 为物理分册删除后的逻辑状态写失败回归

**Files:**
- Modify: `src/shared/favoriteRepository.test.ts`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 添加仓库状态回归测试**

在 `remove-physical-shard-binding` 测试中断言：删除最后一条 `physicalShards` 后，`bilimi-logical:<id>` 仍保留本地逻辑归属但 `syncState` 变为 `pending-reconcile`，不能继续是 `bound`；删除另一个逻辑夹的分册不改变当前目标。

- [x] **Step 2: 添加主进程投影回归测试**

构造 `physicalShardCount: 0` 且 logical folder 为旧 `bound`、规则保留旧 remote ID 和 `managedFolderDeletedByUser: true` 的快照；断言状态检查后规则为 `unbound`、不会把旧 ID投影为 formal binding，并返回当前逻辑夹的未绑定候选。

- [x] **Step 3: 运行新增测试确认 RED**

运行：`npx vitest run src/shared/favoriteRepository.test.ts src/renderer/src/App.test.tsx -t "last.*shard|deleted.*marker|single.*backup"`

预期：新增断言在当前实现下失败，失败原因分别是 stale `bound` 和旧 remote ID 被恢复。

### Task 3: 修复共享仓库与状态核验的根因

**Files:**
- Modify: `src/shared/favoriteRepository.ts:2259-2278`
- Modify: `src/renderer/src/App.tsx:1520-1565`
- Modify: `src/renderer/src/features/favorites/favoriteLedgerApi.ts:150-185`

- [x] **Step 1: 删除物理分册后重算逻辑状态**

在 `remove-physical-shard-binding` 完成 `physicalShards` 过滤后，按受影响 `logicalLedgerId` 计算剩余分册：至少一条且全部 `bindingState === 'bound'` 并有 `remoteFolderId` 才保留 `bound`，否则设为 `pending-reconcile`；不删除逻辑文件夹和其本地成员。

- [x] **Step 2: 限制旧仓库兼容回退**

`projectFavoriteLedgersToFormalBindings` 只有在仓库明确报告 `physicalShardCount > 0` 但响应缺少分册详情时才允许兼容旧摘要；`physicalShardCount === 0` 时不得以 logical folder 的旧 `remoteFolderId` 推导 formal binding。

- [x] **Step 3: 尊重用户解除标记**

普通状态核验中，`managedFolderDeletedByUser` 直接保持 `bindingState: 'unbound'`，不因 B 站清单中仍存在旧 ID而回写 `bound`；显式确认的远端 ID可先通过该保护完成重绑，显式“确认创建并绑定”才可清除旧 remote ID 后创建新夹。

- [x] **Step 4: 运行 RED 测试确认 GREEN**

运行同 Task 2 命令；预期新增测试全部通过，已有相关测试不回退。

### Task 4: 固化单个入口只处理当前目标与确认行为

**Files:**
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.tsx:1701-1720`
- Modify: `src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx`
- Modify: `src/renderer/src/App.test.tsx`

- [x] **Step 1: 添加单个入口行为测试**

断言点击当前工作夹的按钮只调用 `ensureFavoriteLedger('bilimi-logical:current', { lightweightBackup: true })`，不调用全量入口、不调用视频同步；返回未绑定候选时显示“确认绑定 bilimi 收藏夹”并把候选交给现有弹窗。

- [x] **Step 2: 添加取消与确认边界测试**

断言关闭/取消绑定弹窗不再次调用 `ensureFavoriteLedger`、不调用绑定登记、不产生成功摘要；确认候选只再次调用当前 `folderId`，其它逻辑夹不进入调用集合。

- [x] **Step 3: 保持已正式绑定目标的快速路径**

目标存在正式 physical shard 且没有用户解除标记时，允许当前单个入口复用远端 ID；结果摘要仍只显示当前目标数量，不改变右侧全量按钮。

- [x] **Step 4: 运行收藏库测试确认 GREEN**

运行：`npx vitest run src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/App.test.tsx -t "provisions only the current|binding|single"`

- [x] **Step 5: 兼容旧持久化快照**

`FavoriteRepositoryService.normalizeSnapshot()`在读取历史 generation 时，若逻辑工作夹为`bound`但没有任何正式 physical shard，则只在内存投影中改为`pending-reconcile`并删除遗留 logical remote ID；不新建 generation、不修改 B 站。`favoriteRepositoryService.test.ts`先构造带正确校验和的旧 generation，再以新服务实例重启读取，断言状态归一化。

### Task 5: 全量回归、账本证据与提交前核对

**Files:**
- Modify: `docs/requirement-ledgers/2026-08-20-favorite-library-binding-status-divergence.md`

- [x] **Step 1: 运行相关自动化测试**

运行：`npm test -- --run src/shared/favoriteRepository.test.ts src/renderer/src/features/favorites/favoriteLedgerApi.test.ts src/renderer/src/features/favorites/FavoriteLibraryApp.test.tsx src/renderer/src/App.test.tsx`。

- [x] **Step 2: 运行类型/构建检查**

运行：`npm run build`；失败时只修复本轮范围内的类型或构建问题，不绕过检查。

- [x] **Step 3: 真实 Electron 验收（已授权的只读/取消分支）**

在真实开发版、账号`32922854`的`bilimi·知识学习`验收：左侧和右侧同为`未绑定`；点击单个入口后仅展示当前目标的 B 站候选和账号/ID；取消后状态与 physical shard 数保持不变。未点击确认绑定/创建，因本轮没有得到用户对 B 站写入的授权；也未关闭用户当前窗口来做真实重启。服务级重启回归已覆盖旧 generation 读取；实际点击、候选展示和取消期间窗口保持可交互，但未将这一次短路径观察泛化为完整性能基准。

- [x] **Step 4: 回写账本索引证据**

为 `I001`、`I006`、`I012`、`I013`、`I027`、`I028`、`I032`、`I034` 分别记录代码位置、测试结果和真实界面验收；无法真实验证的项明确标记，不能写成全部完成。

- [x] **Step 5: 提交前检查并本地提交**

已运行：`git status --short`、`git diff --stat`、`git diff --check`，确认没有无关文件；在本地 `main` 创建一条包含项目书、账本、计划、代码和测试的提交，未执行 merge/push。
